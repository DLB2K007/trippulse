// Testes de integração da execução MANUAL do monitoramento (Dia 11.2).
// HTTP via app.inject() contra o banco real + níveis de service com
// dependências injetadas (falhas forçadas sem banco).

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildApp } from '../apps/api/src/app.js';
import { prisma } from '../apps/api/src/config/prisma.js';
import { startMonitoringRun } from '../apps/api/src/modules/monitoring/monitoring.service.js';

const app = buildApp();

test.after(async () => {
  await app.close();
  await prisma.$disconnect();
});

const CYCLE_CONTRACT_KEYS = [
  'now',
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

test('POST /monitoring/runs executa o ciclo completo e responde contrato fechado', async (t) => {
  const active = await createTrip({ name: 'Monitoravel' });
  const inactive = await createTrip({ name: 'Inativa', startDate: '2026-01-15' });

  t.after(async () => {
    await app.inject({ method: 'DELETE', url: `/trips/${active.id}` });
    await app.inject({ method: 'DELETE', url: `/trips/${inactive.id}` });
  });

  const res = await app.inject({ method: 'POST', url: '/monitoring/runs' });

  assert.equal(res.statusCode, 200);
  const body = res.json();

  // Contrato do núcleo, sem id de execução: nenhuma persistência (Dia 11.3).
  assert.deepEqual(Object.keys(body).sort(), CYCLE_CONTRACT_KEYS);

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

  // Relativo a ISTO que este teste criou (outros arquivos rodam em paralelo
  // no mesmo banco; contagens absolutas do ciclo não são determináveis).
  assert.ok(body.tripCount >= 2);
  assert.ok(body.monitorableCount >= 1);

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

test('duas execuções simultâneas: 200 para a primeira, 409 para a segunda', async (t) => {
  const trip = await createTrip({ name: 'Concorrencia' });

  t.after(async () => {
    await app.inject({ method: 'DELETE', url: `/trips/${trip.id}` });
  });

  const [first, second] = await Promise.all([
    app.inject({ method: 'POST', url: '/monitoring/runs' }),
    app.inject({ method: 'POST', url: '/monitoring/runs' }),
  ]);

  const statuses = [first.statusCode, second.statusCode].sort();

  // A ordem depende de qual handler chega primeiro ao lock sync-shaped; o
  // par de resultados é determinístico.
  assert.deepEqual(statuses, [200, 409]);

  const conflict = [first, second].find((res) => res.statusCode === 409);
  assert.match(conflict.json().message, /em andamento/);

  // O lock foi liberado no finally: a próxima execução é aceita.
  const after = await app.inject({ method: 'POST', url: '/monitoring/runs' });
  assert.equal(after.statusCode, 200);
});

// ---------- Níveis de service: falhas forçadas por injeção (sem banco) ----------

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

test('service: falha de pesquisa de UMA viagem não derruba as outras (200, itens FAILED)', async () => {
  // Viagens são inertes (injeção): nada toca o banco nesta execução.
  const search = async (tripId) => {
    if (tripId === 't-quebra') {
      throw new Error('pesquisa quebrou');
    }
    return { offers: [] };
  };
  const opportunities = async () => ({
    summary: { evaluatedOfferCount: 2, containsSimulatedData: true },
    opportunities: [],
  });

  const report = await startMonitoringRun({
    now: NOW,
    trips: [plainTrip('t-quebra'), plainTrip('t-ok')],
    search,
    opportunities,
  });

  assert.equal(report.okCount, 1);
  assert.equal(report.failedCount, 1);
  assert.equal(report.monitorableCount, 2);
  assert.equal(report.items[0].status, 'FAILED');
  assert.equal(report.items[0].stage, 'SEARCH');
  assert.equal(report.items[0].error, 'pesquisa quebrou');
  assert.equal(report.items[1].status, 'OK');
});

test('service: falha INESPERADA ANTES do ciclo libera o lock (finally) — próxima execução passa', async () => {
  // Falha FORA do isolamento por viagem: entrada do ciclo inválida gera
  // TypeError no núcleo (programador/ambiente), não item FAILED.
  await assert.rejects(
    () =>
      startMonitoringRun({
        now: NOW,
        trips: 'nao-e-um-array',
        search: async () => ({ offers: [] }),
        opportunities: async () => ({
          summary: { evaluatedOfferCount: 0, containsSimulatedData: false },
          opportunities: [],
        }),
      }),
    TypeError
  );

  // Se o lock NÃO tivesse sido liberado pelo finally, esta chamada viraria 409.
  const report = await startMonitoringRun({
    now: NOW,
    trips: [plainTrip('t-2')],
    search: async () => ({ offers: [] }),
    opportunities: async () => ({
      summary: { evaluatedOfferCount: 0, containsSimulatedData: false },
      opportunities: [],
    }),
  });

  assert.equal(report.okCount, 1);
  assert.equal(report.items[0].tripId, 't-2');
});

test('service: execução concorrente direta respeita o lock in-process', async () => {
  const cycles = [];
  const search = async () => {
    cycles.push(1);
    return { offers: [] };
  };
  const opportunities = async () => ({
    summary: { evaluatedOfferCount: 0, containsSimulatedData: false },
    opportunities: [],
  });

  const [a, b] = await Promise.allSettled([
    startMonitoringRun({ now: NOW, trips: [plainTrip('t-a')], search, opportunities }),
    startMonitoringRun({ now: NOW, trips: [plainTrip('t-b')], search, opportunities }),
  ]);

  const fulfilled = [a, b].filter((outcome) => outcome.status === 'fulfilled');
  const rejected = [a, b].filter((outcome) => outcome.status === 'rejected');

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason.message, /em andamento/);

  // Exatamente UMA pesquisa rodou (o ciclo rejeitado nem começou a pesquisar).
  assert.equal(cycles.length, 1);
});
