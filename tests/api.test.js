// Testes de integração da API TripPulse via app.inject() (sem abrir porta).
// Requer o banco de dados ativo (docker compose up -d).

import test from 'node:test';
import assert from 'node:assert/strict';

import pg from 'pg';

import { buildApp } from '../apps/api/src/app.js';
import { prisma } from '../apps/api/src/config/prisma.js';
import { searchFlightsForTrip } from '../apps/api/src/modules/flights/flights.service.js';

const { Client } = pg;

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

// ---------------------------------------------------------------------------
// TESTE DETERMINÍSTICO DE CONCORRÊNCIA (fechamento do Dia 11.9)
//
// Por que não `Promise.all`: disparar as duas requisições juntas não prova que
// elas disputaram o MESMO lock — se uma terminasse antes da outra chegar, o
// teste passaria sem nunca exercitar a serialização.
//
// Estratégia: a primeira requisição é PARQUEADA dentro da sua transação, logo
// depois de `lockTripRow`, na primeira escrita em `flight_offers` (a conexão de
// controle mantém `LOCK TABLE flight_offers IN SHARE MODE`, compatível com
// SELECT e incompatível com INSERT). Enquanto ela está parqueada, o lock da
// linha da viagem continua retido — em PostgreSQL, `SELECT ... FOR UPDATE`
// segura `RowShareLock` na relação até o fim da transação, e é isso que o
// catálogo mostra.
//
// A PARTIR DAÍ a concorrência é provada por observação real do PostgreSQL:
//   - quem executou `lockTripRow` tem `pg_locks.mode = 'RowShareLock'` em
//     `trips` (SELECT comum só pega `AccessShareLock`);
//   - a segunda requisição aparece em `pg_stat_activity` com
//     `wait_event_type = 'Lock'` e `pg_blocking_pids()` apontando para o pid
//     que detém o `RowShareLock` de `trips`;
//   - a espera pendente dela é em `transactionid` (lock de linha), e ela não
//     adquiriu nenhum lock `RowExclusiveLock` em `flight_offers` — ou seja, não
//     chegou à fase de escrita.
//
// Sem `lockTripRow`, este teste FALHA: a primeira requisição nunca apareceria
// com `RowShareLock` em `trips` (o passo 1 estoura o timeout) e a segunda não
// teria um `transactionid` bloqueado por ela — as duas apenas disputariam o
// `SHARE` de `flight_offers` na escrita, cujo bloqueador não é o detentor do
// lock da viagem, e o passo 2 estouraria o timeout.
//
// LIMITE ARQUITETURAL DECLARADO: o provedor roda ANTES da transação (chamada
// externa nunca segura lock — ver flights.service.js). Portanto a segunda
// requisição também consulta o provedor enquanto a primeira detém o lock; o
// que o lock serializa é a fase de leitura pós-lock + persistência. O teste
// prova exatamente isso: a segunda não inicia a escrita nem conclui o snapshot.
// ---------------------------------------------------------------------------

// Polling por estado observável. O `delay` NÃO é o mecanismo de sincronização:
// ele apenas espaça releituras de um estado que precisa existir de fato; se não
// existir, o teste falha por timeout.
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForState(check, { label, timeoutMs = 10_000, intervalMs = 10 }) {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) {
      throw new Error(`Timeout aguardando ${label}`);
    }
    await delay(intervalMs);
  }
}

// Pids que executaram `SELECT ... FOR UPDATE` em `trips` e continuam com a
// transação aberta (o lock de relação só é liberado no fim da transação).
async function tripRowLockHolders() {
  return prisma.$queryRawUnsafe(
    `SELECT DISTINCT l.pid::int AS pid
       FROM pg_locks l
      WHERE l.locktype = 'relation'
        AND l.relation = 'trips'::regclass
        AND l.mode = 'RowShareLock'
        AND l.granted`
  );
}

// Backends bloqueados por um pid específico. `pg_blocking_pids` resolve a
// cadeia real de espera (inclui o caso de lock de linha, em que o bloqueio
// aparece como espera por `transactionid`, não por tuple lock).
async function backendsBlockedBy(pid) {
  return prisma.$queryRawUnsafe(
    `SELECT a.pid::int AS waiter_pid,
            a.wait_event_type,
            a.wait_event,
            pg_blocking_pids(a.pid) AS blockers
       FROM pg_stat_activity a
      WHERE a.pid <> $1
        AND a.wait_event_type = 'Lock'
        AND $1 = ANY (pg_blocking_pids(a.pid))`,
    pid
  );
}

