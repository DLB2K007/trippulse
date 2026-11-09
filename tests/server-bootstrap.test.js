// Testes do ciclo de vida do bootstrap (Dia 11.4 — Fase B).
//
// Zero portas fixas e zero sinais reais: env, app, factory do scheduler,
// fonte de sinais (EventEmitter) e terminate são INJETADOS em startServer().
// Dois pontos de contato com o real, sob controle:
//   - um teste usa o buildApp() REAL em porta 0 (listen de verdade, scheduler
//     falso e terminate espiado);
//   - os testes "wiring com factory REAL" usam createMonitoringScheduler
//     com relógio falso e run adiado (herança direta da Fase A).
//
// server.js NUNCA tem efeito no import: o bloco automático só roda quando é
// módulo principal (node --test roda cada arquivo de teste como principal —
// argv[1] é o arquivo de teste, não o server.js).

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { startServer } from '../apps/api/src/server.js';
import { createMonitoringScheduler } from '../apps/api/src/modules/monitoring/scheduler.js';
import { buildApp } from '../apps/api/src/app.js';

const ENV_OFF = { host: '127.0.0.1', port: 0, monitoringScheduler: { enabled: false, intervalMs: 900000 } };
const ENV_ON = { host: '127.0.0.1', port: 0, monitoringScheduler: { enabled: true, intervalMs: 60000 } };

// Drena microtarefas (o corpo async do shutdown avança até o próximo await).
async function drain() {
  await new Promise((resolve) => setImmediate(resolve));
}

// ---------- Fakes: app + scheduler com trilha ÚNICA de eventos ----------
// A trilha compartilhada permite validar ORDEM exata:
//   listen → start#1 → (sinal) → stop#1 → idle → close
function createFakeStack({ listenError, closeError, idleStalls = false } = {}) {
  const operations = [];
  const logRecords = [];
  const exitCodes = [];

  let listenCalls = 0;
  let closeCalls = 0;

  const app = {
    log: {
      info: (message) => logRecords.push(`info: ${message}`),
      warn: (message) => logRecords.push(`warn: ${message}`),
      error: (message) => logRecords.push(`error: ${message}`),
    },
    async listen({ host, port }) {
      listenCalls += 1;
      operations.push('listen');
      if (listenError) {
        throw listenError;
      }
      return `http://${host}:${port}`;
    },
    async close() {
      closeCalls += 1;
      operations.push('close');
      if (closeError) {
        throw closeError;
      }
    },
  };

  let startCount = 0;
  let stopCount = 0;
  let idleRelease = null;

  const scheduler = {
    start() {
      startCount += 1;
      operations.push(`start#${startCount}`);
    },
    stop() {
      stopCount += 1;
      operations.push(`stop#${stopCount}`);
    },
    isRunning() {
      return startCount > stopCount;
    },
    idle() {
      operations.push('idle');
      if (!idleStalls) {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        idleRelease = resolve;
      });
    },
  };

  // Factory registrada: captura o log injetado pelo server.js (assert de
  // "logging consistente com Fastify") e devolve o scheduler falso.
  function schedulerFactory(options) {
    schedulerFactory.received = options;
    return scheduler;
  }

  return {
    operations,
    logRecords,
    exitCodes,
    app,
    scheduler,
    counts: { start: () => startCount, stop: () => stopCount, listen: () => listenCalls, close: () => closeCalls },
    releaseIdle() {
      idleRelease?.();
    },
    schedulerFactory,
    terminate: (code) => exitCodes.push(code),
  };
}

async function bootFake({ env = ENV_ON, listenError, closeError, idleStalls = false } = {}) {
  const stack = createFakeStack({ listenError, closeError, idleStalls });
  const signals = new EventEmitter();

  const handle = await startServer({
    env,
    createApplication: () => stack.app,
    createScheduler: stack.schedulerFactory,
    signals,
    terminate: stack.terminate,
  });

  return { ...stack, handle, signals };
}

// ---------- Requisitos do escopo ----------

