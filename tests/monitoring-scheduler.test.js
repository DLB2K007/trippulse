// Testes do agendador (Dia 11.4 — Fase A). ZERO tempos reais nos unitários:
// relógio injetável (handles falsos), run injetável e flush por setImmediate
// (microtarefas do tick sempre concluídas antes das asserções).
// Único teste com banco real: o do `defaultScheduledRun` (trigger SCHEDULED).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMonitoringScheduler,
  defaultScheduledRun,
} from '../apps/api/src/modules/monitoring/scheduler.js';
import { HttpError } from '../apps/api/src/shared/errors.js';
import { prisma } from '../apps/api/src/config/prisma.js';

const INTERVAL = 120000; // 2 min — qualquer valor dentro da faixa válida

function createFakeTimers() {
  const pending = []; // handles pendentes { fn, delay }
  const ops = []; // trilha de agenda/limpeza

  const timers = {
    schedule(fn, delay) {
      const entry = { fn, delay };
      pending.push(entry);
      ops.push({ op: 'schedule', delay });
      return entry;
    },
    clear(entry) {
      const index = pending.indexOf(entry);
      if (index >= 0) {
        pending.splice(index, 1);
      }
      ops.push({ op: 'clear' });
    },
  };

  // Dispara o próximo tick pendente (retira-o da lista de pendentes ANTES de
  // executar, espelhando o setTimeout real: disparado não está mais pendente).
  function fire() {
    const entry = pending[0];
    assert.ok(entry, 'existe tick pendente para disparar');
    pending.shift();
    return entry.fn();
  }

  return { timers, pending, ops, fire };
}

function fakeLog() {
  const records = { info: [], warn: [], error: [] };
  return {
    records,
    info: (msg) => records.info.push(String(msg)),
    warn: (msg) => records.warn.push(String(msg)),
    error: (msg) => records.error.push(String(msg)),
  };
}

function deferredRun() {
  const calls = [];
  const deferreds = [];

  const run = () => {
    calls.push(calls.length);
    return new Promise((resolve, reject) => deferreds.push({ resolve, reject }));
  };

  return {
    run,
    calls,
    settle(value) {
      deferreds[0].resolve(value);
    },
    reject(value) {
      deferreds[0].reject(value);
    },
  };
}

// Conclui TODAS as microtarefas pendentes do tick (até o finally reagendar).
async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

test('factory barreira defensiva: intervalo inválido faila antes de qualquer timer', () => {
  for (const bad of [0, 59999, 86400001, NaN, 'abc', undefined]) {
    assert.throws(() => createMonitoringScheduler({ intervalMs: bad }), TypeError);
  }
});

test('start(): agenda EXATAMENTE um tick com o intervalo (D1 — nada imediato)', () => {
  const { timers, pending, ops } = createFakeTimers();
  const scheduler = createMonitoringScheduler({ intervalMs: INTERVAL, timers, run: async () => ({}), log: fakeLog() });

  scheduler.start();

  assert.equal(pending.length, 1);
  assert.equal(pending[0].delay, INTERVAL);
  assert.equal(scheduler.isRunning(), true);
  assert.equal(ops.filter((op) => op.op === 'clear').length, 0);
});

test('tick: executa o run e REAGENDA somente depois do desfecho (after-complete)', async () => {
  const { timers, pending, fire } = createFakeTimers();
  const { run, calls, settle } = deferredRun();
  const scheduler = createMonitoringScheduler({ intervalMs: INTERVAL, timers, run, log: fakeLog() });

  scheduler.start();
  fire();
  await flush();

  assert.equal(calls.length, 1);

  settle({ runId: 'r-1', status: 'COMPLETED' });
  await flush();

  assert.equal(pending.length, 1, 'próximo tick agendado');
  assert.equal(pending[0].delay, INTERVAL);
});

