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

test('limpeza: exclusao da viagem aplica cascade', async () => {
  const res = await app.inject({ method: 'DELETE', url: `/trips/${tripId}` });
  assert.equal(res.statusCode, 204);

  const offers = await prisma.flightOffer.count({ where: { tripId } });
  assert.equal(offers, 0);
});
