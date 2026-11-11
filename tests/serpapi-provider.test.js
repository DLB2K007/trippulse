// Testes unitários do adaptador SerpApi (Google Flights) — Dia 11.8.
//
// ZERO CHAMADAS REAIS: fetch é injetado (fakeFetchSequence) e todas as
// respostas vêm de FIXTURES SINTÉTICAS (tests/fixtures/serpapi-fixtures.js,
// rotuladas como sintéticas — nunca respostas reais capturadas).
// A chave usada é fictícia ('SYNTHETIC_API_KEY').
//
// Execução: node --test

import test from 'node:test';
import assert from 'node:assert/strict';

import { createSerpApiFlightProvider } from '../apps/api/src/integrations/flight-providers/serpapi/serpapi-flight-provider.js';
import {
  fakeItinerary,
  fakeInitialRoundTripResponse,
  fakeReturnResponse,
  fakeOneWayResponse,
  SYNTHETIC_PRICE_INSIGHTS,
  fakeFetchSequence,
} from './fixtures/serpapi-fixtures.js';

const API_KEY = 'SYNTHETIC_API_KEY';

// Resolver sintético mínimo (mesmo contrato do airport-resolver): rotulado
// como sintético — testa o casamento texto -> códigos sem depender do
// snapshot real.
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
        matches: match.matches.map((code) => ({
          iata: code,
          ident: `SYN${code}`,
          name: `Fake ${code}`,
          municipality: 'Fake City',
          country: 'BR',
          region: 'BR-SP',
          type: 'large_airport',
        })),
      };
    },
  };
}

function createProvider({ responses, maxOutboundExpansions = 1, resolver } = {}) {
  const { fetchImpl, calls } = fakeFetchSequence(responses);
  const provider = createSerpApiFlightProvider({
    apiKey: API_KEY,
    fetchImpl,
    maxOutboundExpansions,
    timeoutMs: 1000,
    airportResolver: resolver ?? fakeResolver([
      {
        text: 'São Paulo, Brasil',
        matches: ['GRU', 'CGH', 'VCP'],
      },
      { text: 'Lisboa, Portugal', matches: ['LIS'] },
    ]),
  });
  return { provider, calls };
}

const queryOneWay = {
  origin: 'São Paulo, Brasil',
  destination: 'Lisboa, Portugal',
  departureDate: '2027-03-10',
};
const queryRoundTrip = { ...queryOneWay, returnDate: '2027-03-20' };

// ------------------------------------------------------------- construção

test('parâmetros da ida simples: IATAs resolvidos, type=2, sem expansion', async () => {
  const { provider, calls } = createProvider({
    responses: [{ body: fakeOneWayResponse({ outbounds: [fakeItinerary()] }) }],
  });

  const offers = await provider.search(queryOneWay);
  assert.equal(offers.length, 1);
  assert.equal(calls.length, 1);

  const url = new URL(calls[0]);
  assert.equal(url.origin, 'https://serpapi.com');
  assert.equal(url.pathname, '/search.json');
  assert.equal(url.searchParams.get('engine'), 'google_flights');
  assert.equal(url.searchParams.get('departure_id'), 'GRU,CGH,VCP'); // multi-aeroporto
  assert.equal(url.searchParams.get('arrival_id'), 'LIS');
  assert.equal(url.searchParams.get('outbound_date'), '2027-03-10');
  assert.equal(url.searchParams.get('type'), '2');
  assert.equal(url.searchParams.get('return_date'), null);
  assert.equal(url.searchParams.get('currency'), 'BRL');
  assert.equal(url.searchParams.get('api_key'), API_KEY);
});

