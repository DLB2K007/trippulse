// Testes de integração da API TripPulse via app.inject() (sem abrir porta).
// Requer o banco de dados ativo (docker compose up -d).

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildApp } from '../apps/api/src/app.js';
import { prisma } from '../apps/api/src/config/prisma.js';

const app = buildApp();

// Estado compartilhado entre os testes deste arquivo (o contexto `t` de cada
// teste do node:test é isolado; variáveis de módulo são a forma correta aqui).
let createdTripId;
let flightTripId;

function validTripPayload(overrides = {}) {
  return {
    name: 'Teste API',
    destination: 'Lisboa, Portugal',
    startDate: '2027-09-01',
    endDate: '2027-09-10',
    ...overrides,
  };
}

test.after(async () => {
  await app.close();
  await prisma.$disconnect();
});

// ---------- /health ----------

test('GET /health responde com status ok e o nome do serviço', async () => {
  const res = await app.inject({ method: 'GET', url: '/health' });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: 'ok', service: 'trippulse-api' });
});

// ---------- CRUD de viagens ----------

test('POST /trips cria viagem e devolve 201 com id UUID', async (t) => {
  const res = await app.inject({
    method: 'POST',
    url: '/trips',
    payload: validTripPayload(),
  });

  assert.equal(res.statusCode, 201);
  const trip = res.json();

  assert.match(trip.id, /^[0-9a-f-]{36}$/);
  assert.equal(trip.name, 'Teste API');
  assert.equal(trip.startDate, '2027-09-01');
  assert.equal(trip.endDate, '2027-09-10');

  createdTripId = trip.id;
});

test('POST /trips rejeita payload com campo faltando (400 do schema)', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/trips',
    payload: { name: 'Sem datas' },
  });

  assert.equal(res.statusCode, 400);
});

test('POST /trips rejeita intervalo de datas invertido (400 de domínio)', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/trips',
    payload: validTripPayload({ startDate: '2027-09-10', endDate: '2027-09-01' }),
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.json().message, /endDate/);
});

test('GET /trips lista a viagem criada', async () => {
  const res = await app.inject({ method: 'GET', url: '/trips' });

  assert.equal(res.statusCode, 200);
  assert.ok(res.json().some((trip) => trip.id === createdTripId));
});

test('GET /trips/:id devolve 404 para UUID inexistente', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/trips/00000000-0000-4100-8b0e-000000000000',
  });

  assert.equal(res.statusCode, 404);
  assert.equal(res.json().message, 'Viagem não encontrada.');
});

test('GET /trips/:id devolve 400 para identificador não-UUID', async () => {
  const res = await app.inject({ method: 'GET', url: '/trips/nao-um-uuid' });

  assert.equal(res.statusCode, 400);
});

test('PUT /trips/:id atualiza a viagem', async () => {
  const res = await app.inject({
    method: 'PUT',
    url: `/trips/${createdTripId}`,
    payload: validTripPayload({
      name: 'Teste API atualizada',
      endDate: '2027-09-12',
    }),
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().name, 'Teste API atualizada');
  assert.equal(res.json().endDate, '2027-09-12');
});

test('DELETE /trips/:id devolve 204 e a viagem deixa de existir', async () => {
  const deleted = await app.inject({ method: 'DELETE', url: `/trips/${createdTripId}` });
  assert.equal(deleted.statusCode, 204);

  const after = await app.inject({ method: 'GET', url: `/trips/${createdTripId}` });
  assert.equal(after.statusCode, 404);
});

// ---------- Pesquisa de voos snapshot / histórico ----------

test('GET /trips/:tripId/flights persiste snapshot com ofertas SIMULATED', async (t) => {
  const created = await app.inject({
    method: 'POST',
    url: '/trips',
    payload: validTripPayload({ name: 'Teste pesquisa voos' }),
  });
  flightTripId = created.json().id;

  const res = await app.inject({ method: 'GET', url: `/trips/${flightTripId}/flights` });

  assert.equal(res.statusCode, 200);
  const body = res.json();

  assert.equal(body.simulated, true);
  assert.equal(body.persisted, true);
  assert.ok(body.offers.length >= 3);

  for (const offer of body.offers) {
    assert.equal(offer.isSimulated, true);
    assert.equal(offer.dataClassification, 'SIMULATED');
    assert.ok(offer.history);
    assert.equal(offer.history.trend, 'FIRST_OBSERVATION');
    assert.ok(offer.history.current.total > 0);
  }
});

test('segunda pesquisa compara com a anterior e nao duplica ofertas', async (t) => {
  const res = await app.inject({ method: 'GET', url: `/trips/${flightTripId}/flights` });

  assert.equal(res.statusCode, 200);
  const offers = res.json().offers;

  assert.ok(offers.every((offer) => ['DROPPED', 'ROSE', 'UNCHANGED'].includes(offer.history.trend)));
  assert.ok(offers.every((offer) => offer.history.best.total <= offer.history.current.total));

  const observationCount = await prisma.priceHistory.count({
    where: { flightOffer: { tripId: flightTripId } },
  });
  assert.equal(observationCount, offers.length * 2); // duas pesquisas, uma por oferta

  const offerCount = await prisma.flightOffer.count({ where: { tripId: flightTripId } });
  assert.equal(offerCount, offers.length); // identidade dedup e não aumenta
});

test('DELETE da viagem aplica cascade em ofertas e historicos', async () => {
  const deleted = await app.inject({ method: 'DELETE', url: `/trips/${flightTripId}` });
  assert.equal(deleted.statusCode, 204);

  const offers = await prisma.flightOffer.count({ where: { tripId: flightTripId } });
  const observations = await prisma.priceHistory.count({
    where: { flightOffer: { tripId: flightTripId } },
  });

  assert.equal(offers, 0);
  assert.equal(observations, 0);
});
