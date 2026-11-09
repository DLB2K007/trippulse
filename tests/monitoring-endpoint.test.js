// Testes de integração do monitoramento com PERSISTÊNCIA (Dia 11.3).
// HTTP via app.inject() contra o banco real + níveis de service com
// dependências injetadas (ciclo sem Banco — a linha de execução é persistida).

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildApp } from '../apps/api/src/app.js';
import { prisma } from '../apps/api/src/config/prisma.js';
import {
  startMonitoringRun,
  MONITORING_RUN_STATUS,
} from '../apps/api/src/modules/monitoring/monitoring.service.js';

const app = buildApp();

test.after(async () => {
  await app.close();
  await prisma.$disconnect();
});

// Contrato evoluído no Dia 11.3 (antes: relatório puro do núcleo).
const RUN_CONTRACT_KEYS = [
  'runId',
  'status',
  'trigger',
  'startedAt',
  'finishedAt',
  'durationMs',
  'tripCount',
  'monitorableCount',
  'skippedCount',
  'okCount',
  'failedCount',
  'opportunityCount',
  'items',
].sort();

async function createTrip(overrides = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/trips',
    payload: {
      name: 'Teste monitoramento',
      destination: 'Lisboa, Portugal',
      startDate: '2027-06-10',
      endDate: '2027-06-20',
      ...overrides,
    },
  });

  assert.equal(res.statusCode, 201);
  return res.json();
}

test('POST /monitoring/runs executa o ciclo PERSISTINDO o registro (runId, status COMPLETED, counts e itens)', async (t) => {
  const active = await createTrip({ name: 'Monitoravel' });
  const inactive = await createTrip({ name: 'Inativa', startDate: '2026-01-15' });
  const createdRunIds = [];

  t.after(async () => {
    await app.inject({ method: 'DELETE', url: `/trips/${active.id}` });
    await app.inject({ method: 'DELETE', url: `/trips/${inactive.id}` });
    await prisma.monitoringRun.deleteMany({ where: { id: { in: createdRunIds } } });
  });

  const res = await app.inject({ method: 'POST', url: '/monitoring/runs' });

  assert.equal(res.statusCode, 200);
  const body = res.json();
  createdRunIds.push(body.runId);

  // Contrato de persistência: registro com identidade e janela temporal.
  assert.deepEqual(Object.keys(body).sort(), RUN_CONTRACT_KEYS);
  assert.equal(body.status, 'COMPLETED');
  assert.equal(body.trigger, 'MANUAL');
  assert.ok(body.startedAt);
  assert.ok(body.finishedAt);
  assert.ok(body.durationMs >= 0);

  // Viagem monitorável: presença e conteúdo.
  const activeItem = body.items.find((item) => item.tripId === active.id);
  assert.equal(activeItem.status, 'OK');
  assert.equal(activeItem.opportunityCount, 0); // honesto: ofertas SIMULATED
  assert.ok(activeItem.evaluatedOfferCount >= 3, 'oportunidades executada? evaluatedOfferCount >= 3');
  assert.equal(activeItem.containsSimulatedData, true);

  // Viagem inativa: pulada com motivo de vocabulário fechado do núcleo.
  const inactiveItem = body.items.find((item) => item.tripId === inactive.id);
  assert.equal(inactiveItem.status, 'SKIPPED');
  assert.equal(inactiveItem.reason, 'TRIP_NOT_ACTIVE');

  // Contabilização fechada (invariante absoluta).
  assert.equal(body.okCount + body.failedCount, body.monitorableCount);
  assert.equal(body.monitorableCount + body.skippedCount, body.tripCount);
  assert.ok(body.tripCount >= 2);
  assert.ok(body.monitorableCount >= 1);

  // Persistência REAL: a linha existe, reflete a resposta e não é RUNNING.
  const row = await prisma.monitoringRun.findUnique({ where: { id: body.runId } });
  assert.ok(row, 'run persistida');
  assert.equal(row.status, 'COMPLETED');
  assert.ok(row.finishedAt);
  assert.deepEqual(row.tripCount, body.tripCount);
  assert.deepEqual(row.monitorableCount, body.monitorableCount);
  assert.deepEqual(row.skippedCount, body.skippedCount);
  assert.deepEqual(row.okCount, body.okCount);
  assert.deepEqual(row.failedCount, body.failedCount);
  assert.deepEqual(row.opportunityCount, body.opportunityCount);
  assert.deepEqual(row.items, body.items);

  // Pesquisa REALMENTE executada: ofertas e observações criadas para a viagem.
  const offersInDb = await prisma.flightOffer.count({ where: { tripId: active.id } });
  const observationsInDb = await prisma.priceHistory.count({
    where: { flightOffer: { tripId: active.id } },
  });
  assert.ok(offersInDb >= 3);
  assert.equal(observationsInDb, offersInDb);
});