test('kgmid quando o resolver fornece (suporte a códigos de metrópole)', async () => {
  // SINTÉTICO: match com kgmid (formato futuro de códigos de cidade) — o
  // adaptador deve preferir kgmid ao IATA do match.
  const customResolver = {
    resolveLocation(text) {
      if (text === 'Metrópole X') {
        return {
          status: 'RESOLVED',
          source: 'synthetic',
          query: text,
          matches: [{ kgmid: '/m/abc123', iata: 'GRU' }],
        };
      }
      return {
        status: 'RESOLVED',
        source: 'synthetic',
        query: text,
        matches: [{ iata: 'LIS' }],
      };
    },
  };

  const { provider: kgmidProvider, calls: kgmidCalls } = createProvider({
    responses: [{ body: fakeOneWayResponse({ outbounds: [fakeItinerary()] }) }],
    resolver: customResolver,
  });

  const offers = await kgmidProvider.search({
    origin: 'Metrópole X',
    destination: 'Lisboa, Portugal',
    departureDate: '2027-03-10',
  });

  assert.equal(offers.length, 1);
  const url = new URL(kgmidCalls[0]);
  assert.equal(url.searchParams.get('departure_id'), '/m/abc123');
  assert.equal(url.searchParams.get('arrival_id'), 'LIS');
});

// ------------------------------------------------- autenticação e privacidade

test('autenticação: api_key vai na query e NUNCA aparece em mensagens de erro', async () => {
  const { provider, calls } = createProvider({
    responses: [new Error('getaddrinfo ENOTFOUND serpapi.com/search.json?api_key=SYNTHETIC_API_KEY')],
  });

  await assert.rejects(
    () => provider.search(queryOneWay),
    (error) => {
      assert.ok(!String(error.message).includes(API_KEY), 'chave vazou na mensagem de erro');
      return true;
    }
  );
  assert.equal(calls.length, 1);
});

// ------------------------------------------------------------- round-trip

test('round-trip: 2 requisições (1 + 1 token), combinando ida e retorno', async () => {
  const outbound = fakeItinerary({
    price: 1000,
    departureToken: 'SYNTHETIC_DEPARTURE_TOKEN',
  });
  const returnLeg = fakeItinerary({
    fromId: 'LIS',
    toId: 'GRU',
    price: 2100,
    flightNumber: 'FA200',
    departTime: '2027-03-20 12:00',
    arriveTime: '2027-03-20 21:00',
  });

  const { provider, calls } = createProvider({
    responses: [
      { body: fakeInitialRoundTripResponse({ outbounds: [outbound] }) },
      { body: fakeReturnResponse({ returns: [returnLeg] }) },
    ],
  });

  const offers = await provider.search(queryRoundTrip);

  assert.equal(offers.length, 1);
  assert.equal(calls.length, 2); // fórmula: 1 + tokens expandidos

  const firstUrl = new URL(calls[0]);
  assert.equal(firstUrl.searchParams.get('type'), '1');
  assert.equal(firstUrl.searchParams.get('outbound_date'), '2027-03-10');
  assert.equal(firstUrl.searchParams.get('return_date'), '2027-03-20');

  const secondUrl = new URL(calls[1]);
  assert.equal(secondUrl.searchParams.get('departure_token'), 'SYNTHETIC_DEPARTURE_TOKEN');

  // Preço: pendência registrada — preço do retorno usado como preço do trip.
  assert.equal(offers[0].price, 2100);
  assert.equal(offers[0].type, 'round trip');
  assert.equal(offers[0].outbound.flights[0].flight_number, 'FA100');
  assert.equal(offers[0].return.flights[0].flight_number, 'FA200');
});

// ------------------------------------------------------------- expansão

test('expansão N=1 (default): 2 requisições e apenas a melhor ida expandida', async () => {
  const outbounds = [
    fakeItinerary({ price: 1000, flightNumber: 'FA100', departureToken: 'T1' }),
    fakeItinerary({ price: 1100, flightNumber: 'FA101', departureToken: 'T2' }),
    fakeItinerary({ price: 1200, flightNumber: 'FA102', departureToken: 'T3' }),
  ];

  const { provider, calls } = createProvider({
    responses: [
      { body: fakeInitialRoundTripResponse({ outbounds }) },
      { body: fakeReturnResponse({ returns: [fakeItinerary({ price: 2000 })] }) },
    ],
    maxOutboundExpansions: 1, // default
  });

  const offers = await provider.search(queryRoundTrip);

  assert.equal(calls.length, 2); // 1 + 1 token
  assert.equal(offers.length, 1);
  assert.equal(offers[0].outbound.flights[0].flight_number, 'FA100'); // determinístico: menor preço
});

