// Regressão do `booking_token` no ÚNICO campo JSONB do schema:
// `monitoring_runs.items`.
//
// POR QUE ESTE ARQUIVO EXISTE SEPARADO DOS OUTROS DOIS:
// booking-token.test.js prova adaptador + normalização; booking-token-persistence
// prova flight_offers/price_history + resposta HTTP. Nenhum dos dois toca o
// JSONB. Aqui exercitamos o fluxo REAL de monitoramento
// (`startMonitoringRun` → `runMonitoringCycle` → UPDATE `items`) com um
// provedor sintético cujo raw carrega a sentinela, e varremos o valor JSONB
// efetivamente gravado no Postgres.
//
// O QUE ENTRA EM `items` (evidência: monitoring-core.js):
// - OK:      tripId, status, opportunityCount, evaluatedOfferCount,
//            containsSimulatedData;
// - FAILED:  tripId, status, stage, error (= messageOf(error)), contadores;
// - SKIPPED: tripId, status, reason, detail, contadores.
// Ofertas, `raw`, `outbound`/`return` e `booking_token` NUNCA são campos dos
// itens — o teste fixa isso estruturalmente (chaves exatas + valores escalares)
// e por varredura da sentinela.
//
// VETOR REAL DE TEXTO EXTERNO: o único campo de item derivado de algo que não
// é a própria aplicação é `error`, preenchido com `messageOf(error)` — a
// mensagem do erro, copiada VERBATIM. A garantia de que ele não carrega o
// token é a higiene das mensagens do adaptador, provada em
// booking-token.test.js (mensagens controladas, sem eco do corpo externo).
//
// DOIS TESTES, DOIS NÍVEIS DESSE VETOR:
// 1. item FAILED por erro de DOMÍNIO (viagem sem origem, antes do provider);
// 2. item FAILED por ERRO EXTERNO REAL: adaptador SerpApi com fetch injetado
//    devolve `error` contendo a sentinela; a falha percorre
//    searchFlightsForTrip → runMonitoringCycle → JSONB. Este é o caminho
//    completo "resposta externa → messageOf → monitoring_runs.items".
//
// Requer banco ativo (docker compose up -d). Nenhuma chamada à SerpApi,
// nenhuma credencial, barreira REAL intacta (`isSimulated: true`).
//
// Execução: node --test

import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../apps/api/src/config/prisma.js';
import { searchFlightsForTrip } from '../apps/api/src/modules/flights/flights.service.js';
import {
  startMonitoringRun,
  MONITORING_RUN_STATUS,
} from '../apps/api/src/modules/monitoring/monitoring.service.js';
import { createSerpApiFlightProvider } from '../apps/api/src/integrations/flight-providers/serpapi/serpapi-flight-provider.js';
import {
  fakeItinerary,
  fakeInitialRoundTripResponse,
  fakeFetchSequence,
} from './fixtures/serpapi-fixtures.js';

// Sentinela exclusiva: se aparecer no JSONB, o teste falha.
const BOOKING_TOKEN_SENTINEL = 'TEST_BOOKING_TOKEN_DO_NOT_LEAK';

// Referência UTC fixa: startDate das viagens é futuro, então ambas são
// monitoráveis (a segunda falha depois, por outro motivo).
const NOW = new Date('2027-08-01T12:00:00Z');

// Vocabulário fechado de `items` (espelha MONITORING_ITEM_SHAPE em
// monitoring.service.js). Se a produção passar a gravar qualquer outro campo
// em items, este teste falha antes de o JSONB virar depósito de payload.
const ITEM_KEYS = Object.freeze({
  OK: [
    'tripId',
    'status',
    'opportunityCount',
    'evaluatedOfferCount',
    'containsSimulatedData',
  ].sort(),
  FAILED: [
    'tripId',
    'status',
    'stage',
    'error',
    'opportunityCount',
    'evaluatedOfferCount',
    'containsSimulatedData',
  ].sort(),
});

