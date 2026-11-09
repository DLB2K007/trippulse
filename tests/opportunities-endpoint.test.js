// Testes do endpoint GET /trips/:tripId/opportunities.
// Requer o banco de dados ativo (docker compose up -d).
//
// As ofertas são FIXTURES determinísticas criadas direto no banco, como no
// teste do endpoint de análise. As datas das observações são relativas ao
// relógio real porque a política aplica recência de 24 horas.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildApp } from '../apps/api/src/app.js';
import { prisma } from '../apps/api/src/config/prisma.js';
import { OPPORTUNITY_EXCLUSION } from '../apps/api/src/modules/opportunities/opportunity-policy.js';

const app = buildApp();

const DEPARTURE = '2027-05-10T10:00:00.000Z';
const ARRIVAL = '2027-05-10T22:00:00.000Z';

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 3_600_000);
}

test.after(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function createTrip(t, name) {
  const trip = await prisma.trip.create({
    data: {
      name,
      destination: 'Lisboa, Portugal',
      startDate: new Date('2027-05-10'),
      endDate: new Date('2027-05-20'),
    },
  });

  t.after(async () => {
    await prisma.trip.delete({ where: { id: trip.id } });
  });

  return trip;
}

function observation(total, observedAt, currency = 'BRL') {
  return { total, currency, base: total, taxes: 0, observedAt };
}

// 5 observações anteriores em pelo menos 2 dias distintos, mediana 1000.
function historicalObservations() {
  return [
    observation(1100, hoursAgo(72)),
    observation(900, hoursAgo(71)),
    observation(1000, hoursAgo(48)),
    observation(1050, hoursAgo(47)),
    observation(950, hoursAgo(24)),
  ];
}

async function createOffer(tripId, { flightNumber, observations, dataClassification = 'SIMULATED' }) {
  return prisma.flightOffer.create({
    data: {
      tripId,
      provider: dataClassification === 'SIMULATED' ? 'simulated-airways' : 'fixture-airlines',
      dataClassification,
      type: 'flight',
      origin: 'GRU',
      destination: 'LIS',
      departureDate: new Date(DEPARTURE),
      arrivalDate: new Date(ARRIVAL),
      airline: 'Fixture Airways',
      flightNumber,
      stops: 0,
      cabinClass: 'ECONOMY',
      baggagePieces: 0,
      refundable: false,
      externalKey: `fixture|GRU|LIS|Fixture Airways|${flightNumber}|${DEPARTURE}`,
      priceHistory: {
        create: observations.map(({ total, currency, base, taxes, observedAt }) => ({
          currency,
          total,
          base,
          taxes,
          observedAt,
        })),
      },
    },
  });
}

function getOpportunities(tripId) {
  return app.inject({ method: 'GET', url: `/trips/${tripId}/opportunities` });
}

test('responde 400 para UUID invalido, 404 para viagem inexistente e rejeita querystring', async () => {
  const badId = await app.inject({ method: 'GET', url: '/trips/nao-um-uuid/opportunities' });
  assert.equal(badId.statusCode, 400);
  assert.equal(
    badId.json().message,
    'O identificador da viagem precisa ser um UUID válido.'
  );

  const notFound = await app.inject({
    method: 'GET',
    url: '/trips/00000000-0000-4100-8b0e-000000000000/opportunities',
  });
  assert.equal(notFound.statusCode, 404);
  assert.equal(notFound.json().message, 'Viagem não encontrada.');

  const trip = await prisma.trip.create({
    data: {
      name: 'Teste parâmetros oportunidades',
      destination: 'Lisboa, Portugal',
      startDate: new Date('2027-05-10'),
      endDate: new Date('2027-05-20'),
    },
  });

  try {
    const withQuery = await app.inject({
      method: 'GET',
      url: `/trips/${trip.id}/opportunities?minHistoricalSampleSize=1`,
    });
    assert.equal(withQuery.statusCode, 400);

    const limit = await app.inject({
      method: 'GET',
      url: `/trips/${trip.id}/opportunities?limit=1`,
    });
    assert.equal(limit.statusCode, 400);
  } finally {
    await prisma.trip.delete({ where: { id: trip.id } });
  }
});

test('viagem sem ofertas devolve lista vazia, politica e contabilidade zerada', async (t) => {
  const trip = await createTrip(t, 'Teste oportunidades vazia');

  const res = await getOpportunities(trip.id);

  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /application\/json/);

  const body = res.json();

  assert.deepEqual(body.trip, {
    id: trip.id,
    name: 'Teste oportunidades vazia',
    destination: 'Lisboa, Portugal',
    startDate: '2027-05-10',
    endDate: '2027-05-20',
  });
  assert.deepEqual(body.summary, {
    evaluatedOfferCount: 0,
    opportunityCount: 0,
    excludedCount: 0,
    excludedByReason: Object.fromEntries(
      Object.values(OPPORTUNITY_EXCLUSION).map((reason) => [reason, 0])
    ),
    currencies: [],
    containsSimulatedData: false,
  });
  assert.deepEqual(body.opportunities, []);
  assert.deepEqual(body.excluded, []);
  assert.equal(body.policy.minHistoricalSampleSize, 5);
  assert.equal(body.policy.minDistinctObservationDays, 2);
  assert.equal(body.policy.maxObservationAgeHours, 24);
  assert.deepEqual(body.policy.minAbsoluteSavingCentsByCurrency, { BRL: 10000 });
  assert.ok(body.limitations.length > 0);
});

