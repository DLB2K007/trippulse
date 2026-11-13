// Testes do endpoint de análise consolidada de preços por viagem.
// Requer o banco de dados ativo (docker compose up -d).
//
// As ofertas usadas aqui são FIXTURES determinísticas, criadas direto no banco
// com preços e datas fixos. O classificador NÃO é validado com os preços
// aleatórios do provedor simulado: aqueles são ruído independente e existem
// apenas para exercitar o fluxo de pesquisa/persistência.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildApp } from '../apps/api/src/app.js';
import { prisma } from '../apps/api/src/config/prisma.js';

const app = buildApp();

const DEPARTURE = '2027-05-10T10:00:00.000Z';
const ARRIVAL = '2027-05-10T22:00:00.000Z';

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

function observation(total, observedAt, currency = 'BRL', extra = {}) {
  return { total, currency, base: total, taxes: 0, observedAt: new Date(observedAt), ...extra };
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

function getAnalysis(tripId) {
  return app.inject({ method: 'GET', url: `/trips/${tripId}/analysis` });
}

// Histórico de 3 observações anteriores (total de 4) com mediana 1000.
const HISTORY_1000 = [
  observation(1100, '2027-01-01T10:00:00.000Z'),
  observation(900, '2027-01-02T10:00:00.000Z'),
  observation(1000, '2027-01-03T10:00:00.000Z'),
];

test('responde 400 para UUID invalido, 404 para viagem inexistente e rejeita querystring', async () => {
  const badId = await app.inject({ method: 'GET', url: '/trips/nao-um-uuid/analysis' });
  assert.equal(badId.statusCode, 400);

  const notFound = await app.inject({
    method: 'GET',
    url: '/trips/00000000-0000-4100-8b0e-000000000000/analysis',
  });
  assert.equal(notFound.statusCode, 404);
  assert.equal(notFound.json().message, 'Viagem não encontrada.');

  const trip = await prisma.trip.create({
    data: {
      name: 'Teste parâmetros',
      destination: 'Lisboa, Portugal',
      startDate: new Date('2027-05-10'),
      endDate: new Date('2027-05-20'),
    },
  });

  try {
    const withQuery = await app.inject({
      method: 'GET',
      url: `/trips/${trip.id}/analysis?minPreviousObservations=1`,
    });
    assert.equal(withQuery.statusCode, 400);
  } finally {
    await prisma.trip.delete({ where: { id: trip.id } });
  }
});

test('viagem sem ofertas devolve analise vazia e sem dados simulados', async (t) => {
  const trip = await createTrip(t, 'Teste análise vazia');

  const res = await getAnalysis(trip.id);

  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /application\/json/);

  const body = res.json();

  assert.deepEqual(body.trip, {
    id: trip.id,
    name: 'Teste análise vazia',
    destination: 'Lisboa, Portugal',
    startDate: '2027-05-10',
    endDate: '2027-05-20',
  });
  assert.deepEqual(body.summary, {
    offerCount: 0,
    classifiedOfferCount: 0,
    classificationCounts: {
      INSUFFICIENT_DATA: 0,
      OPPORTUNITY: 0,
      FAIR: 0,
      ABOVE_HISTORY: 0,
    },
    currencies: [],
    mixedCurrencyOfferCount: 0,
  });
  assert.equal(body.dataQuality.containsSimulatedData, false);
  assert.equal(body.dataQuality.observationCount, 0);
  assert.deepEqual(body.offers, []);
  assert.equal(body.criteria.minPreviousObservations, 3);
  assert.ok(body.limitations.length > 0);
});

test('ofertas sem historico suficiente ficam INSUFFICIENT_DATA com motivo explicito', async (t) => {
  const trip = await createTrip(t, 'Teste análise insuficiente');

  // 2 observações: 1 anterior, abaixo do mínimo de 3.
  await createOffer(trip.id, {
    flightNumber: 'CURTA',
    observations: [observation(999, '2027-01-01T10:00:00.000Z'), observation(1000, '2027-01-02T10:00:00.000Z')],
  });

  // Oferta sem nenhuma observação.
  await createOffer(trip.id, { flightNumber: 'SEMHIST', observations: [] });

  // Oferta com uma observação inválida (total zero) e uma válida: a inválida é
  // descartada e contada, mas não vira preço.
  await createOffer(trip.id, {
    flightNumber: 'INVALIDA',
    observations: [observation(0, '2027-01-01T10:00:00.000Z'), observation(500, '2027-01-02T10:00:00.000Z')],
  });

  const res = await getAnalysis(trip.id);
  assert.equal(res.statusCode, 200);

  const body = res.json();
  const byFlightNumber = Object.fromEntries(
    body.offers.map((offer) => [offer.flight.flightNumber, offer])
  );

  assert.equal(byFlightNumber.CURTA.analysis.classification, 'INSUFFICIENT_DATA');
  assert.equal(byFlightNumber.CURTA.analysis.classificationReason, 'NOT_ENOUGH_PREVIOUS_OBSERVATIONS');
  assert.equal(byFlightNumber.CURTA.explanation.reason, 'NOT_ENOUGH_PREVIOUS_OBSERVATIONS');
  assert.equal(byFlightNumber.CURTA.analysis.observationCount, 2);
  assert.equal(byFlightNumber.CURTA.analysis.historicalMedian.sampleSize, 1);
  assert.equal(byFlightNumber.CURTA.explanation.reference.total, 999);

  assert.equal(byFlightNumber.SEMHIST.analysis.classificationReason, 'NO_CURRENT_OBSERVATION');
  assert.equal(byFlightNumber.SEMHIST.analysis.observationCount, 0);
  assert.equal(byFlightNumber.SEMHIST.explanation.reference, null);

  assert.equal(byFlightNumber.INVALIDA.analysis.observationCount, 1);
  assert.equal(byFlightNumber.INVALIDA.analysis.invalidObservationCount, 1);

  assert.equal(body.summary.classificationCounts.INSUFFICIENT_DATA, 3);
  assert.equal(body.summary.classifiedOfferCount, 0);
  assert.equal(body.dataQuality.observationCount, 3);
  assert.equal(body.dataQuality.invalidObservationCount, 1);
  assert.equal(body.dataQuality.offersWithEnoughHistory, 0);
  assert.equal(body.dataQuality.offersWithoutEnoughHistory, 3);
});