// Raw do provedor SIMULADO (dialeto efetivamente persistível hoje) carregando,
// nas chaves `outbound`/`return`, os itinerários EXATOS que o adaptador SerpApi
// deixa no raw (fixture sintética) — inclusive `booking_token` em três
// profundidades. Assim o teste prova que estruturas do raw, mesmo presentes no
// objeto entregue à persistência, não chegam ao JSONB.
//
// NOTA: um raw no dialeto SerpApi puro com `name: 'serpapi'` não é usado aqui
// porque o mapeador SerpApi produz `baggagePieces/refundable = null`, que o
// schema atual (NOT NULL) rejeita — bloqueador LATENTE documentado, alheio ao
// booking_token. Esse caminho tornaria o teste dependente de um bug.
const RAW_OFFER = {
  result_id: 'FAKE-100',
  route: { origin_iata: 'GRU', destination_iata: 'LIS' },
  outbound_leg: {
    carrier_name: 'Fake Air',
    carrier_code: 'FAK',
    flight_number: 'FA100',
    depart_at: '2027-09-01T10:00:00Z',
    arrive_at: '2027-09-01T18:00:00Z',
    connection_count: 0,
    seat_class: 'ECONOMY',
  },
  pricing: { currency: 'BRL', fare_brl: 1000, tax_fees_brl: 100, grand_total_brl: 1100 },
  baggage_pieces: 0,
  refundable: false,
  booking_token: BOOKING_TOKEN_SENTINEL,
  outbound: {
    ...fakeItinerary({ price: 1000, flightNumber: 'FA100' }),
    booking_token: BOOKING_TOKEN_SENTINEL,
  },
  return: {
    ...fakeItinerary({
      fromId: 'LIS',
      toId: 'GRU',
      price: 2100,
      flightNumber: 'FA200',
      departTime: '2027-09-10 12:00',
      arriveTime: '2027-09-10 21:00',
    }),
    booking_token: BOOKING_TOKEN_SENTINEL,
  },
};

// Test double: sem rede, sem credencial, sem dado real. `isSimulated: true`
// mantém a barreira REAL intacta; nenhum mapper SerpApi é usado.
function createSyntheticProvider() {
  const calls = [];
  return {
    calls,
    provider: {
      name: 'synthetic-booking-token',
      isSimulated: true,
      async search(query) {
        calls.push(query);
        return [structuredClone(RAW_OFFER)];
      },
    },
  };
}

// Serialização tolerante a BigInt (price_history.sequence) — varre qualquer
// coluna, inclusive JSONB, em busca da sentinela.
function serialize(value) {
  return JSON.stringify(value, (_key, nested) =>
    typeof nested === 'bigint' ? nested.toString() : nested
  );
}

function assertNoSentinel(value, label) {
  const serialized = serialize(value);
  assert.ok(!serialized.includes(BOOKING_TOKEN_SENTINEL), `${label}: sentinela presente`);
  assert.ok(!serialized.includes('booking_token'), `${label}: campo booking_token presente`);
}

async function createTrip({ name, origin }) {
  return prisma.trip.create({
    data: {
      name,
      origin,
      destination: 'Lisboa, Portugal',
      startDate: new Date('2027-09-01'),
      endDate: new Date('2027-09-10'),
    },
  });
}

// O núcleo de monitoramento recebe a viagem no formato de `listTrips()`, isto é,
// com `startDate` como data de calendário (string), não como Date do Prisma.
function monitoringTrip(trip) {
  return {
    id: trip.id,
    name: trip.name,
    startDate: trip.startDate.toISOString().slice(0, 10),
    endDate: trip.endDate.toISOString().slice(0, 10),
  };
}

// Resolver sintético do adaptador: apenas os dois textos usados na viagem de
// teste. Nenhum aeroporto real é consultado (não há rede).
const SERPAPI_API_KEY = 'SYNTHETIC_API_KEY';
const SERPAPI_LOCATIONS = new Map([
  ['São Paulo, Brasil', ['GRU', 'CGH', 'VCP']],
  ['Lisboa, Portugal', ['LIS']],
]);
const SERPAPI_RESOLVER = {
  resolveLocation(text) {
    const matches = SERPAPI_LOCATIONS.get(text);
    if (!matches) {
      return { status: 'UNRESOLVED', query: text, reason: 'UNKNOWN_LOCATION' };
    }
    return {
      status: 'RESOLVED',
      query: text,
      matches: matches.map((iata) => ({ iata, ident: `SYN${iata}` })),
    };
  },
};

test.after(async () => {
  await prisma.$disconnect();
});