test('expansão N=3: 4 requisições, 3 ofertas combinadas', async () => {
  const outbounds = [
    fakeItinerary({ price: 1000, flightNumber: 'FA100', departureToken: 'T1' }),
    fakeItinerary({ price: 1100, flightNumber: 'FA101', departureToken: 'T2' }),
    fakeItinerary({ price: 1200, flightNumber: 'FA102', departureToken: 'T3' }),
    fakeItinerary({ price: 1300, flightNumber: 'FA103', departureToken: 'T4' }),
  ];

  const { provider, calls } = createProvider({
    responses: [
      { body: fakeInitialRoundTripResponse({ outbounds }) },
      { body: fakeReturnResponse({ returns: [fakeItinerary({ price: 2000, flightNumber: 'FR100' })] }) },
      { body: fakeReturnResponse({ returns: [fakeItinerary({ price: 2100, flightNumber: 'FR101' })] }) },
      { body: fakeReturnResponse({ returns: [fakeItinerary({ price: 2200, flightNumber: 'FR102' })] }) },
    ],
    maxOutboundExpansions: 3,
  });

  const offers = await provider.search(queryRoundTrip);

  assert.equal(calls.length, 4); // fórmula: 1 + 3 tokens
  assert.equal(offers.length, 3);

  const tokens = calls.slice(1).map((call) => new URL(call).searchParams.get('departure_token'));
  assert.deepEqual(tokens, ['T1', 'T2', 'T3']); // determinístico (ordem por preço)
});

test('expansão N=5: 6 requisições com 5 tokens', async () => {
  const outbounds = Array.from({ length: 8 }, (_, index) =>
    fakeItinerary({ price: 1000 + index * 100, flightNumber: `FA1${index}`, departureToken: `T${index}` })
  );

  const responses = [{ body: fakeInitialRoundTripResponse({ outbounds }) }];
  for (let index = 0; index < 5; index += 1) {
    responses.push({ body: fakeReturnResponse({ returns: [fakeItinerary({ price: 2000 + index * 10 })] }) });
  }

  const { provider, calls } = createProvider({ responses, maxOutboundExpansions: 5 });
  const offers = await provider.search(queryRoundTrip);

  assert.equal(calls.length, 6); // 1 + 5 tokens
  assert.equal(offers.length, 5);
});

test('expansão N=10 (máximo): 11 requisições, 10 ofertas', async () => {
  const outbounds = Array.from({ length: 15 }, (_, index) =>
    fakeItinerary({ price: 1000 + index * 100, flightNumber: `FA1${index}`, departureToken: `T${index}` })
  );

  const responses = [{ body: fakeInitialRoundTripResponse({ outbounds }) }];
  for (let index = 0; index < 10; index += 1) {
    responses.push({ body: fakeReturnResponse({ returns: [fakeItinerary({ price: 2000 + index * 10 })] }) });
  }

  const { provider, calls } = createProvider({ responses, maxOutboundExpansions: 10 });
  const offers = await provider.search(queryRoundTrip);

  assert.equal(calls.length, 11); // 1 + 10 tokens
  assert.equal(offers.length, 10);
});

test('maxOutboundExpansions > 10 é rejeitado na construção', () => {
  assert.throws(
    () => createSerpApiFlightProvider({
      apiKey: API_KEY,
      fetchImpl: async () => ({}),
      maxOutboundExpansions: 11,
    }),
    TypeError
  );
  assert.throws(
    () => createSerpApiFlightProvider({ apiKey: API_KEY, fetchImpl: async () => ({}), maxOutboundExpansions: 0 }),
    TypeError
  );
});