test('sobreposição proibida por construção: run infinito → ZERO reagendamento', async () => {
  const { timers, pending, fire } = createFakeTimers();
  const { run, calls, settle } = deferredRun();
  const scheduler = createMonitoringScheduler({ intervalMs: INTERVAL, timers, run, log: fakeLog() });

  scheduler.start();
  fire();
  await flush();

  // O ciclo nunca resolveu: nenhum novo tick foi agendado e run rodou 1×.
  assert.equal(pending.length, 0);
  assert.equal(calls.length, 1);

  // Resolve agora: só ENTÃO o próximo tick nasce (nunca em paralelo).
  settle({ runId: 'r-2', status: 'COMPLETED' });
  await flush();

  assert.equal(pending.length, 1);
  assert.equal(scheduler.ticks(), 1);
});

test('409 é SKIP: nenhum unhandledRejection, log .info e reagendamento preservado', async () => {
  const { timers, pending, fire } = createFakeTimers();
  const { run, reject } = deferredRun();
  const logger = fakeLog();
  const scheduler = createMonitoringScheduler({ intervalMs: INTERVAL, timers, run, log: logger });

  scheduler.start();
  fire();
  await flush();

  reject(new HttpError(409, 'Já existe uma execução de monitoramento em andamento.'));
  await flush();

  assert.equal(pending.length, 1, 'reagendou normalmente');
  assert.ok(logger.records.info.some((msg) => msg.includes('409')), 'skip registrado em .info');
  assert.deepEqual(logger.records.error, [], '409 não é erro');
});

test('erro genérico é registrado em .error e o agendador NUNCA para', async () => {
  const { timers, pending, fire } = createFakeTimers();
  const { run, reject } = deferredRun();
  const logger = fakeLog();
  const scheduler = createMonitoringScheduler({ intervalMs: INTERVAL, timers, run, log: logger });

  scheduler.start();
  fire();
  await flush();

  reject(new Error('falha qualquer'));
  await flush();

  assert.equal(pending.length, 1, 'reagendou após erro');
  assert.ok(logger.records.error.some((msg) => msg.includes('falha qualquer')));
});

test('stop(): limpa o tick pendente e é idempotente (sem throw no 2º stop)', () => {
  const { timers, pending, ops } = createFakeTimers();
  const scheduler = createMonitoringScheduler({ intervalMs: INTERVAL, timers, run: async () => ({}), log: fakeLog() });

  scheduler.start();
  scheduler.stop();

  assert.equal(pending.length, 0);
  assert.equal(scheduler.isRunning(), false);
  assert.equal(ops.filter((op) => op.op === 'clear').length, 1);

  scheduler.stop(); // idempotente
  scheduler.stop();
  assert.equal(pending.length, 0);
});

test('stop() durante ciclo em voo: NÃO aborta o run e impede o reagendamento', async () => {
  const { timers, pending, fire } = createFakeTimers();
  const { run, settle } = deferredRun();
  const scheduler = createMonitoringScheduler({ intervalMs: INTERVAL, timers, run, log: fakeLog() });

  scheduler.start();
  fire(); // tick em voo
  await flush();
  scheduler.stop(); // encerra AGORA, com o ciclo pendente

  assert.equal(pending.length, 0);
  assert.equal(scheduler.isRunning(), false);

  settle({ runId: 'r-3', status: 'COMPLETED' });
  await flush();

  assert.equal(pending.length, 0, 'nenhum reagendamento após stop');
  assert.equal(scheduler.ticks(), 1);
});

test('reinicialização: start() após stop() reagenda normalmente', async () => {
  const { timers, pending, fire } = createFakeTimers();
  const { run, settle } = deferredRun();
  const scheduler = createMonitoringScheduler({ intervalMs: INTERVAL, timers, run, log: fakeLog() });

  scheduler.start();
  scheduler.stop();
  scheduler.start();

  assert.equal(pending.length, 1);
  fire();
  await flush();
  settle({});
  await flush();

  assert.equal(pending.length, 1);
  assert.equal(scheduler.isRunning(), true);
});

