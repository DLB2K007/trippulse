// Testes de integração da API TripPulse via app.inject() (sem abrir porta).
// Requer o banco de dados ativo (docker compose up -d).

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildApp } from '../apps/api/src/app.js';
import { prisma } from '../apps/api/src/config/prisma.js';
import { searchFlightsForTrip } from '../apps/api/src/modules/flights/flights.service.js';

const app = buildApp();

// Estado compartilhado entre os testes deste arquivo (o contexto `t` de cada
// teste do node:test é isolado; variáveis de módulo são a forma correta aqui).
let createdTripId;
let flightTripId;

function validTripPayload(overrides = {}) {
  return {
    name: 'Teste API',
    origin: 'São Paulo, SP, Brasil',
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

// ---------- Regressões da auditoria do Dia 10.2 ----------

test('GET /trips/:tripId/flights rejeita identificador nao-UUID com 400 (nao 500 P2007)', async () => {
  const res = await app.inject({ method: 'GET', url: '/trips/nao-um-uuid/flights' });

  assert.equal(res.statusCode, 400);
  assert.equal(res.json().message, 'O identificador da viagem precisa ser um UUID válido.');
});

// ---------- Dia 11.6: origem, imutabilidade e concorrência ----------

test('POST /trips exige origem (400 sem origin ou origin vazia)', async () => {
  const { origin, ...semOrigin } = validTripPayload();

  const missing = await app.inject({ method: 'POST', url: '/trips', payload: semOrigin });
  assert.equal(missing.statusCode, 400);

  const blank = await app.inject({
    method: 'POST',
    url: '/trips',
    payload: { ...validTripPayload(), origin: '' },
  });
  assert.equal(blank.statusCode, 400);
});

test('POST 201 persiste e ecoa a origem; PUT sem origin no body preserva a armazenada', async (t) => {
  const created = await app.inject({
    method: 'POST',
    url: '/trips',
    payload: validTripPayload({ name: 'Origem ecoada' }),
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().origin, 'São Paulo, SP, Brasil');

  const trip = created.json();
  t.after(() => app.inject({ method: 'DELETE', url: `/trips/${trip.id}` }));

  const fetched = await app.inject({ method: 'GET', url: `/trips/${trip.id}` });
  assert.equal(fetched.json().origin, 'São Paulo, SP, Brasil');

  const kept = await app.inject({
    method: 'PUT',
    url: `/trips/${trip.id}`,
    payload: { name: 'Origem preservada', destination: 'Porto, Portugal', startDate: '2027-09-05', endDate: '2027-09-15' },
  });
  assert.equal(kept.statusCode, 200);
  assert.equal(kept.json().origin, 'São Paulo, SP, Brasil');
});

test('viagem sem ofertas aceita qualquer alteração, inclusive receber origem (legada)', async (t) => {
  const created = await app.inject({
    method: 'POST',
    url: '/trips',
    payload: validTripPayload({ name: 'PUT livre' }),
  });
  const trip = created.json();
  t.after(() => app.inject({ method: 'DELETE', url: `/trips/${trip.id}` }));

  const changed = await app.inject({
    method: 'PUT',
    url: `/trips/${trip.id}`,
    payload: { name: 'PUT livre 2', origin: 'Recife, PE, Brasil', destination: 'Porto, Portugal', startDate: '2027-09-05', endDate: '2027-09-15' },
  });
  assert.equal(changed.statusCode, 200);
  assert.equal(changed.json().origin, 'Recife, PE, Brasil');
});

test('viagem legada (sem origin, criada direto no banco) responde normalmente, mas não pesquisa (409)', async (t) => {
  const legacy = await prisma.trip.create({
    data: {
      name: 'Legada',
      destination: 'Lisboa, Portugal',
      startDate: new Date('2027-09-01'),
      endDate: new Date('2027-09-10'),
    },
  });
  t.after(() => prisma.trip.delete({ where: { id: legacy.id } }));

  const fetched = await app.inject({ method: 'GET', url: `/trips/${legacy.id}` });
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.json().origin, null);

  const search = await app.inject({ method: 'GET', url: `/trips/${legacy.id}/flights` });
  assert.equal(search.statusCode, 409);
  assert.match(search.json().message, /origem/);

  // Nenhuma oferta/observação foi criada pela tentativa bloqueada.
  assert.equal(await prisma.flightOffer.count({ where: { tripId: legacy.id } }), 0);
  assert.equal(await prisma.priceHistory.count({ where: { flightOffer: { tripId: legacy.id } } }), 0);
});

test('pesquisa usa a origem da viagem (query e rota das ofertas)', async (t) => {
  const created = await app.inject({
    method: 'POST',
    url: '/trips',
    payload: validTripPayload({ name: 'Pesquisa com origem' }),
  });
  const trip = created.json();
  t.after(() => app.inject({ method: 'DELETE', url: `/trips/${trip.id}` }));

  const res = await app.inject({ method: 'GET', url: `/trips/${trip.id}/flights` });
  assert.equal(res.statusCode, 200);

  const body = res.json();
  assert.equal(body.query.origin, 'São Paulo, SP, Brasil');
  // Derivação determinística do texto canônico (NÃO é IATA real):
  // "São Paulo, SP, Brasil" -> letras A-Z -> "SOPAULOSPBRASIL" -> "SOP".
  assert.ok(body.offers.length > 0);
  assert.equal(body.offers[0].route.origin, 'SOP');
  assert.equal(body.offers[0].dataClassification, 'SIMULATED');
});

test('após a primeira oferta, os campos de rota/período ficam imutáveis (409) e o nome continua editável', async (t) => {
  const created = await app.inject({
    method: 'POST',
    url: '/trips',
    payload: validTripPayload({ name: 'Imutável' }),
  });
  const trip = created.json();
  t.after(() => app.inject({ method: 'DELETE', url: `/trips/${trip.id}` }));

  const firstSearch = await app.inject({ method: 'GET', url: `/trips/${trip.id}/flights` });
  assert.equal(firstSearch.statusCode, 200);

  const frozenCases = {
    origin: 'Recife, PE, Brasil',
    destination: 'Porto, Portugal',
    startDate: '2027-09-05',
    endDate: '2027-09-15',
  };
  for (const [field, value] of Object.entries(frozenCases)) {
    const res = await app.inject({
      method: 'PUT',
      url: `/trips/${trip.id}`,
      payload: validTripPayload({ name: 'Tentativa de alterar' , [field]: value }),
    });
    assert.equal(res.statusCode, 409, `campo ${field} deveria estar congelado após ofertas`);
  }

  const nameOnly = await app.inject({
    method: 'PUT',
    url: `/trips/${trip.id}`,
    payload: validTripPayload({ name: 'Só o nome mudou' }),
  });
  assert.equal(nameOnly.statusCode, 200);
  assert.equal(nameOnly.json().name, 'Só o nome mudou');

  // O histórico permanece íntegro após as tentativas.
  assert.ok((await prisma.flightOffer.count({ where: { tripId: trip.id } })) > 0);
});

// Provider fake estacionável: permite testar a sobreposição pesquisa × PUT
// de forma determinística (promises adiadas, zero sleeps).
const PARKED_RAW_OFFER = {
  result_id: 'FAKE-100',
  route: { origin_iata: 'SAO', destination_iata: 'LIS' },
  outbound_leg: {
    carrier_name: 'Fake Air',
    carrier_code: 'FAK',
    flight_number: 'FAK1000',
    depart_at: '2027-09-01T10:00:00Z',
    arrive_at: '2027-09-01T18:00:00Z',
    connection_count: 0,
    seat_class: 'ECONOMY',
  },
  pricing: { currency: 'BRL', fare_brl: 1000, tax_fees_brl: 100, grand_total_brl: 1100 },
  baggage_pieces: 1,
  refundable: false,
};

function createParkedProvider() {
  let releaseResolve;
  let readyResolve;
  const parked = new Promise((resolve) => { releaseResolve = resolve; });
  const ready = new Promise((resolve) => { readyResolve = resolve; });

  const provider = {
    name: 'fake-slow-provider',
    isSimulated: true,
    async search() {
      readyResolve(); // sinaliza: config já capturada, chamada externa estacionada
      await parked;
      return [PARKED_RAW_OFFER];
    },
  };

  return { provider, ready, release: releaseResolve };
}

test('PUT durante a pesquisa (provedor estacionado): pesquisa aborta com 409, não persiste nada e a alteração permanece', async (t) => {
  const created = await app.inject({
    method: 'POST',
    url: '/trips',
    payload: validTripPayload({ name: 'Corrida pesquisa-PUT' }),
  });
  const trip = created.json();
  t.after(() => app.inject({ method: 'DELETE', url: `/trips/${trip.id}` }));

  const { provider, ready, release } = createParkedProvider();

  const searchPromise = searchFlightsForTrip(trip.id, { providers: [provider] });
  await ready; // config capturada, chamada externa suspensa

  // Sem ofertas persistidas: o PUT é permitido e NÃO deve ser revertido.
  const updated = await app.inject({
    method: 'PUT',
    url: `/trips/${trip.id}`,
    payload: validTripPayload({ name: 'Corrida pesquisa-PUT', destination: 'Porto, Portugal' }),
  });
  assert.equal(updated.statusCode, 200);

  release(); // o provedor "responde" com ofertas da configuração antiga

  await assert.rejects(searchPromise, (error) => error.statusCode === 409);

  // Nenhuma oferta ou observação da pesquisa inválida foi persistida.
  assert.equal(await prisma.flightOffer.count({ where: { tripId: trip.id } }), 0);
  assert.equal(await prisma.priceHistory.count({ where: { flightOffer: { tripId: trip.id } } }), 0);

  // A configuração nova permanece: uma pesquisa nova agora usa Porto.
  const retry = await app.inject({ method: 'GET', url: `/trips/${trip.id}/flights` });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.json().query.destination, 'Porto, Portugal');
});

test('viagem deletada durante a pesquisa: 404 pós-lock e nenhuma linha órfã', async (t) => {
  const created = await app.inject({
    method: 'POST',
    url: '/trips',
    payload: validTripPayload({ name: 'Deletada em voo' }),
  });
  const trip = created.json();

  const { provider, ready, release } = createParkedProvider();

  const searchPromise = searchFlightsForTrip(trip.id, { providers: [provider] });
  await ready;

  const deleted = await app.inject({ method: 'DELETE', url: `/trips/${trip.id}` });
  assert.equal(deleted.statusCode, 204);

  release();

  await assert.rejects(searchPromise, (error) => error.statusCode === 404);
  assert.equal(await prisma.flightOffer.count({ where: { tripId: trip.id } }), 0);
});

test('PUTs concorrentes em viagem SEM ofertas: serializados, estado final consistente (sem estado misto)', async (t) => {
  const created = await app.inject({
    method: 'POST',
    url: '/trips',
    payload: validTripPayload({ name: 'Concorrentes livres' }),
  });
  const trip = created.json();
  t.after(() => app.inject({ method: 'DELETE', url: `/trips/${trip.id}` }));

  const results = await Promise.allSettled([
    app.inject({
      method: 'PUT',
      url: `/trips/${trip.id}`,
      payload: validTripPayload({ name: 'Payload A', destination: 'Porto, Portugal' }),
    }),
    app.inject({
      method: 'PUT',
      url: `/trips/${trip.id}`,
      payload: validTripPayload({ name: 'Payload B', destination: 'Faro, Portugal' }),
    }),
  ]);

  assert.equal(results[0].value.statusCode, 200);
  assert.equal(results[1].value.statusCode, 200);

  const final = (await app.inject({ method: 'GET', url: `/trips/${trip.id}` })).json();
  // O estado final é EXATAMENTE um dos payloads completos (serialização por
  // linha), nunca uma mistura dos dois.
  if (final.destination === 'Porto, Portugal') {
    assert.equal(final.name, 'Payload A');
  } else {
    assert.equal(final.destination, 'Faro, Portugal');
    assert.equal(final.name, 'Payload B');
  }
});

test('PUTs concorrentes em viagem COM ofertas: ambos 409 e config preservada', async (t) => {
  const created = await app.inject({
    method: 'POST',
    url: '/trips',
    payload: validTripPayload({ name: 'Concorrentes congelados' }),
  });
  const trip = created.json();
  t.after(() => app.inject({ method: 'DELETE', url: `/trips/${trip.id}` }));

  const firstSearch = await app.inject({ method: 'GET', url: `/trips/${trip.id}/flights` });
  assert.equal(firstSearch.statusCode, 200);

  const results = await Promise.allSettled([
    app.inject({
      method: 'PUT',
      url: `/trips/${trip.id}`,
      payload: validTripPayload({ name: 'Payload A', destination: 'Porto, Portugal' }),
    }),
    app.inject({
      method: 'PUT',
      url: `/trips/${trip.id}`,
      payload: validTripPayload({ name: 'Payload B', destination: 'Faro, Portugal' }),
    }),
  ]);

  assert.equal(results[0].value.statusCode, 409);
  assert.equal(results[1].value.statusCode, 409);

  const final = (await app.inject({ method: 'GET', url: `/trips/${trip.id}` })).json();
  assert.equal(final.destination, 'Lisboa, Portugal');
  assert.equal(final.name, 'Concorrentes congelados');
});