test('seleção determinística: mesma resposta produz a mesma expansão', async () => {
  const outbounds = [
    fakeItinerary({ price: 1000, flightNumber: 'FA100', departureToken: 'T_B' }),
    fakeItinerary({ price: 1000, flightNumber: 'FA101', departureToken: 'T_A' }), // empate de preço
  ];

  const run = async () => {
    const { provider, calls } = createProvider({
      responses: [
        { body: fakeInitialRoundTripResponse({ outbounds }) },
        { body: fakeReturnResponse({ returns: [fakeItinerary({ price: 2000 })] }) },
      ],
    });
    const offers = await provider.search(queryRoundTrip);
    return { token: new URL(calls[1]).searchParams.get('departure_token'), offers };
  };

  const first = await run();
  const second = await run();

  // Empate de preço: desempate por duração/hora/companhia — FA100 vence.
  assert.equal(first.token, 'T_B');
  assert.deepEqual(first.token, second.token);
  assert.deepEqual(first.offers, second.offers);
});

// --------------------------------------------------- ida simples sem expansão

test('ida simples: SEM expansão (1 requisição por ciclo)', async () => {
  const { provider, calls } = createProvider({
    responses: [{ body: fakeOneWayResponse({ outbounds: [fakeItinerary()] }) }],
    maxOutboundExpansions: 5, // irrelevante para ida simples
  });

  const offers = await provider.search(queryOneWay);

  assert.equal(calls.length, 1);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].type, 'one way');
});

// --------------------------------------------------------- casos de erro

test('mercado vazio (sem best_flights/other_flights) -> [] válido', async () => {
  const { provider } = createProvider({ responses: [{ body: {} }] });
  const offers = await provider.search(queryOneWay);
  assert.deepEqual(offers, []);
});

test('round-trip com itinerários mas SEM departure_token -> erro (anomalia)', async () => {
  const { provider } = createProvider({
    responses: [{ body: fakeInitialRoundTripResponse({ outbounds: [fakeItinerary({ price: 1000 })] }) }],
  });

  await assert.rejects(() => provider.search(queryRoundTrip), /departure_token/);
});

test('erro HTTP 4xx/5xx -> erro com status, sem corpo e sem chave', async () => {
  const { provider } = createProvider({ responses: [{ ok: false, status: 429, body: { error: 'rate limited' } }] });

  await assert.rejects(
    () => provider.search(queryOneWay),
    (error) => {
      assert.ok(String(error.message).includes('429'));
      assert.ok(!String(error.message).includes(API_KEY));
      return true;
    }
  );
});

test('timeout -> erro de timeout (AbortController), sem chave', async () => {
  const slowFetch = async (url) => {
    void url;
    return new Promise((resolve, reject) => {
      setTimeout(() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), 50);
    });
  };

  const provider = createSerpApiFlightProvider({
    apiKey: API_KEY,
    fetchImpl: slowFetch,
    timeoutMs: 10,
    airportResolver: fakeResolver([
      { text: 'São Paulo, Brasil', matches: ['GRU'] },
      { text: 'Lisboa, Portugal', matches: ['LIS'] },
    ]),
  });

  await assert.rejects(() => provider.search(queryOneWay), /timeout/);
});

test('JSON inválido -> erro, sem chave', async () => {
  const { provider } = createProvider({ responses: [{ body: '<html>not json</html>' }] });

  await assert.rejects(
    () => provider.search(queryOneWay),
    (error) => {
      assert.ok(String(error.message).includes('JSON'));
      assert.ok(!String(error.message).includes(API_KEY));
      return true;
    }
  );
});

test('itinerário malformado (sem price) -> erro de resposta inválida', async () => {
  const broken = fakeItinerary();
  delete broken.price;

  const { provider } = createProvider({
    responses: [{ body: fakeOneWayResponse({ outbounds: [broken] }) }],
  });

  await assert.rejects(() => provider.search(queryOneWay), /inválida/);
});

