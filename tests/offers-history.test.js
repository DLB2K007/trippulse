// Testes do endpoint consolidado de histórico de ofertas.
// Requer o banco de dados ativo (docker compose up -d).

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildApp } from '../apps/api/src/app.js';
import { prisma } from '../apps/api/src/config/prisma.js';

const app = buildApp();

let tripId;

test.after(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function createTrip() {
  const res = await app.inject({
    method: 'POST',
    url: '/trips',
    payload: {
      name: 'Teste historico consolidado',
      origin: 'São Paulo, SP, Brasil',
      destination: 'Lisboa, Portugal',
      startDate: '2027-10-01',
      endDate: '2027-10-10',
    },
  });

  return res.json().id;
}

test('devolve 404 para viagem inexistente e 400 para id invalido', async () => {
  const notFound = await app.inject({
    method: 'GET',
    url: '/trips/00000000-0000-4100-8b0e-000000000000/offers/history',
  });
  assert.equal(notFound.statusCode, 404);

  const badId = await app.inject({ method: 'GET', url: '/trips/nao-um-uuid/offers/history' });
  assert.equal(badId.statusCode, 400);
});

test('retorna vazio antes de qualquer pesquisa', async () => {
  tripId = await createTrip();

  const res = await app.inject({ method: 'GET', url: `/trips/${tripId}/offers/history` });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { tripId, offerCount: 0, offers: [] });
});

test('consolida series apos duas pesquisas: 2 observacoes, best, trend, dedupe', async () => {
  // duas pesquisas (cada uma cria uma observacao por oferta)
  await app.inject({ method: 'GET', url: `/trips/${tripId}/flights` });
  const secondSearch = await app.inject({ method: 'GET', url: `/trips/${tripId}/flights` });
  const searchOffers = secondSearch.json().offers;

  const res = await app.inject({ method: 'GET', url: `/trips/${tripId}/offers/history` });

  assert.equal(res.statusCode, 200);
  const body = res.json();

  assert.equal(body.offerCount, searchOffers.length);
  assert.equal(body.offers.length, searchOffers.length);

  for (const offer of body.offers) {
    assert.equal(offer.dataClassification, 'SIMULATED');
    assert.equal(offer.observations.length, 2);
    assert.equal(offer.current.currency, 'BRL');
    assert.ok(offer.best.total <= offer.current.total);
    assert.ok(
      ['DROPPED', 'ROSE', 'UNCHANGED'].includes(offer.trend),
      `trend inesperado: ${offer.trend}`
    );

    // a observacao anterior de cada oferta e a current correspondente na resposta da 2a pesquisa
    const searchOffer = searchOffers.find((o) => o.flight.flightNumber === offer.flight.flightNumber);
    assert.equal(offer.current.total, searchOffer.price.total);
  }
});

test('ordem canonica entrega current/previous/best corretos, sem sequence e com base/taxes nulos', async (t) => {
  const trip = await createTrip();
  t.after(async () => {
    await prisma.trip.delete({ where: { id: trip } });
  });

  const t1 = new Date('2027-01-01T10:00:00.000Z');
  const t1Later = new Date('2027-01-01T12:00:00.000Z');
  const t2 = new Date('2027-01-02T10:00:00.000Z');

  const offer = await prisma.flightOffer.create({
    data: {
      tripId: trip,
      provider: 'simulated-airways',
      dataClassification: 'SIMULATED',
      type: 'flight',
      origin: 'GRU',
      destination: 'LIS',
      departureDate: new Date('2027-10-01T10:00:00.000Z'),
      arrivalDate: new Date('2027-10-01T22:00:00.000Z'),
      airline: 'Fixture Airways',
      flightNumber: 'ORDEM1',
      stops: 0,
      cabinClass: 'ECONOMY',
      baggagePieces: 0,
      refundable: false,
      externalKey: 'fixture|GRU|LIS|Fixture Airways|ORDEM1|2027-10-01T10:00:00.000Z',
      priceHistory: {
        create: [
          { currency: 'BRL', total: 1000, base: 900, taxes: 100, observedAt: t1 },
          { currency: 'BRL', total: 900, base: 800, taxes: null, observedAt: t2 },
          { currency: 'BRL', total: 900, base: null, taxes: 50, observedAt: t2 },
          // Inserida por último, mas com timestamp no meio da série.
          { currency: 'BRL', total: 950, base: null, taxes: null, observedAt: t1Later },
        ],
      },
    },
  });

  const res = await app.inject({ method: 'GET', url: `/trips/${trip}/offers/history` });
  assert.equal(res.statusCode, 200);

  const body = res.json();
  const history = body.offers.find((item) => item.id === offer.id);

  assert.deepEqual(
    history.observations.map((observation) => observation.observedAt),
    [t1.toISOString(), t1Later.toISOString(), t2.toISOString(), t2.toISOString()]
  );

  assert.equal(history.current.total, 900);
  assert.equal(history.current.observedAt, t2.toISOString());
  assert.equal(history.current.base, null);
  assert.equal(history.current.taxes, 50);

  assert.equal(history.previous.total, 900);
  assert.equal(history.previous.base, 800);
  assert.equal(history.previous.taxes, null);

  assert.equal(history.best.total, 900);
  assert.equal(history.best.observedAt, t2.toISOString());
  assert.equal(history.best.base, 800);
  assert.equal(history.trend, 'UNCHANGED');

  assert.equal(JSON.stringify(body).includes('"sequence"'), false);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(body)));
  assert.equal(history.current.sequence, undefined);

  const rows = await prisma.priceHistory.findMany({ where: { offerId: offer.id } });
  assert.equal(new Set(rows.map((row) => row.sequence)).size, 4);
});

test('limpeza: exclusao da viagem aplica cascade', async () => {
  const res = await app.inject({ method: 'DELETE', url: `/trips/${tripId}` });
  assert.equal(res.statusCode, 204);

  const offers = await prisma.flightOffer.count({ where: { tripId } });
  assert.equal(offers, 0);
});