test('separa oportunidade real de oferta simulada e de oferta sem queda', async (t) => {
  const trip = await createTrip(t, 'Teste oportunidades mistas');

  await createOffer(trip.id, {
    flightNumber: 'OPORT',
    dataClassification: 'REAL',
    observations: [...historicalObservations(), observation(800, hoursAgo(1))],
  });

  await createOffer(trip.id, {
    flightNumber: 'SIM1',
    dataClassification: 'SIMULATED',
    observations: [...historicalObservations(), observation(800, hoursAgo(1))],
  });

  await createOffer(trip.id, {
    flightNumber: 'JUSTO',
    dataClassification: 'REAL',
    observations: [...historicalObservations(), observation(1015, hoursAgo(1))],
  });

  const res = await getOpportunities(trip.id);
  assert.equal(res.statusCode, 200);

  const body = res.json();

  assert.equal(body.summary.evaluatedOfferCount, 3);
  assert.equal(body.summary.opportunityCount, 1);
  assert.equal(body.summary.excludedCount, 2);
  assert.equal(body.summary.containsSimulatedData, true);
  assert.deepEqual(body.summary.currencies, ['BRL']);

  assert.equal(body.opportunities.length, 1);

  const opportunity = body.opportunities[0];

  assert.equal(opportunity.rank, 1);
  assert.equal(opportunity.flight.flightNumber, 'OPORT');
  assert.equal(opportunity.dataClassification, 'REAL');
  assert.deepEqual(opportunity.current, { total: 800, currency: 'BRL' });
  assert.deepEqual(opportunity.historicalDifference, { total: 200, currency: 'BRL' });
  assert.deepEqual(opportunity.reference, {
    type: 'HISTORICAL_MEDIAN',
    total: 1000,
    currency: 'BRL',
    sampleSize: 5,
  });
  assert.equal(opportunity.historicalSample.distinctObservationDays >= 2, true);
  assert.equal(opportunity.variationVsMedianPct, -20);

  assert.equal(body.summary.excludedByReason[OPPORTUNITY_EXCLUSION.SIMULATED_DATA], 1);
  assert.equal(body.summary.excludedByReason[OPPORTUNITY_EXCLUSION.NOT_BELOW_THRESHOLD], 1);
  assert.equal(
    body.summary.excludedByReason[OPPORTUNITY_EXCLUSION.BELOW_ABSOLUTE_FLOOR],
    0
  );

  const excludedFlights = Object.fromEntries(
    body.excluded.map((exclusion) => [exclusion.externalKey.split('|')[4], exclusion.reason])
  );
  assert.equal(excludedFlights.SIM1, OPPORTUNITY_EXCLUSION.SIMULATED_DATA);
  assert.equal(excludedFlights.JUSTO, OPPORTUNITY_EXCLUSION.NOT_BELOW_THRESHOLD);
});

test('com apenas dados simulados a lista fica vazia e o motivo fica explicito', async (t) => {
  const trip = await createTrip(t, 'Teste oportunidades simuladas');

  await createOffer(trip.id, {
    flightNumber: 'SIM1',
    observations: [...historicalObservations(), observation(800, hoursAgo(1))],
  });
  await createOffer(trip.id, {
    flightNumber: 'SIM2',
    observations: [...historicalObservations(), observation(800, hoursAgo(1))],
  });

  const body = (await getOpportunities(trip.id)).json();

  assert.deepEqual(body.opportunities, []);
  assert.equal(body.summary.evaluatedOfferCount, 2);
  assert.equal(body.summary.opportunityCount, 0);
  assert.equal(body.summary.excludedByReason[OPPORTUNITY_EXCLUSION.SIMULATED_DATA], 2);
  assert.ok(body.limitations.some((note) => note.includes('lista permanece vazia')));
});

test('e repetivel, nao escreve no banco e preserva os contratos existentes', async (t) => {
  const trip = await createTrip(t, 'Teste oportunidades repetibilidade');

  await createOffer(trip.id, {
    flightNumber: 'OPORT',
    dataClassification: 'REAL',
    observations: [...historicalObservations(), observation(800, hoursAgo(1))],
  });

  const before = await prisma.priceHistory.count({
    where: { flightOffer: { tripId: trip.id } },
  });

  const first = await getOpportunities(trip.id);
  const second = await getOpportunities(trip.id);

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.deepEqual(first.json(), second.json());

  const after = await prisma.priceHistory.count({
    where: { flightOffer: { tripId: trip.id } },
  });
  assert.equal(after, before);

  const offersAfter = await prisma.flightOffer.count({ where: { tripId: trip.id } });
  assert.equal(offersAfter, 1);

  // Contratos anteriores intactos.
  const analysis = await app.inject({ method: 'GET', url: `/trips/${trip.id}/analysis` });
  assert.equal(analysis.statusCode, 200);
  assert.deepEqual(Object.keys(analysis.json()).sort(), [
    'criteria',
    'dataQuality',
    'limitations',
    'offers',
    'summary',
    'trip',
  ]);

  const history = await app.inject({ method: 'GET', url: `/trips/${trip.id}/offers/history` });
  assert.equal(history.statusCode, 200);
  assert.deepEqual(Object.keys(history.json()).sort(), ['offerCount', 'offers', 'tripId']);
});