test('POST /monitoring/runs recusa querystring e body com propriedades (400); {} é aceito', async () => {
  const withQuery = await app.inject({ method: 'POST', url: '/monitoring/runs?force=1' });
  const withBody = await app.inject({
    method: 'POST',
    url: '/monitoring/runs',
    payload: { force: true },
  });
  const emptyBody = await app.inject({
    method: 'POST',
    url: '/monitoring/runs',
    headers: { 'content-type': 'application/json' },
    payload: {},
  });

  assert.equal(withQuery.statusCode, 400);
  assert.equal(withBody.statusCode, 400);
  assert.equal(emptyBody.statusCode, 200);
});

test('GET /monitoring/runs retorna histórico REAL em ordem decrescente e respeita limit', async (t) => {
  // Três execuções persistidas com startedAt espaçados (past timestamps
  // propositais: ordenação por started_at é o que o endpoint promete).
  const base = new Date('2027-05-01T00:00:00.000Z');
  const created = [];
  for (let i = 0; i < 3; i++) {
    const run = await prisma.monitoringRun.create({
      data: {
        status: 'COMPLETED',
        trigger: 'MANUAL',
        startedAt: new Date(base.getTime() + i * 60_000),
        finishedAt: new Date(base.getTime() + i * 60_000 + 5_000),
        durationMs: 5_000,
        tripCount: 1,
        monitorableCount: 1,
        skippedCount: 0,
        okCount: 1,
        failedCount: 0,
        opportunityCount: 0,
        items: [{ tripId: `hist-${i}`, status: 'OK' }],
      },
    });
    created.push(run);
  }

  t.after(async () => {
    await prisma.monitoringRun.deleteMany({ where: { id: { in: created.map((run) => run.id) } } });
  });

  const full = await app.inject({ method: 'GET', url: '/monitoring/runs' });
  assert.equal(full.statusCode, 200);
  const runs = full.json();

  assert.ok(Array.isArray(runs));
  // Minhas 3 execuções aparecem; entre elas, mais novas primeiro (historico
  // inteiro existe no banco; só a ORDEM das criadas aqui é determinística).
  const positions = created.map((run) => runs.findIndex((view) => view.runId === run.id));
  assert.ok(!positions.includes(-1), 'todas as criadas no histórico');
  assert.ok(positions[2] < positions[1], 'created[2] (mais nova) antes de created[1]');
  assert.ok(positions[1] < positions[0], 'created[1] antes de created[0] (mais antiga)');

  // Format: primeiro item tem o contrato completo.
  const mine = runs.find((view) => view.runId === created[2].id);
  assert.deepEqual(Object.keys(mine).sort(), RUN_CONTRACT_KEYS);
  assert.equal(mine.status, 'COMPLETED');
  assert.deepEqual(mine.items, [{ tripId: 'hist-2', status: 'OK' }]);

  // limit=2 → apenas as 2 mais recentes (ordenadas).
  const limited = await app.inject({ method: 'GET', url: '/monitoring/runs?limit=2' });
  assert.equal(limited.statusCode, 200);
  const two = limited.json();
  assert.equal(two.length, 2);
  assert.equal(two[0].runId, created[2].id);
  assert.equal(two[1].runId, created[1].id);
});