test('expansão de retorno vazia -> erro (anomalia)', async () => {
  const { provider } = createProvider({
    responses: [
      { body: fakeInitialRoundTripResponse({ outbounds: [fakeItinerary({ departureToken: 'T1' })] }) },
      { body: fakeReturnResponse({ returns: [] }) },
    ],
  });

  await assert.rejects(() => provider.search(queryRoundTrip), /anomalia/);
});

// ---------------------------------------------------------- localidades

test('localidade não resolvida -> erro explícito (nunca inventa match)', async () => {
  const { provider } = createProvider({ responses: [] });

  await assert.rejects(
    () => provider.search({
      origin: 'Cidade Inexistente, Brasil',
      destination: 'Lisboa, Portugal',
      departureDate: '2027-03-10',
    }),
    /não resolvida/
  );
});

test('consulta inválida (origin ausente / data malformada) -> TypeError', async () => {
  const { provider } = createProvider({ responses: [] });

  await assert.rejects(() => provider.search({ destination: 'Lisboa, Portugal', departureDate: '2027-03-10' }), TypeError);
  await assert.rejects(() => provider.search({ ...queryOneWay, departureDate: '10/03/2027' }), TypeError);
  await assert.rejects(() => provider.search({ ...queryRoundTrip, returnDate: '20/03/2027' }), TypeError);
});

test('construção sem chave ou com fetch inválido -> TypeError', () => {
  assert.throws(() => createSerpApiFlightProvider({ apiKey: '  ', fetchImpl: async () => ({}) }), TypeError);
  assert.throws(() => createSerpApiFlightProvider({ apiKey: API_KEY, fetchImpl: null }), TypeError);
});

// ---------------------------------------------------------- price insights

test('price_insights segue como metadado no raw (não se mistura ao histórico)', async () => {
  const { provider } = createProvider({
    responses: [{
      body: fakeOneWayResponse({
        outbounds: [fakeItinerary()],
        priceInsights: SYNTHETIC_PRICE_INSIGHTS,
      }),
    }],
  });

  const offers = await provider.search(queryOneWay);

  assert.equal(offers.length, 1);
  // O metadado é transportado NO raw; cabe ao normalizador colocá-lo em
  // relatedQuery.priceInsights — nunca em PriceHistory (testes em normalize).
  assert.deepEqual(offers[0].price_insights, SYNTHETIC_PRICE_INSIGHTS);
  assert.equal(offers[0].price, 1000); // preço da oferta independe do insights
});

// ----------------------------------------------------- round-trip: D4

// Correção da auditoria D4 — resposta MISTA (idas com e sem token): as
// idas sem token são descartadas silenciosamente quando outras têm token
// (comportamento documentado no adaptador, não é anomalia); a expansão usa
// apenas as com token, na ordem determinística.
test('round-trip (D4): resposta mista com e sem token — sem-token sai da seleção', async () => {
  const withoutTokenCheap = fakeItinerary({
    price: 500, // MAIS BARATA, mas sem token — não pode ser expandida
    departureToken: undefined,
    flightNumber: 'FA900',
  });
  const withToken1 = fakeItinerary({ price: 900, departureToken: 'TOKEN_A', flightNumber: 'FA101' });
  const withToken2 = fakeItinerary({ price: 1200, departureToken: 'TOKEN_B', flightNumber: 'FA102' });

  const { provider, calls } = createProvider({
    maxOutboundExpansions: 2,
    responses: [
      { body: fakeInitialRoundTripResponse({ outbounds: [withoutTokenCheap, withToken1, withToken2] }) },
      { body: fakeReturnResponse({ returns: [fakeItinerary({ price: 1500, departTime: '2027-03-20 12:00' })] }) },
      { body: fakeReturnResponse({ returns: [fakeItinerary({ price: 1600, departTime: '2027-03-20 13:00' })] }) },
    ],
  });

  const offers = await provider.search(queryRoundTrip);

  // Apenas as 2 idas COM token foram expandidas (1 + 2 requisições).
  assert.equal(calls.length, 3);
  assert.equal(offers.length, 2);

  const tokens = calls
    .slice(1)
    .map((call) => new URL(call).searchParams.get('departure_token'));
  // TOKEN_A antes de TOKEN_B: ordem determinística por preço (900 < 1200).
  assert.deepEqual(tokens, ['TOKEN_A', 'TOKEN_B']);
  // A ida mais barata (500) NÃO aparece em nenhuma expansão.
  assert.ok(!tokens.includes(undefined));
});

