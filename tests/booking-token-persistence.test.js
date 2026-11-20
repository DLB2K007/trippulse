// Regressão específica do `booking_token` — persistência e resposta HTTP.
//
// Requer o banco de dados ativo (docker compose up -d), como api.test.js e
// offers-service.test.js.
//
// COBERTURA E LIMITE CONHECIDO:
// - o adaptador + normalizador são provados em booking-token.test.js: o
//   `booking_token` do raw não chega à oferta normalizada.
// - aqui provamos o outro lado da fronteira: a persistência grava apenas as
//   colunas explícitas do contrato — propriedades extras no objeto da oferta
//   (inclusive `booking_token` e estruturas `return`/`outbound` do provedor)
//   não são persistidas —, e a resposta HTTP expõe somente os campos do
//   schema fechado.
// - não é possível levar o adaptador REAL até o endpoint: a barreira bloqueia
//   ofertas REAL antes da chamada externa. A prova é feita nas duas fronteiras
//   acima, que juntas cobrem o caminho resposta externa → raw → normalização →
//   resposta HTTP → persistência.
//
// Execução: node --test

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildApp } from '../apps/api/src/app.js';
import { prisma } from '../apps/api/src/config/prisma.js';
import {
  buildOfferExternalKey,
  persistOfferSnapshot,
} from '../apps/api/src/modules/offers/offers.service.js';

const app = buildApp();

// Sentinela exclusiva: se aparecer na resposta ou no banco, o teste falha.
const BOOKING_TOKEN_SENTINEL = 'TEST_BOOKING_TOKEN_DO_NOT_LEAK';

// Campos públicos de uma oferta na resposta de pesquisa (schema
// `FlightOfferSearch` + `history`).
const SEARCH_OFFER_KEYS = [
  'dataClassification',
  'dates',
  'flight',
  'history',
  'isSimulated',
  'price',
  'provider',
  'relatedQuery',
  'route',
  'type',
].sort();

// Oferta SIMULATED válida para o schema (baggagePieces/refundable preenchidos)
// + campos internos do provedor que NÃO fazem parte do contrato persistido.
const OFFER_WITH_TOKEN = {
  provider: 'serpapi',
  isSimulated: true,
  dataClassification: 'SIMULATED',
  type: 'flight',
  route: { origin: 'GRU', destination: 'LIS' },
  dates: { departureDate: '2027-03-10', arrivalDate: '2027-03-10' },
  flight: {
    airline: 'Fake Air',
    flightNumber: 'FA100',
    stops: 0,
    cabinClass: 'ECONOMY',
    baggagePieces: 0,
    refundable: false,
  },
  price: { currency: 'BRL', total: 2100, base: null, taxes: null },
  relatedQuery: {
    origin: 'São Paulo, SP, Brasil',
    destination: 'Lisboa, Portugal',
    departureDate: '2027-03-10',
    returnDate: '2027-03-20',
  },
  // Campos extras que o raw do provedor carrega e que NÃO devem ser gravados:
  booking_token: BOOKING_TOKEN_SENTINEL,
  outbound: { booking_token: BOOKING_TOKEN_SENTINEL },
  return: { booking_token: BOOKING_TOKEN_SENTINEL },
};

// Serialização tolerante a BigInt (price_history.sequence) para varrer TODAS
// as colunas persistidas.
function serialize(value) {
  return JSON.stringify(value, (_key, nested) =>
    typeof nested === 'bigint' ? nested.toString() : nested
  );
}

function assertNoSentinel(value, label) {
  const serialized = serialize(value);
  assert.ok(!serialized.includes(BOOKING_TOKEN_SENTINEL), `${label}: sentinela encontrada`);
  assert.ok(!serialized.includes('booking_token'), `${label}: campo booking_token presente`);
}

test.after(async () => {
  await app.close();
  await prisma.$disconnect();
});

// ------------------------------------------------ fronteira de persistência

test('persistOfferSnapshot ignora booking_token e estruturas do raw na oferta', async (t) => {
  const trip = await prisma.trip.create({
    data: {
      name: 'Regressão booking_token — persistência',
      origin: 'São Paulo, SP, Brasil',
      destination: 'Lisboa, Portugal',
      startDate: new Date('2027-09-01'),
      endDate: new Date('2027-09-10'),
    },
  });
  t.after(async () => {
    await prisma.trip.delete({ where: { id: trip.id } });
  });

  // Sanidade: a oferta entregue à persistência REALMENTE carrega a sentinela.
  assert.equal(OFFER_WITH_TOKEN.booking_token, BOOKING_TOKEN_SENTINEL);

  const snapshot = await prisma.$transaction((tx) =>
    persistOfferSnapshot(trip.id, [OFFER_WITH_TOKEN], tx)
  );

  // O retorno do snapshot também não transporta o token.
  assert.equal(snapshot.size, 1);
  assertNoSentinel([...snapshot.entries()], 'snapshot retornado');

  // Varredura de TODAS as colunas gravadas nas duas tabelas do fluxo.
  const storedOffers = await prisma.flightOffer.findMany({ where: { tripId: trip.id } });
  const storedHistory = await prisma.priceHistory.findMany({
    where: { flightOffer: { tripId: trip.id } },
  });

  assert.equal(storedOffers.length, 1);
  assert.equal(storedHistory.length, 1);
  assertNoSentinel(storedOffers, 'flight_offers');
  assertNoSentinel(storedHistory, 'price_history');

  // Contraprova: os campos de negócio foram gravados de fato.
  assert.equal(storedOffers[0].externalKey, buildOfferExternalKey(OFFER_WITH_TOKEN));
  assert.equal(storedOffers[0].dataClassification, 'SIMULATED');
  assert.equal(storedOffers[0].baggagePieces, 0);
  assert.equal(storedOffers[0].refundable, false);
  assert.equal(storedHistory[0].total, 2100);
});

// ------------------------------------------------------- resposta HTTP

test('GET /trips/:tripId/flights expõe apenas o contrato — sem booking_token nem raw', async (t) => {
  const created = await app.inject({
    method: 'POST',
    url: '/trips',
    payload: {
      name: 'Regressão booking_token — HTTP',
      origin: 'São Paulo, SP, Brasil',
      destination: 'Lisboa, Portugal',
      startDate: '2027-09-01',
      endDate: '2027-09-10',
    },
  });
  assert.equal(created.statusCode, 201);
  const trip = created.json();
  t.after(async () => {
    await prisma.trip.delete({ where: { id: trip.id } });
  });

  const res = await app.inject({ method: 'GET', url: `/trips/${trip.id}/flights` });

  assert.equal(res.statusCode, 200);
  const body = res.json();

  assertNoSentinel(body, 'resposta HTTP');
  assert.ok(body.offers.length > 0);

  for (const offer of body.offers) {
    assert.deepEqual(Object.keys(offer).sort(), SEARCH_OFFER_KEYS);
    for (const forbidden of ['booking_token', 'departure_token', 'outbound', 'return', 'raw']) {
      assert.equal(forbidden in offer, false, `resposta HTTP expôs "${forbidden}"`);
    }
    assert.equal(offer.dataClassification, 'SIMULATED');
  }

  const storedOffers = await prisma.flightOffer.findMany({ where: { tripId: trip.id } });
  const storedHistory = await prisma.priceHistory.findMany({
    where: { flightOffer: { tripId: trip.id } },
  });
  assertNoSentinel(storedOffers, 'flight_offers (HTTP)');
  assertNoSentinel(storedHistory, 'price_history (HTTP)');
});