test('bootstrap com scheduler OFF: factory nunca é chamada; shutdown simples fecha o app', async () => {
  const stack = createFakeStack();
  let factoryCalls = 0;

  const handle = await startServer({
    env: ENV_OFF,
    createApplication: () => stack.app,
    createScheduler: () => {
      factoryCalls += 1;
      throw new Error('factory não deveria ser invocada com scheduler desativado');
    },
    signals: new EventEmitter(),
    terminate: stack.terminate,
  });

  assert.notEqual(handle, null);
  assert.equal(handle.scheduler, null, 'scheduler ausente quando desativado');
  assert.equal(factoryCalls, 0);
  assert.equal(stack.counts.listen(), 1);

  const closed = await handle.shutdown('SIGTERM'); // invocação direta, sem sinal real
  assert.equal(closed, true);
  assert.equal(stack.counts.close(), 1);
  assert.deepEqual(stack.exitCodes, [0]);
});

test('bootstrap com scheduler ON: start DEPOIS do listen, uma única vez, com o logger do Fastify', async () => {
  const boot = await bootFake({ env: ENV_ON });

  assert.equal(boot.handle.scheduler, boot.scheduler);
  assert.deepEqual(boot.operations, ['listen', 'start#1'], 'ordem: listen → start (nunca antes)');
  assert.equal(boot.counts.start(), 1);
  assert.equal(boot.schedulerFactory.received.log, boot.app.log, 'logging consistente: o scheduler usa o logger do Fastify');

  const closed = await boot.handle.shutdown();
  assert.equal(closed, true);
  assert.deepEqual(boot.exitCodes, [0]);
});

test('listen() falhando: terminate(1), factory NUNCA invocada, ZERO handlers de sinal', async () => {
  const boot = await bootFake({
    env: ENV_ON,
    listenError: new Error('EADDRINUSE: porta em uso'),
  });

  assert.equal(boot.handle, null, 'sem handles quando o listen falha');
  assert.deepEqual(boot.exitCodes, [1]);
  assert.equal(boot.schedulerFactory.received, undefined, 'factory jamais invocada');
  assert.equal(boot.signals.listenerCount('SIGTERM'), 0);
  assert.equal(boot.signals.listenerCount('SIGINT'), 0);
  assert.ok(boot.logRecords.some((line) => line.startsWith('error:') && line.includes('EADDRINUSE')));
  assert.equal(boot.counts.listen(), 1);
  assert.equal(boot.counts.close(), 0);
});

test('L2: factory do agendador falhando APÓS listen → log correto, app fechado, exit 1', async () => {
  const stack = createFakeStack();

  const boot = await startServer({
    env: ENV_ON,
    createApplication: () => stack.app,
    createScheduler: () => {
      throw new TypeError('factory quebrada');
    },
    signals: new EventEmitter(),
    terminate: stack.terminate,
  });

  assert.equal(boot, null, 'sem handles quando a inicialização pós-listen falha');
  assert.deepEqual(stack.exitCodes, [1]);
  assert.equal(stack.counts.close(), 1, 'app FECHADO após a falha (porta não fica aberta)');
  assert.ok(
    stack.logRecords.some(
      (line) => line.startsWith('error:') && line.includes('pós-listen') && line.includes('factory quebrada')
    ),
    'mensagem correta identificando a fase'
  );
  assert.equal(
    stack.logRecords.some((line) => line.includes('listen() falhou')),
    false,
    'falha pós-listen não é rotulada como falha de listen'
  );
});

test('L2: falha ao registrar handlers pós-listen também cancela o scheduler e fecha o app', async () => {
  const stack = createFakeStack();
  const signals = new EventEmitter();
  signals.on = () => {
    throw new Error('registro de sinal indisponível');
  };

  const boot = await startServer({
    env: ENV_ON,
    createApplication: () => stack.app,
    createScheduler: stack.schedulerFactory,
    signals,
    terminate: stack.terminate,
  });

  assert.equal(boot, null);
  assert.deepEqual(stack.exitCodes, [1]);
  assert.equal(stack.counts.start(), 1);
  assert.equal(stack.counts.stop(), 1, 'scheduler criado foi parado antes do close');
  assert.equal(stack.counts.close(), 1);
});

