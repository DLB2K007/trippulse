// Testes de recuperação de execuções RUNNING órfãs (Dia 11.5).
// Integração real com o banco: o objetivo é provar que um processo morto não
// bloqueia o índice parcial único para sempre e que um ciclo atrasado não
// ressuscita uma execução já recuperada.

import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../apps/api/src/config/prisma.js';
import {
  recoverStaleMonitoringRuns,
  startMonitoringRun,
} from '../apps/api/src/modules/monitoring/monitoring.service.js';

test.after(async () => {
  await prisma.$disconnect();
});

function activeTrip(id = 'trip-recovery') {
  return {
    id,
    name: 'Viagem recuperação',
    destination: 'Lisboa, Portugal',
    startDate: '2027-06-10',
    endDate: '2027-06-20',
  };
}

function emptyOpportunities() {
  return {
    summary: { evaluatedOfferCount: 0, containsSimulatedData: false },
    opportunities: [],
  };
}

test('recupera RUNNING com heartbeat expirado e preserva RUNNING vivo', async (t) => {
  const now = new Date();
  const run = await prisma.monitoringRun.create({
    data: {
      status: 'RUNNING',
      trigger: 'MANUAL',
      heartbeatAt: now,
      items: [],
    },
  });

  t.after(async () => {
    await prisma.monitoringRun.deleteMany({ where: { id: run.id } });
  });

  // Heartbeat recente: a recuperação não toca na execução viva.
  const freshResult = await recoverStaleMonitoringRuns({ now, staleAfterMs: 60_000 });
  assert.equal(freshResult.recovered, 0);

  let row = await prisma.monitoringRun.findUnique({ where: { id: run.id } });
  assert.equal(row.status, 'RUNNING');
  assert.equal(row.finishedAt, null);

  // Agora o heartbeat envelhece: a próxima recuperação a converte em FAILED.
  await prisma.monitoringRun.update({
    where: { id: run.id },
    data: { heartbeatAt: new Date(now.getTime() - 120_000) },
  });

  const result = await recoverStaleMonitoringRuns({ now, staleAfterMs: 60_000 });

  assert.equal(result.recovered, 1);

  row = await prisma.monitoringRun.findUnique({ where: { id: run.id } });
  assert.equal(row.status, 'FAILED');
  assert.ok(row.finishedAt);
  assert.match(row.failureReason, /órfã/);
});

test('startMonitoringRun recupera órfã antes de criar a nova execução', async (t) => {
  const stale = await prisma.monitoringRun.create({
    data: {
      status: 'RUNNING',
      trigger: 'MANUAL',
      heartbeatAt: new Date(Date.now() - 120_000),
      items: [],
    },
  });

  let view;
  t.after(async () => {
    await prisma.monitoringRun.deleteMany({
      where: { id: { in: [stale.id, view?.runId].filter(Boolean) } },
    });
  });

  view = await startMonitoringRun({
    trips: [],
    search: async () => ({ offers: [] }),
    opportunities: emptyOpportunities,
    staleAfterMs: 30_000,
  });

  assert.equal(view.status, 'COMPLETED');
  assert.notEqual(view.runId, stale.id);

  const recovered = await prisma.monitoringRun.findUnique({ where: { id: stale.id } });
  assert.equal(recovered.status, 'FAILED');

  const running = await prisma.monitoringRun.count({ where: { status: 'RUNNING' } });
  assert.equal(running, 0, 'nova execução finalizada; órfã liberada');
});

test('RUNNING com heartbeat recente continua bloqueando (409) e não é recuperado', async (t) => {
  const fresh = await prisma.monitoringRun.create({
    data: {
      status: 'RUNNING',
      trigger: 'MANUAL',
      heartbeatAt: new Date(),
      items: [],
    },
  });

  t.after(async () => {
    await prisma.monitoringRun.deleteMany({ where: { id: fresh.id } });
  });

  await assert.rejects(
    () =>
      startMonitoringRun({
        trips: [],
        search: async () => ({ offers: [] }),
        opportunities: emptyOpportunities,
        staleAfterMs: 30_000,
      }),
    (error) => error.statusCode === 409
  );

  const row = await prisma.monitoringRun.findUnique({ where: { id: fresh.id } });
  assert.equal(row.status, 'RUNNING');
  assert.equal(row.failureReason, null);
});