test('classifica OPPORTUNITY, FAIR e ABOVE_HISTORY com historico suficiente', async (t) => {
  const trip = await createTrip(t, 'Teste classificações');

  await createOffer(trip.id, {
    flightNumber: 'OPORT',
    observations: [...HISTORY_1000, observation(800, '2027-01-04T10:00:00.000Z')],
  });

  await createOffer(trip.id, {
    flightNumber: 'JUSTO',
    observations: [...HISTORY_1000, observation(1015, '2027-01-04T10:00:00.000Z')],
  });

  await createOffer(trip.id, {
    flightNumber: 'CARO',
    observations: [...HISTORY_1000, observation(1150, '2027-01-04T10:00:00.000Z')],
  });

  const res = await getAnalysis(trip.id);
  assert.equal(res.statusCode, 200);

  const body = res.json();
  const byFlightNumber = Object.fromEntries(
    body.offers.map((offer) => [offer.flight.flightNumber, offer])
  );

  assert.equal(byFlightNumber.OPORT.analysis.classification, 'OPPORTUNITY');
  assert.equal(byFlightNumber.OPORT.analysis.variationVsMedianPct, -20);
  assert.equal(byFlightNumber.OPORT.analysis.trend, 'DROPPED');
  assert.equal(byFlightNumber.OPORT.explanation.reason, 'BELOW_MEDIAN_BY_THRESHOLD');
  assert.deepEqual(byFlightNumber.OPORT.explanation.reference, {
    type: 'HISTORICAL_MEDIAN',
    total: 1000,
    currency: 'BRL',
    sampleSize: 3,
  });

  assert.equal(byFlightNumber.JUSTO.analysis.classification, 'FAIR');
  assert.equal(byFlightNumber.JUSTO.analysis.variationVsMedianPct, 1.5);
  assert.equal(byFlightNumber.JUSTO.explanation.reason, 'WITHIN_MEDIAN_RANGE');

  assert.equal(byFlightNumber.CARO.analysis.classification, 'ABOVE_HISTORY');
  assert.equal(byFlightNumber.CARO.analysis.variationVsMedianPct, 15);
  assert.equal(byFlightNumber.CARO.explanation.reason, 'ABOVE_MEDIAN_BY_THRESHOLD');

  assert.equal(body.summary.offerCount, 3);
  assert.equal(body.summary.classifiedOfferCount, 3);
  assert.deepEqual(body.summary.classificationCounts, {
    INSUFFICIENT_DATA: 0,
    OPPORTUNITY: 1,
    FAIR: 1,
    ABOVE_HISTORY: 1,
  });
  assert.deepEqual(body.summary.currencies, ['BRL']);
  assert.equal(body.dataQuality.offersWithEnoughHistory, 3);

  // Oportunidade descreve o passado da própria oferta, nunca uma recomendação.
  assert.ok(body.limitations.some((note) => note.includes('Não é recomendação de compra')));
});

test('serie empatada usa sequence interna e preserva base/taxes nulos na analise', async (t) => {
  const trip = await createTrip(t, 'Teste empate e decomposição opcional');

  await createOffer(trip.id, {
    flightNumber: 'EMPATE',
    observations: [
      observation(1000, '2027-01-01T10:00:00.000Z', 'BRL', { base: null, taxes: null }),
      observation(1000, '2027-01-02T10:00:00.000Z', 'BRL', { base: null, taxes: 100 }),
      observation(1000, '2027-01-03T10:00:00.000Z', 'BRL', { base: 900, taxes: null }),
      observation(800, '2027-01-03T10:00:00.000Z', 'BRL', { base: null, taxes: null }),
    ],
  });

  const res = await getAnalysis(trip.id);
  assert.equal(res.statusCode, 200);

  const body = res.json();
  const analysis = body.offers[0].analysis;

  assert.equal(analysis.observationCount, 4);
  assert.equal(analysis.current.total, 800);
  assert.equal(analysis.current.observedAt, '2027-01-03T10:00:00.000Z');
  assert.equal(analysis.previous.total, 1000);
  assert.equal(analysis.trend, 'DROPPED');
  assert.equal(analysis.classification, 'OPPORTUNITY');
  assert.equal(JSON.stringify(body).includes('"sequence"'), false);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(body)));
});