test('L4: env sem monitoringScheduler falha ANTES de criar o app (sem instância vazada)', async () => {
  let created = 0;

  await assert.rejects(
    startServer({
      env: { host: '127.0.0.1', port: 0 },
      createApplication: () => {
        created += 1;
        return createFakeStack().app;
      },
      signals: new EventEmitter(),
      terminate: () => {},
    }),
    TypeError
  );

  assert.equal(created, 0, 'createApplication nunca foi chamado');
});

test('SIGTERM e SIGINT executam o MESMO fluxo gracioso (ordem stop → idle → close → exit 0)', async () => {
  for (const signal of ['SIGTERM', 'SIGINT']) {
    const boot = await bootFake({ env: ENV_ON });

    boot.signals.emit(signal); // caminho REAL do handler de sinal
    const closed = await boot.handle.shutdown(signal); // MESMA promessa do sinal

    assert.equal(closed, true, `signal=${signal}`);
    assert.deepEqual(boot.operations, ['listen', 'start#1', 'stop#1', 'idle', 'close'], `ordem (${signal})`);
    assert.equal(boot.counts.stop(), 1, `scheduler interrompido 1× (${signal})`);
    assert.equal(boot.counts.close(), 1);
    assert.deepEqual(boot.exitCodes, [0]);
  }
});

test('shutdown IDEMPOTENTE: sinais dobrados + chamadas diretas → UMA única sequência', async () => {
  const boot = await bootFake({ env: ENV_ON });

  const first = boot.handle.shutdown('SIGTERM'); // promessa em curso
  assert.equal(boot.handle.shutdown('SIGINT'), first, '2ª chamada devolve a MESMA promessa');
  boot.signals.emit('SIGTERM'); // duplicado: zero efeito extra
  boot.signals.emit('SIGINT'); // duplicado: zero efeito extra

  const closed = await first;
  await drain();

  assert.equal(closed, true);
  assert.deepEqual(boot.operations, ['listen', 'start#1', 'stop#1', 'idle', 'close'], 'uma única sequência completa');
  assert.equal(boot.counts.stop(), 1);
  assert.equal(boot.counts.close(), 1, 'app.close UMA vez — nem simultâneo nem repetido');
  assert.deepEqual(boot.exitCodes, [0], 'terminate UMA vez');
});

test('ciclo EM VOO durante o shutdown: close AGUARDA o idle; ciclo não é abortado', async () => {
  const boot = await bootFake({ env: ENV_ON, idleStalls: true });

  boot.signals.emit('SIGTERM');
  const closing = boot.handle.shutdown('SIGTERM'); // promessa em curso

  await drain();
  assert.deepEqual(boot.operations, ['listen', 'start#1', 'stop#1', 'idle'], 'parado em idle: close NÃO avançou');
  assert.equal(boot.handle.scheduler.isRunning(), false, 'nenhum ciclo NOVO será aceito');

  boot.releaseIdle(); // ciclo em voo termina agora
  const closed = await closing;
  await drain();

  assert.equal(closed, true);
  assert.deepEqual(boot.operations, ['listen', 'start#1', 'stop#1', 'idle', 'close']);
  assert.deepEqual(boot.exitCodes, [0]);
});

test('app.close() falhando no shutdown: erro registrado, terminate(1), sem throw para fora', async () => {
  const boot = await bootFake({ env: ENV_ON, closeError: new Error('falha no close') });

  const closed = await boot.handle.shutdown('SIGTERM'); // NUNCA rejeita

  assert.equal(closed, false);
  assert.ok(boot.logRecords.some((line) => line.startsWith('error:') && line.includes('falha no close')));
  assert.deepEqual(boot.exitCodes, [1]);
  assert.equal(boot.counts.stop(), 1, 'scheduler foi parado ANTES da falha do close');
});

// ---------- Bootstrap real: buildApp() INTACTO em porta 0 ----------