test('GET /monitoring/runs valida limit (400 fora de 1–100)', async () => {
  const tooSmall = await app.inject({ method: 'GET', url: '/monitoring/runs?limit=0' });
  const tooBig = await app.inject({ method: 'GET', url: '/monitoring/runs?limit=101' });
  const notNumber = await app.inject({ method: 'GET', url: '/monitoring/runs?limit=abc' });
  const unknown = await app.inject({ method: 'GET', url: '/monitoring/runs?force=1' });

  assert.equal(tooSmall.statusCode, 400);
  assert.equal(tooBig.statusCode, 400);
  assert.equal(notNumber.statusCode, 400);
  assert.equal(unknown.statusCode, 400);
});

test('árbitro do banco: RUNNING alheio (outro processo) → POST 409, sem segundas linhas RUNNING', async (t) => {
  // Simula outro processo dono: linha RUNNING criada diretamente no banco.
  const foreign = await prisma.monitoringRun.create({
    data: { status: 'RUNNING', trigger: 'MANUAL', items: [] },
  });

  t.after(async () => {
    await prisma.monitoringRun.deleteMany({ where: { id: foreign.id } });
  });

  const res = await app.inject({ method: 'POST', url: '/monitoring/runs' });

  assert.equal(res.statusCode, 409);
  assert.match(res.json().message, /em andamento/);

  // Só a linha do "outro processo" existe: segunda tentativa não criou nada.
  const runningRows = await prisma.monitoringRun.count({ where: { status: 'RUNNING' } });
  assert.equal(runningRows, 1);
});

test('duas execuções simultâneas: 200 para a primeira, 409 para a segunda', async (t) => {
  const trip = await createTrip({ name: 'Concorrencia' });
  const createdRunIds = [];

  t.after(async () => {
    await app.inject({ method: 'DELETE', url: `/trips/${trip.id}` });
    await prisma.monitoringRun.deleteMany({ where: { id: { in: createdRunIds } } });
  });

  const [first, second] = await Promise.all([
    app.inject({ method: 'POST', url: '/monitoring/runs' }),
    app.inject({ method: 'POST', url: '/monitoring/runs' }),
  ]);

  const statuses = [first.statusCode, second.statusCode].sort();

  // A ordem depende de qual handler chega primeiro ao lock; o par é fixo.
  assert.deepEqual(statuses, [200, 409]);

  const conflict = [first, second].find((res) => res.statusCode === 409);
  assert.match(conflict.json().message, /em andamento/);

  for (const res of [first, second]) {
    if (res.statusCode === 200) {
      createdRunIds.push(res.json().runId);
    }
  }

  // O lock foi liberado no finally: a próxima execução é aceita.
  const after = await app.inject({ method: 'POST', url: '/monitoring/runs' });
  assert.equal(after.statusCode, 200);
  createdRunIds.push(after.json().runId);
});

// ---------- Níveis de service: falhas forçadas por injeção (ciclo sem banco; a LINHA é persistida) ----------

const NOW = new Date('2027-05-01T12:00:00.000Z');

function plainTrip(id, startDate = '2027-06-10') {
  return {
    id,
    name: `viagem-${id}`,
    destination: 'Lisboa, Portugal',
    startDate,
    endDate: '2027-07-01',
  };
}

function noopOpportunities() {
  return {
    summary: { evaluatedOfferCount: 0, containsSimulatedData: false },
    opportunities: [],
  };
}