test('identifica dados simulados e nao os confunde com reais', async (t) => {
  const trip = await createTrip(t, 'Teste dados simulados');

  await createOffer(trip.id, {
    flightNumber: 'SIM1',
    dataClassification: 'SIMULATED',
    observations: [...HISTORY_1000, observation(800, '2027-01-04T10:00:00.000Z')],
  });

  await createOffer(trip.id, {
    flightNumber: 'REAL1',
    dataClassification: 'REAL',
    observations: [...HISTORY_1000, observation(1015, '2027-01-04T10:00:00.000Z')],
  });

  // Classificação inesperada no banco: não pode ser contada como real.
  await createOffer(trip.id, {
    flightNumber: 'DESCONHECIDA',
    dataClassification: 'UNKNOWN',
    observations: [...HISTORY_1000, observation(1015, '2027-01-04T10:00:00.000Z')],
  });

  const res = await getAnalysis(trip.id);
  const body = res.json();

  const simulated = body.offers.find((offer) => offer.flight.flightNumber === 'SIM1');
  const real = body.offers.find((offer) => offer.flight.flightNumber === 'REAL1');
  const unknown = body.offers.find((offer) => offer.flight.flightNumber === 'DESCONHECIDA');

  assert.equal(simulated.dataClassification, 'SIMULATED');
  assert.equal(simulated.simulated, true);
  assert.equal(real.dataClassification, 'REAL');
  assert.equal(real.simulated, false);
  assert.equal(unknown.simulated, false);

  assert.equal(body.dataQuality.simulatedOfferCount, 1);
  assert.equal(body.dataQuality.realOfferCount, 1);
  assert.equal(body.dataQuality.unclassifiedOfferCount, 1);
  assert.equal(body.dataQuality.containsSimulatedData, true);
  assert.ok(body.limitations.some((note) => note.includes('provedor simulado')));
});

test('nao compara moedas diferentes e apenas contabiliza a mistura', async (t) => {
  const trip = await createTrip(t, 'Teste moeda mista');

  await createOffer(trip.id, {
    flightNumber: 'MISTA',
    observations: [
      observation(1000, '2027-01-01T10:00:00.000Z'),
      observation(1000, '2027-01-02T10:00:00.000Z', 'USD'),
      observation(1000, '2027-01-03T10:00:00.000Z'),
      observation(900, '2027-01-04T10:00:00.000Z', 'USD'),
    ],
  });

  const body = (await getAnalysis(trip.id)).json();
  const offer = body.offers[0];

  assert.equal(offer.analysis.classification, 'INSUFFICIENT_DATA');
  assert.equal(offer.analysis.classificationReason, 'MIXED_CURRENCY');
  assert.equal(offer.analysis.currency, null);
  assert.equal(offer.analysis.mixedCurrency, true);
  assert.equal(offer.analysis.historicalMedian, null);
  assert.equal(offer.analysis.historical.mean, null);
  assert.equal(offer.explanation.reason, 'MIXED_CURRENCY');
  assert.equal(offer.explanation.reference, null);

  assert.equal(body.summary.mixedCurrencyOfferCount, 1);
  assert.deepEqual(body.summary.currencies, []);
});

test('analise e repetivel e nao escreve no banco', async (t) => {
  const trip = await createTrip(t, 'Teste repetibilidade');

  await createOffer(trip.id, {
    flightNumber: 'AAA111',
    observations: [...HISTORY_1000, observation(800, '2027-01-04T10:00:00.000Z')],
  });
  await createOffer(trip.id, {
    flightNumber: 'BBB222',
    observations: [...HISTORY_1000, observation(1150, '2027-01-04T10:00:00.000Z')],
  });

  const before = await prisma.priceHistory.count({
    where: { flightOffer: { tripId: trip.id } },
  });

  const first = await getAnalysis(trip.id);
  const second = await getAnalysis(trip.id);

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.deepEqual(first.json(), second.json());

  const after = await prisma.priceHistory.count({
    where: { flightOffer: { tripId: trip.id } },
  });
  assert.equal(after, before);

  const offersAfter = await prisma.flightOffer.count({ where: { tripId: trip.id } });
  assert.equal(offersAfter, 2);

  // O endpoint de histórico existente continua com o contrato anterior intocado.
  const history = await app.inject({ method: 'GET', url: `/trips/${trip.id}/offers/history` });
  assert.equal(history.statusCode, 200);
  assert.deepEqual(Object.keys(history.json()).sort(), ['offerCount', 'offers', 'tripId']);
  assert.equal(history.json().offerCount, 2);
});