test('timers duplicados: start() duas vezes → um ÚNICO timer (idempotente + warn)', () => {
  const { timers, pending } = createFakeTimers();
  const logger = fakeLog();
  const scheduler = createMonitoringScheduler({ intervalMs: INTERVAL, timers, run: async () => ({}), log: logger });

  scheduler.start();
  scheduler.start();

  assert.equal(pending.length, 1);
  assert.ok(logger.records.warn.some((msg) => msg.includes('já está ativo')));
});

test('run ausente/não-função faila alto antes de qualquer timer', () => {
  assert.throws(
    () => createMonitoringScheduler({ intervalMs: INTERVAL, timers: createFakeTimers().timers, run: 'nao-e-funcao', log: fakeLog() }),
    TypeError
  );
});

// ---------- Adições da Fase B em cima da Fase A (aditivas) ----------

test('idle(): resolve imediatamente quando não há ciclo em voo', async () => {
  const { timers } = createFakeTimers();
  const scheduler = createMonitoringScheduler({ intervalMs: INTERVAL, timers, run: async () => ({}), log: fakeLog() });

  // Sem start() e sem tick: nada em voo — promessa já resolvida.
  await scheduler.idle();
  await scheduler.idle(); // chamadas repetidas também são seguras
});

test('idle(): aguarda o ciclo EM VOO concluir antes de resolver (base do shutdown gracioso)', async () => {
  const { timers, fire } = createFakeTimers();
  const { run, settle } = deferredRun();
  const scheduler = createMonitoringScheduler({ intervalMs: INTERVAL, timers, run, log: fakeLog() });

  scheduler.start();
  fire(); // tick em voo (run pendente)
  await flush();

  let resolved = false;
  const idlePromise = scheduler.idle();
  idlePromise.then(() => {
    resolved = true;
  });

  await flush();
  assert.equal(resolved, false, 'idle() continua pendente com o ciclo em voo');

  settle({ runId: 'r-idle', status: 'COMPLETED' });
  await flush();

  assert.equal(resolved, true, 'idle() resolve somente após o desfecho do ciclo');
});

test('logs de sucesso: "execução agendada iniciada" vem ANTES de "concluído" (sem duplicação)', async () => {
  const { timers, fire } = createFakeTimers();
  const { run, settle } = deferredRun();
  const logger = fakeLog();
  const scheduler = createMonitoringScheduler({ intervalMs: INTERVAL, timers, run, log: logger });

  scheduler.start();
  fire();
  await flush();

  const started = logger.records.info.filter((msg) => msg.includes('iniciada'));
  assert.equal(started.length, 1, 'uma única linha de ciclo iniciado');
  assert.deepEqual(logger.records.info.filter((m) => m.includes('concluído')), [], 'concluído só depois do run');

  settle({ runId: 'r-4', status: 'COMPLETED' });
  await flush();

  assert.equal(started.length, 1);
  assert.equal(logger.records.info.filter((m) => m.includes('concluído')).length, 1);
});

// ---------- Fase B.1 — hardening ----------