test('service: falha de pesquisa de UMA viagem não derruba as outras (itens FAILED, run COMPLETED)', async (t) => {
  const search = async (tripId) => {
    if (tripId === 't-quebra') {
      throw new Error('pesquisa quebrou');
    }
    return { offers: [] };
  };

  const view = await startMonitoringRun({
    now: NOW,
    trips: [plainTrip('t-quebra'), plainTrip('t-ok')],
    search,
    opportunities: noopOpportunities,
  });

  t.after(async () => {
    await prisma.monitoringRun.deleteMany({ where: { id: view.runId } });
  });

  // Falha isolada continua sendo DADO do relatório (não status da execução).
  assert.equal(view.status, MONITORING_RUN_STATUS.COMPLETED);
  assert.equal(view.okCount, 1);
  assert.equal(view.failedCount, 1);
  assert.equal(view.monitorableCount, 2);
  assert.equal(view.items[0].status, 'FAILED');
  assert.equal(view.items[0].stage, 'SEARCH');
  assert.equal(view.items[0].error, 'pesquisa quebrou');
  assert.equal(view.items[1].status, 'OK');
});

test('service: ciclo ABORTADO finaliza a run como FAILED — nenhum RUNNING órfão', async (t) => {
  // Falha FORA do isolamento por viagem: entrada do ciclo inválida gera
  // TypeError no núcleo (programador/ambiente), não item FAILED.
  await assert.rejects(
    () =>
      startMonitoringRun({
        now: NOW,
        trips: 'nao-e-um-array',
        search: async () => ({ offers: [] }),
        opportunities: noopOpportunities,
      }),
    TypeError
  );

  // A execução abortada foi registrada como FAILED (não RUNNING órfão).
  const failedRun = await prisma.monitoringRun.findFirst({
    where: { status: 'FAILED' },
    orderBy: { startedAt: 'desc' },
  });
  assert.ok(failedRun, 'run FAILED persistida');
  assert.ok(failedRun.finishedAt, 'finalizada');
  assert.ok(failedRun.durationMs !== null);

  const orphan = await prisma.monitoringRun.count({ where: { status: 'RUNNING' } });
  assert.equal(orphan, 0);

  t.after(async () => {
    await prisma.monitoringRun.deleteMany({ where: { id: failedRun.id } });
  });

  // Lock liberado pelo finally: a próxima execução é aceita.
  const view = await startMonitoringRun({
    now: NOW,
    trips: [plainTrip('t-2')],
    search: async () => ({ offers: [] }),
    opportunities: noopOpportunities,
  });
  assert.equal(view.okCount, 1);
  assert.equal(view.items[0].tripId, 't-2');

  t.after(async () => {
    await prisma.monitoringRun.deleteMany({ where: { id: view.runId } });
  });
});

test('service: execução concorrente direta respeita o lock in-process', async (t) => {
  const cycles = [];
  const search = async () => {
    cycles.push(1);
    return { offers: [] };
  };

  const [a, b] = await Promise.allSettled([
    startMonitoringRun({ now: NOW, trips: [plainTrip('t-a')], search, opportunities: noopOpportunities }),
    startMonitoringRun({ now: NOW, trips: [plainTrip('t-b')], search, opportunities: noopOpportunities }),
  ]);

  const fulfilled = [a, b].filter((outcome) => outcome.status === 'fulfilled');
  const rejected = [a, b].filter((outcome) => outcome.status === 'rejected');

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason.message, /em andamento/);

  // Exatamente UMA pesquisa rodou (o ciclo rejeitado nem começou a pesquisar).
  assert.equal(cycles.length, 1);

  t.after(async () => {
    await prisma.monitoringRun.deleteMany({ where: { id: fulfilled[0].value.runId } });
  });
});

test('service: trigger fora do vocabulário falha ALTO antes de tocar o banco', async () => {
  const before = await prisma.monitoringRun.count();

  await assert.rejects(
    () =>
      startMonitoringRun({
        now: NOW,
        trigger: 'NAO-EXISTE',
        trips: [plainTrip('t-x')],
        search: async () => ({ offers: [] }),
        opportunities: noopOpportunities,
      }),
    TypeError
  );

  assert.equal(await prisma.monitoringRun.count(), before, 'nenhuma linha criada');
});