test('monitoring_runs.items (JSONB) não carrega booking_token nem payload de oferta/raw', async (t) => {
  // 1ª viagem: monitorável e pesquisável (grava oferta + histórico).
  const activeTrip = await createTrip({
    name: 'Regressão booking_token — monitoramento OK',
    origin: 'São Paulo, SP, Brasil',
  });

  // 2ª viagem: monitorável, mas a pesquisa falha com um erro REAL de domínio
  // (viagem legada sem origem). Produz um item FAILED — o único item cujo texto
  // vem de um erro, e o único vetor possível de texto externo.
  const legacyTrip = await createTrip({
    name: 'Regressão booking_token — monitoramento FAILED',
    origin: null,
  });

  const createdRunIds = [];
  t.after(async () => {
    await prisma.trip.deleteMany({ where: { id: { in: [activeTrip.id, legacyTrip.id] } } });
    await prisma.monitoringRun.deleteMany({ where: { id: { in: createdRunIds } } });
  });

  const { provider, calls } = createSyntheticProvider();

  const view = await startMonitoringRun({
    now: NOW,
    trips: [monitoringTrip(activeTrip), monitoringTrip(legacyTrip)],
    // Fluxo REAL de pesquisa/persistência, com provider sintético injetado.
    search: (tripId) => searchFlightsForTrip(tripId, { providers: [provider] }),
    opportunities: async () => ({
      summary: { evaluatedOfferCount: 1, containsSimulatedData: true },
      opportunities: [],
    }),
  });
  createdRunIds.push(view.runId);

  // Sanidade: o ciclo rodou de verdade e o raw entregue trazia a sentinela.
  assert.equal(calls.length, 1);
  assert.equal(RAW_OFFER.booking_token, BOOKING_TOKEN_SENTINEL);
  assert.equal(RAW_OFFER.outbound.booking_token, BOOKING_TOKEN_SENTINEL);
  assert.equal(view.status, MONITORING_RUN_STATUS.COMPLETED);
  assert.equal(view.okCount, 1);
  assert.equal(view.failedCount, 1);
  assert.equal(view.monitorableCount, 2);

  // A oferta FOI persistida (o fluxo não foi atalhado).
  assert.equal(await prisma.flightOffer.count({ where: { tripId: activeTrip.id } }), 1);

  // Itens devolvidos pelo service: variantes OK e FAILED, com chaves exatas.
  const [okItem, failedItem] = view.items;
  assert.equal(okItem.status, 'OK');
  assert.equal(failedItem.status, 'FAILED');
  assert.equal(failedItem.stage, 'SEARCH');
  assert.match(failedItem.error, /não possui origem cadastrada/);
  assert.deepEqual(Object.keys(okItem).sort(), ITEM_KEYS.OK);
  assert.deepEqual(Object.keys(failedItem).sort(), ITEM_KEYS.FAILED);

  // Leitura do JSONB como está NO BANCO (não só o objeto devolvido pelo
  // service): nenhuma transformação de leitura pode mascarar um vazamento.
  const [stored] = await prisma.$queryRaw`
    SELECT items FROM monitoring_runs WHERE id = CAST(${view.runId} AS uuid)
  `;
  assert.ok(stored, 'linha de monitoring_runs não encontrada');

  // 1. Varredura da sentinela e da chave no JSONB gravado.
  assertNoSentinel(stored.items, 'monitoring_runs.items');

  // 2. Estrutura: itens têm apenas chaves do contrato e valores ESCALARES.
  //    Isso fecha a possibilidade de qualquer payload (oferta, raw, outbound,
  //    return) ser acomodado em items, hoje ou por regressão futura.
  assert.ok(Array.isArray(stored.items));
  assert.equal(stored.items.length, 2);

  for (const item of stored.items) {
    assert.ok(Object.hasOwn(ITEM_KEYS, item.status), `status inesperado: ${item.status}`);
    assert.deepEqual(
      Object.keys(item).sort(),
      ITEM_KEYS[item.status],
      `item ${item.status} com campos fora do contrato`
    );

    for (const [key, value] of Object.entries(item)) {
      assert.ok(
        value === null || ['string', 'number', 'boolean'].includes(typeof value),
        `${key} não é escalar: JSONB não deve acomodar estruturas de oferta/raw`
      );
    }
  }

  // 3. Contraprova: o item OK gravou os números do relatório, não um espelho
  //    da oferta — e o item FAILED gravou a mensagem de erro de domínio.
  assert.equal(stored.items[0].tripId, activeTrip.id);
  assert.equal(stored.items[0].opportunityCount, 0);
  assert.equal(stored.items[0].evaluatedOfferCount, 1);
  assert.equal(stored.items[1].tripId, legacyTrip.id);
  assert.equal(stored.items[1].status, 'FAILED');
});

// ---------------------------------------------------------------------------
// Caminho completo: erro EXTERNO da SerpApi → messageOf → JSONB
// ---------------------------------------------------------------------------