test('bootstrap REAL (buildApp em porta 0): listen OK, scheduler falso iniciado, handlers únicos', async () => {
  const stack = createFakeStack();
  const signals = new EventEmitter();

  const handle = await startServer({
    env: ENV_ON,
    createApplication: buildApp, // app REAL, intocado
    createScheduler: stack.schedulerFactory,
    signals,
    terminate: stack.terminate,
  });

  assert.notEqual(handle, null);
  assert.match(handle.address, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(stack.counts.start(), 1, 'scheduler iniciado após listen real');
  assert.equal(signals.listenerCount('SIGTERM'), 1, 'handler SIGTERM registrado UMA vez');
  assert.equal(signals.listenerCount('SIGINT'), 1, 'handler SIGINT registrado UMA vez');

  const closed = await handle.shutdown('SIGTERM'); // fecha a porta real
  assert.equal(closed, true);
  assert.equal(stack.counts.stop(), 1);
  assert.deepEqual(stack.exitCodes, [0]);
});

// ---------- Wiring com o factory REAL da Fase A (relógio falso + run adiado) ----------

function createFakeTimers() {
  const pending = [];
  const timers = {
    schedule(fn, delay) {
      const entry = { fn, delay };
      pending.push(entry);
      return entry;
    },
    clear(entry) {
      const index = pending.indexOf(entry);
      if (index >= 0) {
        pending.splice(index, 1);
      }
    },
  };
  function fire() {
    const entry = pending[0];
    pending.shift();
    return entry.fn();
  }
  return { timers, pending, fire };
}

function deferredRun() {
  const calls = [];
  const deferreds = [];
  return {
    run: () => {
      calls.push(calls.length);
      return new Promise((resolve, reject) => deferreds.push({ resolve, reject }));
    },
    calls,
    settle(value) {
      deferreds[0].resolve(value);
    },
  };
}

test('wiring com factory REAL: tick pendente é CANCELADO no shutdown (D1: zero ciclos antes do intervalo)', async () => {
  const { timers, pending } = createFakeTimers();
  const { run, calls } = deferredRun();
  const stack = createFakeStack();
  const signals = new EventEmitter();

  const handle = await startServer({
    env: ENV_ON,
    createApplication: () => stack.app,
    // Factory REAL da Fase A: o wiring em si, com relógio/run de teste.
    createScheduler: (options) => createMonitoringScheduler({ ...options, run, timers }),
    signals,
    terminate: stack.terminate,
  });

  assert.equal(handle.scheduler.isRunning(), true);
  assert.equal(pending.length, 1, 'um ÚNICO tick pendente, no intervalo completo');
  assert.equal(pending[0].delay, 60000);

  const closed = await handle.shutdown('SIGTERM');

  assert.equal(closed, true);
  assert.equal(pending.length, 0, 'timer pendente CANCELADO no shutdown');
  assert.equal(calls.length, 0, 'D1: nenhum ciclo antes do intervalo completo');
  assert.equal(handle.scheduler.isRunning(), false);
  assert.deepEqual(stack.exitCodes, [0]);
});

test('wiring com factory REAL: ciclo EM VOO conclui no shutdown; AUSÊNCIA de novos ciclos depois', async () => {
  const { timers, pending, fire } = createFakeTimers();
  const { run, calls, settle } = deferredRun();
  const stack = createFakeStack();
  const signals = new EventEmitter();

  const handle = await startServer({
    env: ENV_ON,
    createApplication: () => stack.app,
    createScheduler: (options) => createMonitoringScheduler({ ...options, run, timers }),
    signals,
    terminate: stack.terminate,
  });

  fire(); // tick em voo (run pendente) — ciclo ativo durante o shutdown
  await drain();
  assert.equal(calls.length, 1);

  signals.emit('SIGINT');
  const closing = handle.shutdown('SIGINT'); // MESMA promessa em curso do sinal

  await drain();
  assert.equal(stack.counts.close(), 0, 'close AGUARDA o ciclo em voo (idle)');
  assert.equal(handle.scheduler.isRunning(), false, 'nenhum ciclo NOVO será agendado');

  settle({ runId: 'r-fb', status: 'COMPLETED' }); // ciclo em voo termina
  const closed = await closing;
  await drain();

  assert.equal(closed, true);
  assert.equal(stack.counts.close(), 1, 'close só APÓS o desfecho do ciclo em voo');
  assert.equal(pending.length, 0, 'AUSÊNCIA de novos ciclos após o stop');
  assert.equal(calls.length, 1, 'o run em voo rodou exatamente 1×');
  assert.equal(handle.scheduler.ticks(), 1);
  assert.deepEqual(stack.exitCodes, [0]);
});