// Primeira escrita em `flight_offers` esperando o `SHARE` da conexão de
// controle: só existe quando uma requisição já passou por `lockTripRow` e
// chegou à persistência.
async function flightOffersWriteWaiters() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS total
       FROM pg_locks
      WHERE locktype = 'relation'
        AND relation = 'flight_offers'::regclass
        AND mode = 'RowExclusiveLock'
        AND NOT granted`
  );
  return rows[0].total;
}

test('duas pesquisas concorrentes disputam o lock da viagem (determinístico)', async (t) => {
  const created = await app.inject({
    method: 'POST',
    url: '/trips',
    payload: validTripPayload({ name: 'Lock da viagem (determinístico)' }),
  });
  const trip = created.json();

  // Conexão de controle separada do pool do Prisma. `SHARE` é compatível com
  // SELECT (contagens pré-lock, findUnique) e incompatível com INSERT: a
  // primeira requisição estaciona DENTRO da transação, depois de lockTripRow,
  // na primeira escrita em flight_offers.
  const blocker = new Client({ connectionString: process.env.DATABASE_URL });
  await blocker.connect();

  t.after(async () => {
    try {
      await blocker.query('ROLLBACK');
    } catch {
      // Fora de transação: o rollback de encerramento já foi feito no teste.
    }
    await blocker.end();
    await app.inject({ method: 'DELETE', url: `/trips/${trip.id}` });
  });

  await blocker.query('BEGIN');
  await blocker.query('LOCK TABLE "flight_offers" IN SHARE MODE');

  let firstSettled = false;
  let secondSettled = false;

  const firstPromise = app
    .inject({ method: 'GET', url: `/trips/${trip.id}/flights` })
    .then((response) => {
      firstSettled = true;
      return response;
    });

  // 1) A primeira requisição JÁ executou `lockTripRow` (RowShareLock em
  //    `trips`) E está parqueada na escrita, ou seja, sua transação segue
  //    aberta segurando o lock da linha da viagem.
  const firstHolder = await waitForState(
    async () => {
      const holders = await tripRowLockHolders();
      if (holders.length !== 1) return null;
      const waiters = await flightOffersWriteWaiters();
      if (waiters !== 1) return null;
      return holders[0];
    },
    { label: 'lock da viagem + parqueamento na escrita da primeira requisição' }
  );
  assert.equal(firstSettled, false, 'a primeira requisição está parqueada dentro da transação');

  // 2) Só então a segunda requisição é iniciada.
  const secondPromise = app
    .inject({ method: 'GET', url: `/trips/${trip.id}/flights` })
    .then((response) => {
      secondSettled = true;
      return response;
    });

  // 3) Evidência de que a segunda chegou ao MESMO lock e está bloqueada por
  //    quem o detém: `pg_blocking_pids` a liga ao pid do `RowShareLock` de
  //    `trips` e a espera pendente é por `transactionid` (lock de linha).
  const contention = await waitForState(
    async () => {
      const blocked = await backendsBlockedBy(firstHolder.pid);
      return blocked.length === 1 ? blocked[0] : null;
    },
    { label: 'segunda requisição bloqueada pelo detentor do lock da viagem' }
  );
  assert.notEqual(contention.waiter_pid, firstHolder.pid, 'o waiter é outro backend');
  assert.equal(contention.wait_event, 'transactionid', 'espera em lock de linha da viagem');
  assert.deepEqual(
    contention.blockers.map((pid) => Number(pid)),
    [firstHolder.pid],
    'a segunda requisição está bloqueada exatamente por quem detém o lock da viagem'
  );

  // 4) A segunda não avançou para a escrita: continua existindo UM único
  //    pedido de RowExclusiveLock em flight_offers (o da primeira, parqueada).
  assert.equal(
    await flightOffersWriteWaiters(),
    1,
    'a segunda requisição não chegou à fase de escrita'
  );
  assert.equal(secondSettled, false, 'a segunda requisição não ultrapassou o lock');

  // 5) Nada foi persistido por nenhuma das duas enquanto a primeira segura o
  //    lock e a segunda espera por ele.
  assert.equal(
    await prisma.flightOffer.count({ where: { tripId: trip.id } }),
    0,
    'nenhuma oferta persistida enquanto o lock está retido pela primeira'
  );
  assert.equal(
    await prisma.priceHistory.count({ where: { flightOffer: { tripId: trip.id } } }),
    0,
    'nenhuma observação persistida antes da liberação'
  );

  // 6) Libera a primeira (fim do bloqueio de escrita); a transação dela
  //    commita e a segunda prossegue.
  await blocker.query('ROLLBACK');

  const [first, second] = [await firstPromise, await secondPromise];
  assert.equal(secondSettled, true, 'a segunda prosseguiu depois da liberação');

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);

  const offers = first.json().offers;
  assert.ok(offers.length >= 3);
  assert.equal(second.json().offers.length, offers.length);

  const offerCount = await prisma.flightOffer.count({ where: { tripId: trip.id } });
  assert.equal(offerCount, offers.length, 'identidade deduplicada, sem ofertas duplicadas');

  const observations = await prisma.priceHistory.findMany({
    where: { flightOffer: { tripId: trip.id } },
    orderBy: { sequence: 'asc' },
  });
  assert.equal(observations.length, offers.length * 2, 'cada pesquisa gravou uma observação por oferta');
  assert.equal(
    new Set(observations.map((observation) => observation.sequence)).size,
    observations.length,
    'sequence única mesmo com pesquisas concorrentes'
  );

  const history = await app.inject({ method: 'GET', url: `/trips/${trip.id}/offers/history` });
  assert.equal(history.statusCode, 200);
  for (const offer of history.json().offers) {
    assert.equal(offer.observations.length, 2);
    assert.ok(offer.current);
    assert.ok(offer.previous);
  }
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