test('round-trip (D4): ida mais barata sem token + TODAS as outras sem token -> anomalia', async () => {
  // Regra existente preservada: se NENHUM itinerário tem token, é anomalia.
  const { provider } = createProvider({
    responses: [
      { body: fakeInitialRoundTripResponse({ outbounds: [fakeItinerary({ price: 500 }), fakeItinerary({ price: 700 })] }) },
    ],
  });

  await assert.rejects(() => provider.search(queryRoundTrip), /departure_token/);
});

// Correção da auditoria D4 — tokens DUPLICADOS: o mesmo departure_token
// repetido na resposta NÃO dispara a 2ª requisição duas vezes (dedup
// determinístico mantém a 1ª ocorrência na ordem por preço).
test('round-trip (D4): tokens duplicados são dedupados — uma requisição por token único', async () => {
  const cheapDuplicate = fakeItinerary({ price: 700, departureToken: 'TOKEN_DUP', flightNumber: 'FA111' });
  const expensiveDuplicate = fakeItinerary({ price: 800, departureToken: 'TOKEN_DUP', flightNumber: 'FA112' });
  const unique = fakeItinerary({ price: 1200, departureToken: 'TOKEN_UNIQUE', flightNumber: 'FA113' });

  const { provider, calls } = createProvider({
    maxOutboundExpansions: 2,
    responses: [
      { body: fakeInitialRoundTripResponse({ outbounds: [expensiveDuplicate, cheapDuplicate, unique] }) },
      { body: fakeReturnResponse({ returns: [fakeItinerary({ price: 1500, departTime: '2027-03-20 12:00' })] }) },
      { body: fakeReturnResponse({ returns: [fakeItinerary({ price: 1600, departTime: '2027-03-20 13:00' })] }) },
    ],
  });

  const offers = await provider.search(queryRoundTrip);

  // 1 inicial + 2 expansões (TOKEN_DUP expandido UMA vez + TOKEN_UNIQUE).
  assert.equal(calls.length, 3);
  const tokens = calls.slice(1).map((call) => new URL(call).searchParams.get('departure_token'));
  assert.deepEqual(tokens, ['TOKEN_DUP', 'TOKEN_UNIQUE']);
  assert.equal(offers.length, 2);
});

// Correção da auditoria D4 — falha na 2ª requisição ABORTA a busca inteira:
// não há resultado parcial de round-trip.
test('round-trip (D4): falha HTTP na expansão aborta tudo (sem oferta parcial)', async () => {
  const { provider, calls } = createProvider({
    maxOutboundExpansions: 2,
    responses: [
      { body: fakeInitialRoundTripResponse({ outbounds: [fakeItinerary({ price: 900, departureToken: 'TOKEN_A' }), fakeItinerary({ price: 1200, departureToken: 'TOKEN_B' })] }) },
      { ok: false, status: 500 }, // 1ª expansão falha
    ],
  });

  await assert.rejects(() => provider.search(queryRoundTrip), (error) => {
    assert.ok(String(error.message).includes('500'));
    return true;
  });

  // Nenhuma oferta parcial: a 2ª expansão nem aconteceu.
  assert.equal(calls.length, 2);
});