test('M1: stop → start com ciclo em voo mantém UMA cadeia; stop final deixa ZERO timers', async () => {
  const { timers, pending, fire } = createFakeTimers();
  const { run, calls, settle } = deferredRun();
  const scheduler = createMonitoringScheduler({ intervalMs: INTERVAL, timers, run, log: fakeLog() });

  scheduler.start();
  fire(); // ciclo em voo
  await flush();
  assert.equal(calls.length, 1);

  scheduler.stop();
  scheduler.start(); // reativação DURANTE o ciclo: não pode criar 2ª cadeia
  assert.equal(pending.length, 0, 'start() com ciclo em voo NÃO agenda timer novo');
  assert.equal(scheduler.isRunning(), true, 'reativado, aguardando o desfecho do ciclo');

  settle({ runId: 'r-m1', status: 'COMPLETED' });
  await flush();

  assert.equal(pending.length, 1, 'o ciclo em voo reagendou EXATAMENTE uma vez');
  assert.equal(scheduler.ticks(), 1, 'nenhum tick extra nasceu do restart');

  scheduler.stop();
  assert.equal(pending.length, 0, 'stop final cancela o único timer');
  assert.equal(scheduler.isRunning(), false);

  // Sem timer pendente não há como iniciar ciclo; a trilha confirma que o run
  // não foi chamado de novo após o stop.
  assert.equal(calls.length, 1, 'nenhum ciclo começou depois do stop final');
});

test('L1: falha do logger no início do tick não mata a cadeia nem gera unhandledRejection', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(String(reason));
  process.on('unhandledRejection', onUnhandled);

  try {
    const { timers, pending, fire } = createFakeTimers();
    const { run, calls, settle } = deferredRun();

    // Falha SÓ no primeiro log de início (destino indisponível uma vez);
    // os ticks seguintes logam normalmente e devem voltar a executar o run.
    let failedOnce = false;
    const log = {
      info(message) {
        if (!failedOnce && String(message).includes('iniciada')) {
          failedOnce = true;
          throw new Error('destino de log indisponível');
        }
      },
      warn() {},
      error() {},
    };
    const scheduler = createMonitoringScheduler({ intervalMs: INTERVAL, timers, run, log });

    scheduler.start();
    fire();
    await flush();
    await flush();

    assert.equal(calls.length, 0, 'o run nem chegou a ser chamado no tick com log quebrado');
    assert.equal(pending.length, 1, 'mesmo assim a cadeia reagendou no finally');
    assert.equal(scheduler.isRunning(), true, 'agendador continua ativo (não morreu)');

    fire(); // tick seguinte: log volta a funcionar
    await flush();
    assert.equal(calls.length, 1, 'recuperou: o tick seguinte executou o run');

    settle({ runId: 'r-l1', status: 'COMPLETED' });
    await flush();
    await flush();

    assert.equal(pending.length, 1, 'cadeia segue viva após o desfecho');
    assert.deepEqual(unhandled, [], 'nenhum unhandledRejection');
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
});

test('M1 (borda): tick que falha ANTES do primeiro await não deixa ciclo fantasma; stop → start agenda normalmente', async () => {
  const { timers, pending, fire } = createFakeTimers();
  let runs = 0;
  let failedOnce = false;
  const log = {
    info(message) {
      if (!failedOnce && String(message).includes('iniciada')) {
        failedOnce = true;
        throw new Error('logger quebrado no início do tick');
      }
    },
    warn() {},
    error() {},
  };
  const scheduler = createMonitoringScheduler({
    intervalMs: INTERVAL,
    timers,
    run: async () => {
      runs += 1;
      return {};
    },
    log,
  });

  scheduler.start();
  fire(); // termina de forma SÍNCRONA (falha antes de qualquer await)
  await flush();

  assert.equal(runs, 0);
  assert.equal(pending.length, 1, 'cadeia reagendada mesmo na falha síncrona');

  scheduler.stop();
  scheduler.start();

  assert.equal(pending.length, 1, 'start após stop agenda UM timer (sem ciclo fantasma)');
  assert.equal(scheduler.isRunning(), true);
});

// ---------- Integração real (banco): o trigger do tick padrão é SCHEDULED ----------

test('defaultScheduledRun: registra execução REAL com trigger SCHEDULED (service do Dia 11.3)', async () => {
  const view = await defaultScheduledRun();

  assert.equal(view.trigger, 'SCHEDULED');
  assert.equal(view.status, 'COMPLETED');
  assert.ok(view.runId);

  await prisma.monitoringRun.deleteMany({ where: { id: view.runId } });
});
