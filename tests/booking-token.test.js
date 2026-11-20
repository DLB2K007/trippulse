// Regressão específica do `booking_token` — Fase 5, primeira melhoria técnica.
//
// ESCOPO: somente o adaptador SerpApi e a normalização. Nenhuma chamada real,
// nenhuma credencial: fetch é injetado e todas as respostas são FIXTURES
// SINTÉTICAS (tests/fixtures/serpapi-fixtures.js).
//
// O QUE ESTE ARQUIVO PROVA (e o que ele NÃO prova):
// - prova: o `booking_token` recebido nas respostas NUNCA vira parâmetro de
//   requisição, NUNCA é transportado para a oferta normalizada e NUNCA é ecoado
//   em mensagens de erro;
// - documenta: o `booking_token` PODE permanecer em `raw.return`/`raw.outbound`.
//   Isso é comportamento interno conhecido (o adaptador só remove
//   `departure_token`); o teste abaixo fixa essa expectativa em vez de "limpar"
//   o raw para passar.
// - não prova (ver booking-token-persistence.test.js): resposta HTTP e
//   persistência.
//
// SENTINELA: valor exclusivo e impossível de confundir com dado real. Se ele
// aparecer fora do raw, o teste falha. Nunca confundir com `departure_token`,
// que é um token DIFERENTE e continua sendo enviado na 2ª requisição.
//
// Execução: node --test

import test from 'node:test';
import assert from 'node:assert/strict';

import { createSerpApiFlightProvider } from '../apps/api/src/integrations/flight-providers/serpapi/serpapi-flight-provider.js';
import { normalizeFlightOffer } from '../apps/api/src/integrations/flight-providers/normalize.js';
import {
  fakeItinerary,
  fakeInitialRoundTripResponse,
  fakeReturnResponse,
  fakeFetchSequence,
} from './fixtures/serpapi-fixtures.js';

const API_KEY = 'SYNTHETIC_API_KEY';

// Sentinela do booking_token: NUNCA deve sair do raw interno.
const BOOKING_TOKEN_SENTINEL = 'TEST_BOOKING_TOKEN_DO_NOT_LEAK';
// Token de ida (contrato D3): este SIM deve ser enviado na 2ª requisição.
const DEPARTURE_TOKEN = 'TEST_DEPARTURE_TOKEN_ALLOWED';

function fakeResolver(mapping) {
  return {
    resolveLocation(text) {
      const match = mapping.find((entry) => entry.text === text);
      if (!match) {
        return { status: 'UNRESOLVED', query: text, reason: 'UNKNOWN_LOCATION' };
      }
      return {
        status: 'RESOLVED',
        source: 'synthetic',
        query: text,
        matches: match.matches.map((code) => ({ iata: code, ident: `SYN${code}` })),
      };
    },
  };
}

const RESOLVER = fakeResolver([
  { text: 'São Paulo, Brasil', matches: ['GRU', 'CGH', 'VCP'] },
  { text: 'Lisboa, Portugal', matches: ['LIS'] },
]);

const queryRoundTrip = {
  origin: 'São Paulo, Brasil',
  destination: 'Lisboa, Portugal',
  departureDate: '2027-03-10',
  returnDate: '2027-03-20',
};

function createProvider(responses) {
  const { fetchImpl, calls } = fakeFetchSequence(responses);
  const provider = createSerpApiFlightProvider({
    apiKey: API_KEY,
    fetchImpl,
    maxOutboundExpansions: 1,
    timeoutMs: 1000,
    airportResolver: RESOLVER,
  });
  return { provider, calls };
}

// Itinerário sintético com o booking_token substituído pela sentinela. A
// fixture já traz um `booking_token` genérico; sobrescrevemos o valor para que
// qualquer vazamento seja inequívoco.
function withSentinelBookingToken(itinerary) {
  return { ...itinerary, booking_token: BOOKING_TOKEN_SENTINEL };
}

function outboundItinerary() {
  return withSentinelBookingToken(
    fakeItinerary({
      price: 1000,
      flightNumber: 'FA100',
      departureToken: DEPARTURE_TOKEN,
    })
  );
}

function returnItinerary() {
  return withSentinelBookingToken(
    fakeItinerary({
      fromId: 'LIS',
      toId: 'GRU',
      price: 2100,
      flightNumber: 'FA200',
      departTime: '2027-03-20 12:00',
      arriveTime: '2027-03-20 21:00',
    })
  );
}

// Percorre o objeto e devolve os caminhos com chave `booking_token` (ou a
// sentinela). A checagem é recursiva porque o vazamento pode ocorrer em
// qualquer profundidade (raw, normalizado, relatedQuery).
function findBookingTokenPaths(value, path = '$', found = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findBookingTokenPaths(item, `${path}[${index}]`, found));
    return found;
  }

  if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      const nestedPath = `${path}.${key}`;
      if (key === 'booking_token') {
        found.push(nestedPath);
      }
      if (nested === BOOKING_TOKEN_SENTINEL) {
        found.push(nestedPath);
      }
      findBookingTokenPaths(nested, nestedPath, found);
    }
    return found;
  }

  if (value === BOOKING_TOKEN_SENTINEL) {
    found.push(path);
  }
  return found;
}

function assertNoBookingTokenLeak(value, label) {
  const paths = findBookingTokenPaths(value);
  assert.deepEqual(paths, [], `${label}: booking_token/sentinela encontrado em ${paths.join(', ')}`);
  assert.ok(
    !JSON.stringify(value).includes(BOOKING_TOKEN_SENTINEL),
    `${label}: sentinela do booking_token presente na serialização`
  );
}

// ------------------------------------------------- requisições do adaptador