test('ciclo atrasado perde a posse e NÃO sobrescreve a recuperação como COMPLETED', async (t) => {
  let runningId;
  let recoveredAt;

  t.after(async () => {
    if (runningId) {
      await prisma.monitoringRun.deleteMany({ where: { id: runningId } });
    }
  });

  const view = startMonitoringRun({
    trips: [activeTrip()],
    staleAfterMs: 30_000,
    search: async () => {
      const running = await prisma.monitoringRun.findFirst({
        where: { status: 'RUNNING' },
        orderBy: { startedAt: 'desc' },
      });
      assert.ok(running, 'execução RUNNING existe durante o ciclo');
      runningId = running.id;

      // Simula outro processo recuperando esta execução enquanto o provedor
      // ainda está respondendo. O heartbeat recém-criado fica "velho" porque
      // a referência de recuperação é o futuro.
      const result = await recoverStaleMonitoringRuns({
        now: new Date(Date.now() + 60_000),
        staleAfterMs: 1,
      });
      recoveredAt = result.threshold;
      assert.ok(result.recovered >= 1);

      return { offers: [] };
    },
    opportunities: emptyOpportunities,
  });

  await assert.rejects(
    view,
    (error) => error.statusCode === 409 && /perdeu a posse/.test(error.message)
  );

  const row = await prisma.monitoringRun.findUnique({ where: { id: runningId } });
  assert.equal(row.status, 'FAILED', 'FAILED da recuperação permanece');
  assert.match(row.failureReason, /órfã/);
  assert.ok(row.finishedAt);
  assert.ok(recoveredAt instanceof Date);

  const completed = await prisma.monitoringRun.count({
    where: { id: runningId, status: 'COMPLETED' },
  });
  assert.equal(completed, 0, 'ciclo atrasado não ressuscita a linha');
});

// ---------- Prova da RENOVAÇÃO em ciclo real (achado MÉDIO-1 da auditoria) ----------

test('ciclo real renova o heartbeat DURANTE a execução (prova do withHeartbeat)', async (t) => {
  // Determinístico por dupla promessa adiada: `ready` sinaliza que a operação
  // externa chegou ao ponto de controle (com o touch ANTES da operação já
  // feito) e `parked` a mantém suspensa até o teste liberar. Zero sleeps.
  let readyResolve;
  let releaseResolve;
  const ready = new Promise((resolve) => {
    readyResolve = resolve;
  });
  const parked = new Promise((resolve) => {
    releaseResolve = resolve;
  });

  let runningId;
  let heartbeatAtOperationStart = null;
  let futureMarker = null;

  t.after(async () => {
    if (runningId) {
      await prisma.monitoringRun.deleteMany({ where: { id: runningId } });
    }
  });

  // Operação externa controlada pelo teste (a pesquisa da viagem).
  const search = async () => {
    const running = await prisma.monitoringRun.findFirst({
      where: { status: 'RUNNING' },
      orderBy: { startedAt: 'desc' },
    });
    assert.ok(running, 'execução RUNNING existe quando a operação externa inicia');
    runningId = running.id;

    // O touch ANTES da operação já aconteceu (withHeartbeat renova antes de
    // entregar o controle) — registramos o valor observado.
    heartbeatAtOperationStart = running.heartbeatAt;
    assert.ok(heartbeatAtOperationStart instanceof Date);

    // Marcador FUTURO (+60 s): se o pós-touch não acontecer, o heartbeat fica
    // preso aqui para sempre. A margem de 60 s torna a comparação estrita à
    // prova de granularidade de milissegundos, sem depender de tempo real.
    futureMarker = new Date(Date.now() + 60_000);
    await prisma.monitoringRun.update({
      where: { id: running.id },
      data: { heartbeatAt: futureMarker },
    });

    readyResolve(); // sinaliza: cheguei ao ponto de controle
    await parked; // operação externa suspensa
    return { offers: [] };
  };

  const viewPromise = startMonitoringRun({
    trips: [activeTrip('trip-heartbeat')],
    search,
    opportunities: emptyOpportunities,
  });

  await ready; // determinístico: search está estacionada com o marcador gravado
  releaseResolve(); // libera a operação externa

  const view = await viewPromise;

  // O ciclo finalizou corretamente apesar da operação controlada.
  assert.equal(view.status, 'COMPLETED');
  assert.equal(view.failureReason, null);
  assert.equal(view.tripCount, 1);
  assert.equal(view.monitorableCount, 1);
  assert.equal(view.skippedCount, 0);
  assert.equal(view.okCount, 1);

  // PROVA da renovação: o pós-touch "puxou" o heartbeat de volta do marcador
  // futuro para o relógio real. Se withHeartbeat fosse removido (ou o pós-touch
  // esquecido), o heartbeat permaneceria no marcador e esta asserção falharia.
  const row = await prisma.monitoringRun.findUnique({ where: { id: runningId } });
  assert.ok(
    row.heartbeatAt.getTime() < futureMarker.getTime(),
    'heartbeat renovado APÓS a operação externa (com withHeartbeat quebrado, ficaria no marcador futuro)'
  );
  assert.ok(
    row.heartbeatAt.getTime() >= heartbeatAtOperationStart.getTime(),
    'renovações nunca retroagem (touch pós-operação ≥ touch pré-operação)'
  );
});