test('erro externo da SerpApi com a sentinela vira item FAILED sem gravar o token no JSONB', async (t) => {
  const trip = await createTrip({
    name: 'Regressão booking_token — erro externo SerpApi',
    origin: 'São Paulo, Brasil',
  });

  const createdRunIds = [];
  t.after(async () => {
    await prisma.trip.deleteMany({ where: { id: trip.id } });
    await prisma.monitoringRun.deleteMany({ where: { id: { in: createdRunIds } } });
  });

  // Resposta sintética: HTTP 200 com `error` externo contendo a sentinela.
  // É exatamente o caso que o adaptador precisa neutralizar antes de qualquer
  // mensagem chegar ao item FAILED.
  const externalError = `upstream rejected booking_token=${BOOKING_TOKEN_SENTINEL}`;
  const body = fakeInitialRoundTripResponse({ outbounds: [], error: externalError });
  const { fetchImpl, calls } = fakeFetchSequence([{ body }]);

  const serpApiProvider = createSerpApiFlightProvider({
    apiKey: SERPAPI_API_KEY,
    fetchImpl,
    timeoutMs: 1000,
    maxOutboundExpansions: 1,
    airportResolver: SERPAPI_RESOLVER,
  });

  // A barreira REAL continua intacta: o provider SerpApi de verdade é recusado
  // ANTES de qualquer chamada externa. Se essa garantia cair, este teste falha.
  await assert.rejects(
    () => searchFlightsForTrip(trip.id, { providers: [serpApiProvider] }),
    (error) => {
      assert.equal(error.statusCode, 503);
      return true;
    }
  );
  assert.equal(calls.length, 0, 'barreira deveria bloquear antes da chamada externa');

  // Harness de teste: usa a MESMA função `search` do adaptador (fetch
  // sintético, parsing e mensagens reais), declarada SIMULATED para atravessar
  // o registro do orquestrador sem enfraquecer a barreira. A busca sempre
  // falha antes de normalizar, então nenhum mapper é aplicado.
  const harnessProvider = {
    name: 'serpapi-synthetic-harness',
    isSimulated: true,
    search: (query, options) => serpApiProvider.search(query, options),
  };

  const view = await startMonitoringRun({
    now: NOW,
    trips: [monitoringTrip(trip)],
    search: (tripId) => searchFlightsForTrip(tripId, { providers: [harnessProvider] }),
    opportunities: async () => {
      throw new Error('oportunidades não deveriam ser avaliadas quando a busca falha');
    },
  });
  createdRunIds.push(view.runId);

  // Sanidade do caminho exercitado: exatamente 1 chamada externa (sintética) e
  // a resposta realmente carregava a sentinela.
  assert.equal(calls.length, 1);
  assert.ok(String(body.error).includes(BOOKING_TOKEN_SENTINEL));

  // O item FAILED foi criado e registrou a mensagem CONTROLADA do adaptador.
  assert.equal(view.status, MONITORING_RUN_STATUS.COMPLETED);
  assert.equal(view.okCount, 0);
  assert.equal(view.failedCount, 1);
  const [item] = view.items;
  assert.equal(item.status, 'FAILED');
  assert.equal(item.stage, 'SEARCH');
  assert.equal(item.error, 'SerpApi: erro do provedor em busca inicial.');
  assert.ok(!item.error.includes(externalError));
  assert.ok(!item.error.includes(BOOKING_TOKEN_SENTINEL));

  // Nenhuma oferta foi persistida (a busca falhou antes da transação).
  assert.equal(await prisma.flightOffer.count({ where: { tripId: trip.id } }), 0);

  // JSONB como está NO BANCO, não o objeto devolvido pelo service.
  const [stored] = await prisma.$queryRaw`
    SELECT items FROM monitoring_runs WHERE id = CAST(${view.runId} AS uuid)
  `;
  assert.ok(stored, 'linha de monitoring_runs não encontrada');
  assert.equal(stored.items.length, 1);
  assert.equal(stored.items[0].status, 'FAILED');
  assert.equal(stored.items[0].error, 'SerpApi: erro do provedor em busca inicial.');

  // Requisitos explícitos: mensagem registrada, sentinela e chave ausentes.
  assert.equal(typeof stored.items[0].error, 'string');
  assert.ok(stored.items[0].error.length > 0);
  assertNoSentinel(stored.items, 'monitoring_runs.items (erro externo)');
  assert.ok(
    !JSON.stringify(stored.items).includes('upstream rejected'),
    'texto externo integral não pode ser persistido'
  );
});