test('booking_token do raw nunca vira parâmetro de requisição (1ª e 2ª chamadas)', async () => {
  const { provider, calls } = createProvider([
    { body: fakeInitialRoundTripResponse({ outbounds: [outboundItinerary()] }) },
    { body: fakeReturnResponse({ returns: [returnItinerary()] }) },
  ]);

  const offers = await provider.search(queryRoundTrip);

  // Sanidade: as duas respostas sintéticas traziam a sentinela.
  assert.equal(outboundItinerary().booking_token, BOOKING_TOKEN_SENTINEL);
  assert.equal(returnItinerary().booking_token, BOOKING_TOKEN_SENTINEL);
  assert.equal(offers.length, 1);
  assert.equal(calls.length, 2);

  for (const [index, call] of calls.entries()) {
    const url = new URL(call);

    assert.equal(
      url.searchParams.get('booking_token'),
      null,
      `requisição ${index + 1}: booking_token enviado como parâmetro`
    );
    assert.equal(
      url.searchParams.getAll('booking_token').length,
      0,
      `requisição ${index + 1}: booking_token duplicado/injetado`
    );
    assert.ok(
      !call.includes('booking_token'),
      `requisição ${index + 1}: URL contém a chave booking_token`
    );
    assert.ok(
      !call.includes(BOOKING_TOKEN_SENTINEL),
      `requisição ${index + 1}: URL contém a sentinela do booking_token`
    );
  }

  // Contraprova: o departure_token (token DIFERENTE) continua sendo enviado
  // corretamente na 2ª requisição — a regressão não pode ser "não enviar nada".
  const secondUrl = new URL(calls[1]);
  assert.equal(secondUrl.searchParams.get('departure_token'), DEPARTURE_TOKEN);
  assert.equal(secondUrl.searchParams.getAll('departure_token').length, 1);
});

// ---------------------------------------------- raw interna (comportamento)

test('raw offer mantém booking_token no objeto interno e remove só departure_token', async () => {
  const { provider } = createProvider([
    { body: fakeInitialRoundTripResponse({ outbounds: [outboundItinerary()] }) },
    { body: fakeReturnResponse({ returns: [returnItinerary()] }) },
  ]);

  const offers = await provider.search(queryRoundTrip);
  const raw = offers[0];

  // Comportamento atual DOCUMENTADO: o adaptador não limpa `booking_token` do
  // raw. Este teste fixa a expectativa (não é uma correção de produção).
  assert.equal(raw.outbound.booking_token, BOOKING_TOKEN_SENTINEL);
  assert.equal(raw.return.booking_token, BOOKING_TOKEN_SENTINEL);

  // O token que o adaptador realmente remove continua removido.
  assert.equal('departure_token' in raw, false);
  assert.equal('departure_token' in raw.outbound, false);
  assert.equal('departure_token' in raw.return, false);
  assert.ok(
    !JSON.stringify(raw).includes(DEPARTURE_TOKEN),
    'departure_token vazou no raw offer'
  );
});

// --------------------------------------------------------- normalização

test('oferta normalizada não transporta booking_token (nem como chave, nem como valor)', async () => {
  const { provider } = createProvider([
    { body: fakeInitialRoundTripResponse({ outbounds: [outboundItinerary()] }) },
    { body: fakeReturnResponse({ returns: [returnItinerary()] }) },
  ]);

  const offers = await provider.search(queryRoundTrip);
  const normalized = normalizeFlightOffer(provider, offers[0], {
    origin: queryRoundTrip.origin,
    destination: queryRoundTrip.destination,
    departureDate: queryRoundTrip.departureDate,
    returnDate: queryRoundTrip.returnDate,
  });

  assertNoBookingTokenLeak(normalized, 'oferta normalizada');

  // Contrato fechado: a oferta normalizada tem exatamente estes campos. Sem
  // `return`, `outbound` ou qualquer passthrough do raw.
  assert.deepEqual(
    Object.keys(normalized).sort(),
    [
      'dataClassification',
      'dates',
      'flight',
      'isSimulated',
      'price',
      'provider',
      'relatedQuery',
      'route',
      'type',
    ].sort()
  );
  // O adaptador REAL classifica a oferta como REAL; a barreira de exposição/
  // persistência é outro teste. Aqui interessa apenas a ausência do token.
  assert.equal(normalized.dataClassification, 'REAL');
  assert.equal(normalized.price.total, 2100);
});

// -------------------------------------------------------------- mensagens

test('booking_token do provedor não aparece em mensagens de erro (1ª e 2ª respostas)', async () => {
  const leakyError = `upstream rejected booking_token=${BOOKING_TOKEN_SENTINEL}`;

  const cases = [
    {
      label: 'busca inicial',
      responses: [{ body: fakeInitialRoundTripResponse({ outbounds: [outboundItinerary()], error: leakyError }) }],
    },
    {
      label: 'expansão de retorno',
      responses: [
        { body: fakeInitialRoundTripResponse({ outbounds: [outboundItinerary()] }) },
        { body: fakeReturnResponse({ returns: [returnItinerary()], error: leakyError }) },
      ],
    },
  ];

  for (const { label, responses } of cases) {
    const { provider } = createProvider(responses);

    await assert.rejects(
      () => provider.search(queryRoundTrip),
      (error) => {
        const message = String(error.message);
        assert.ok(
          !message.includes(BOOKING_TOKEN_SENTINEL),
          `${label}: sentinela do booking_token vazou na mensagem`
        );
        assert.ok(!message.includes('booking_token'), `${label}: chave booking_token na mensagem`);
        // O texto externo não é propagado: mensagem controlada pela aplicação.
        assert.match(message, /erro do provedor/);
        assert.match(message, new RegExp(`em ${label}`));
        return true;
      }
    );
  }
});
