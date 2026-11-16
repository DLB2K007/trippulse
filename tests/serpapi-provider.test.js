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
import { normalizeFlightOffer } from '../apps/api/src/integrations/flight-providers/normalize.js';
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
  assert.equal(url.searchParams.get('hl'), 'pt-BR');
  assert.equal(url.searchParams.get('gl'), 'br');
  assert.equal(url.searchParams.get('travel_class'), '1');
  assert.equal(url.searchParams.get('departure_id'), 'GRU,CGH,VCP'); // multi-aeroporto
  assert.equal(url.searchParams.get('arrival_id'), 'LIS');
  assert.equal(url.searchParams.get('outbound_date'), '2027-03-10');
  assert.equal(url.searchParams.get('type'), '2');
  assert.equal(url.searchParams.get('return_date'), null);
  assert.equal(url.searchParams.get('departure_token'), null);
  assert.equal(url.searchParams.get('booking_token'), null);
  assert.equal(url.searchParams.get('currency'), 'BRL');
  assert.equal(url.searchParams.getAll('api_key').length, 1);
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

  // Contrato da 2ª requisição (D3, Alternativa B): repete TODO o contexto da
  // 1ª pesquisa, com `type=1` explícito, e só acrescenta o token.
  const secondUrl = new URL(calls[1]);
  for (const key of [
    'engine',
    'hl',
    'gl',
    'currency',
    'travel_class',
    'type',
    'departure_id',
    'arrival_id',
    'outbound_date',
    'return_date',
  ]) {
    assert.equal(
      secondUrl.searchParams.get(key),
      firstUrl.searchParams.get(key),
      `2ª requisição deve preservar '${key}'`
    );
  }
  assert.equal(secondUrl.searchParams.get('type'), '1');
  assert.equal(secondUrl.searchParams.get('departure_id'), 'GRU,CGH,VCP');
  assert.equal(secondUrl.searchParams.get('arrival_id'), 'LIS');
  assert.equal(secondUrl.searchParams.get('outbound_date'), '2027-03-10');
  assert.equal(secondUrl.searchParams.get('return_date'), '2027-03-20');
  assert.equal(secondUrl.searchParams.get('departure_token'), 'SYNTHETIC_DEPARTURE_TOKEN');
  assert.equal(secondUrl.searchParams.get('booking_token'), null);
  assert.equal(secondUrl.searchParams.getAll('api_key').length, 1);
  assert.equal(secondUrl.searchParams.get('api_key'), API_KEY);

  // Preço: pendência registrada — preço do retorno usado como preço do trip.
  assert.equal(offers[0].price, 2100);
  assert.equal(offers[0].currency, 'BRL'); // moeda validada na resposta
  assert.equal(offers[0].type, 'round trip');
  assert.equal(offers[0].outbound.flights[0].flight_number, 'FA100');
  assert.equal(offers[0].return.flights[0].flight_number, 'FA200');
});

test('raw round-trip: token usado na 2ª requisição e removido do resultado sem mutar a resposta', async () => {
  const outboundToken = 'SYNTHETIC_OUTBOUND_TOKEN';
  const returnToken = 'SYNTHETIC_RETURN_TOKEN';
  const outbound = fakeItinerary({
    price: 1000,
    flightNumber: 'FA100',
    departureToken: outboundToken,
  });
  const returnLeg = fakeItinerary({
    fromId: 'LIS',
    toId: 'GRU',
    price: 2100,
    flightNumber: 'FA200',
    departTime: '2027-03-20 12:00',
    arriveTime: '2027-03-20 21:00',
    departureToken: returnToken,
  });

  const initialBody = fakeInitialRoundTripResponse({ outbounds: [outbound] });
  const returnBody = fakeReturnResponse({ returns: [returnLeg] });
  const initialSnapshot = structuredClone(initialBody);
  const returnSnapshot = structuredClone(returnBody);

  const { provider, calls } = createProvider({
    responses: [{ body: initialBody }, { body: returnBody }],
  });

  const offers = await provider.search(queryRoundTrip);

  // 1. O token continua sendo enviado corretamente na 2ª requisição.
  assert.equal(calls.length, 2);
  assert.equal(
    new URL(calls[1]).searchParams.get('departure_token'),
    outboundToken
  );

  // 2-5. O raw offer final não contém o token em nenhum de seus objetos.
  const raw = offers[0];
  assert.equal('departure_token' in raw, false);
  assert.equal('departure_token' in raw.outbound, false);
  assert.equal('departure_token' in raw.return, false);
  assert.equal('extra' in raw, false);
  assert.ok(!JSON.stringify(raw).includes(outboundToken), 'token de ida vazou no raw');
  assert.ok(!JSON.stringify(raw).includes(returnToken), 'token de retorno vazou no raw');

  // 6. Os demais campos dos itinerários são preservados.
  const expectedOutbound = structuredClone(outbound);
  delete expectedOutbound.departure_token;
  const expectedReturn = structuredClone(returnLeg);
  delete expectedReturn.departure_token;
  assert.deepEqual(raw.outbound, expectedOutbound);
  assert.deepEqual(raw.return, expectedReturn);
  assert.equal(raw.outbound.flights[0].flight_number, 'FA100');
  assert.equal(raw.return.flights[0].flight_number, 'FA200');
  assert.equal(raw.price, 2100);
  assert.equal(raw.currency, 'BRL');
  assert.equal(raw.type, 'round trip');

  // 7. As respostas originais recebidas da SerpApi não sofrem mutação.
  assert.deepEqual(initialBody, initialSnapshot);
  assert.deepEqual(returnBody, returnSnapshot);

  // 8. A normalização continua sem transportar o token.
  const normalized = normalizeFlightOffer(provider, raw, {
    destination: 'Lisboa, Portugal',
    departureDate: '2027-03-10',
    returnDate: '2027-03-20',
  });
  assert.ok(!JSON.stringify(normalized).includes(outboundToken));
  assert.ok(!JSON.stringify(normalized).includes(returnToken));
  assert.equal('departure_token' in normalized, false);
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
  assert.equal(offers[0].currency, 'BRL');
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

// ------------------------------------------- contrato de resposta (D3)

test('HTTP 200 com error não vazio -> erro do provedor (nunca mercado vazio)', async () => {
  const { provider } = createProvider({
    responses: [{ body: fakeOneWayResponse({ outbounds: [], error: 'invalid departure_id' }) }],
  });

  await assert.rejects(() => provider.search(queryOneWay), /erro do provedor/);
});

test('error vazio não é falha — resposta segue válida', async () => {
  const { provider } = createProvider({
    responses: [{ body: fakeOneWayResponse({ outbounds: [fakeItinerary()], error: '' }) }],
  });

  const offers = await provider.search(queryOneWay);
  assert.equal(offers.length, 1);
});

test('HTTP 200 com error na 2ª requisição aborta a busca inteira', async () => {
  const { provider, calls } = createProvider({
    maxOutboundExpansions: 2,
    responses: [
      {
        body: fakeInitialRoundTripResponse({
          outbounds: [
            fakeItinerary({ price: 900, departureToken: 'TOKEN_A' }),
            fakeItinerary({ price: 1200, departureToken: 'TOKEN_B' }),
          ],
        }),
      },
      { body: fakeReturnResponse({ returns: [fakeItinerary()], error: 'departure_token expired' }) },
    ],
  });

  await assert.rejects(() => provider.search(queryRoundTrip), /erro do provedor/);
  assert.equal(calls.length, 2); // nenhuma oferta parcial; 2ª expansão nem aconteceu
});

test('status "Error" na 2ª requisição aborta a busca inteira (sem resultado parcial)', async () => {
  const { provider, calls } = createProvider({
    maxOutboundExpansions: 2,
    responses: [
      {
        body: fakeInitialRoundTripResponse({
          outbounds: [
            fakeItinerary({ price: 900, departureToken: 'TOKEN_A' }),
            fakeItinerary({ price: 1200, departureToken: 'TOKEN_B' }),
          ],
        }),
      },
      // HTTP 200 + status de falha na expansão: mesmo caminho de validação da
      // busca inicial, mas comprovado na 2ª resposta.
      { body: fakeReturnResponse({ returns: [fakeItinerary()], status: 'Error' }) },
    ],
  });

  await assert.rejects(
    () => provider.search(queryRoundTrip),
    (error) => {
      const message = String(error.message);
      assert.match(message, /status "Error"/);
      assert.ok(message.includes('expansão de retorno'), 'erro deve indicar o contexto da 2ª requisição');
      // Nenhum segredo na mensagem: sem chave, sem URL completa e sem o token
      // de ida selecionado (que só aparece na URL da requisição, nunca no erro).
      assert.ok(!message.includes(API_KEY), 'api_key vazou');
      assert.ok(!message.includes('https://'), 'URL completa vazou');
      assert.ok(!message.includes('TOKEN_A') && !message.includes('TOKEN_B'), 'departure_token vazou');
      return true;
    }
  );

  // Abort-all: a 1ª expansão falhou e a 2ª nem foi disparada; nenhuma oferta
  // parcial é devolvida (a rejeição acima é a única saída).
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[1]).searchParams.get('departure_token'), 'TOKEN_A');
});

test('status Processing/Queued/Error/desconhecido -> erro; Success aceito sem distinção de caixa', async () => {
  const failureStatuses = [
    { status: 'Processing', expected: /status "Processing"/ },
    { status: 'Queued', expected: /status "Queued"/ },
    { status: 'Error', expected: /status "Error"/ },
    // Desconhecido é fail-closed sem ecoar o valor externo arbitrário.
    { status: 'SomethingNew', expected: /status desconhecido/ },
  ];

  for (const { status, expected } of failureStatuses) {
    const { provider } = createProvider({
      responses: [{ body: fakeOneWayResponse({ outbounds: [fakeItinerary()], status }) }],
    });
    await assert.rejects(
      () => provider.search(queryOneWay),
      (error) => {
        const message = String(error.message);
        assert.match(message, expected, `status ${status} deveria falhar`);
        if (status === 'SomethingNew') {
          assert.ok(!message.includes(status), 'status desconhecido não pode ser ecoado');
        }
        return true;
      }
    );
  }

  for (const status of ['Success', 'success', 'SUCCESS']) {
    const { provider } = createProvider({
      responses: [{ body: fakeOneWayResponse({ outbounds: [fakeItinerary()], status }) }],
    });
    const offers = await provider.search(queryOneWay);
    assert.equal(offers.length, 1, `status ${status} deveria ser aceito`);
  }
});

test('search_metadata ausente é tolerado', async () => {
  const { provider } = createProvider({
    responses: [{ body: fakeOneWayResponse({ outbounds: [fakeItinerary()], status: null }) }],
  });

  const offers = await provider.search(queryOneWay);
  assert.equal(offers.length, 1);
});

test('mercado vazio com Success e sem erro -> [] válido', async () => {
  const { provider } = createProvider({
    responses: [{ body: fakeOneWayResponse({ outbounds: [] }) }],
  });

  const offers = await provider.search(queryOneWay);
  assert.deepEqual(offers, []);
});

test('mensagens de erro não expõem api_key, URL completa nem departure_token', async () => {
  const leaked =
    'boom api_key=SYNTHETIC_API_KEY departure_token=TOKEN_SECRET https://serpapi.com/search.json?api_key=SYNTHETIC_API_KEY';
  const { provider } = createProvider({ responses: [{ body: fakeOneWayResponse({ error: leaked }) }] });

  await assert.rejects(
    () => provider.search(queryOneWay),
    (error) => {
      const message = String(error.message);
      assert.ok(!message.includes(API_KEY), 'chave vazou');
      assert.ok(!message.includes('TOKEN_SECRET'), 'departure_token vazou');
      assert.ok(!message.includes('https://serpapi.com/search.json'), 'URL completa vazou');
      // O texto externo não é propagado: a mensagem é controlada pela aplicação.
      assert.ok(!message.includes('boom'), 'conteúdo bruto do provedor vazou');
      assert.ok(!message.includes('[REDACTED]'), 'texto externo não deve ser ecoado nem parcialmente');
      assert.match(message, /erro do provedor/);
      return true;
    }
  );
});

// Token sintético com caracteres que exigem percent-encoding em query string:
// '+', '/', '=', '&', espaço e '%'. Nenhuma credencial real é usada.
const SPECIAL_DEPARTURE_TOKEN = 'a+b/c=d&e f%g';
const ENCODED_SPECIAL_DEPARTURE_TOKEN = new URLSearchParams({
  departure_token: SPECIAL_DEPARTURE_TOKEN,
})
  .toString()
  .slice('departure_token='.length);

test('departure_token especial: URL codificada, token íntegro e sem segredo em erro', async () => {
  const { provider, calls } = createProvider({
    responses: [
      {
        body: fakeInitialRoundTripResponse({
          outbounds: [fakeItinerary({ departureToken: SPECIAL_DEPARTURE_TOKEN })],
        }),
      },
      { body: fakeReturnResponse({ returns: [fakeItinerary({ price: 2000 })] }) },
    ],
  });

  const offers = await provider.search(queryRoundTrip);
  assert.equal(calls.length, 2);
  assert.equal(offers.length, 1);

  const secondUrl = new URL(calls[1]);

  // 1. Decodificação devolve o token ORIGINAL, sem truncamento em '+', '&' ou
  //    espaço e sem alteração de '%'.
  assert.equal(secondUrl.searchParams.get('departure_token'), SPECIAL_DEPARTURE_TOKEN);

  // 2. A URL crua transmite o token percent-encoded: '&' não quebra a query e
  //    espaço não vira separador. Comparação com a mesma codificação canônica
  //    usada pelo adaptador (URLSearchParams).
  const rawQuery = calls[1].slice(calls[1].indexOf('?') + 1);
  const rawTokenParam = rawQuery
    .split('&')
    .find((part) => part.startsWith('departure_token='));
  assert.ok(rawTokenParam, 'departure_token ausente na URL da 2ª requisição');
  assert.equal(
    rawTokenParam,
    new URLSearchParams({ departure_token: SPECIAL_DEPARTURE_TOKEN }).toString()
  );
  assert.ok(!calls[1].includes(SPECIAL_DEPARTURE_TOKEN), 'token deveria estar codificado na URL crua');

  // 3. api_key exatamente uma vez e correta; booking_token nunca enviado.
  assert.equal(secondUrl.searchParams.getAll('api_key').length, 1);
  assert.equal(secondUrl.searchParams.get('api_key'), API_KEY);
  assert.equal(secondUrl.searchParams.get('booking_token'), null);

  // 4. Nenhum segredo no resultado devolvido: o raw offer final não carrega o
  //    token (usado somente para a 2ª requisição).
  assert.ok(!JSON.stringify(offers).includes(API_KEY), 'api_key vazou no resultado');
  assert.ok(
    !JSON.stringify(offers).includes(SPECIAL_DEPARTURE_TOKEN),
    'departure_token vazou no raw offer'
  );

  // 5. Falha posterior ecoando o token COMO TRANSMITIDO (percent-encoded) não
  //    expõe o token, a chave nem a URL completa na mensagem de erro.
  const encodedToken = ENCODED_SPECIAL_DEPARTURE_TOKEN;
  const failing = createProvider({
    responses: [
      {
        body: fakeInitialRoundTripResponse({
          outbounds: [fakeItinerary({ departureToken: SPECIAL_DEPARTURE_TOKEN })],
        }),
      },
      {
        body: fakeReturnResponse({
          returns: [fakeItinerary()],
          error: `upstream rejected departure_token=${encodedToken}`,
        }),
      },
    ],
  });

  await assert.rejects(
    () => failing.provider.search(queryRoundTrip),
    (error) => {
      const message = String(error.message);
      assert.ok(!message.includes(SPECIAL_DEPARTURE_TOKEN), 'token original vazou');
      assert.ok(!message.includes(encodedToken), 'token codificado vazou');
      assert.ok(!message.includes(API_KEY), 'api_key vazou');
      assert.ok(!message.includes('https://'), 'URL completa vazou');
      assert.match(message, /erro do provedor/);
      assert.ok(!message.includes('[REDACTED]'), 'texto externo não deve ser ecoado');
      return true;
    }
  );
  assert.equal(failing.calls.length, 2);
});

// Casos exigidos pela auditoria de confidencialidade: o token pode aparecer
// literal ou codificado, com ou sem prefixo, e até sozinho. Em todos os casos
// o texto externo é descartado e a mensagem permanece contextual e segura.
test('erros externos com token especial literal/codificado não vazam dados sensíveis', async () => {
  const cases = [
    {
      label: 'literal com prefixo departure_token=',
      error: `upstream rejected departure_token=${SPECIAL_DEPARTURE_TOKEN}`,
    },
    {
      label: 'literal sem prefixo',
      error: `invalid token ${SPECIAL_DEPARTURE_TOKEN}`,
    },
    {
      label: 'literal contendo & e espaços',
      error: `upstream rejected ${SPECIAL_DEPARTURE_TOKEN} at the boundary`,
    },
    {
      label: 'percent-encoded com prefixo departure_token=',
      error: `upstream rejected departure_token=${ENCODED_SPECIAL_DEPARTURE_TOKEN}`,
    },
    {
      label: 'percent-encoded sem prefixo',
      error: `invalid token ${ENCODED_SPECIAL_DEPARTURE_TOKEN}`,
    },
    {
      label: 'valor apresentado com token=',
      error: `token=${SPECIAL_DEPARTURE_TOKEN}`,
    },
    {
      label: 'mensagem contendo somente o valor do token',
      error: SPECIAL_DEPARTURE_TOKEN,
    },
  ];

  for (const { label, error } of cases) {
    const { provider, calls } = createProvider({
      responses: [
        {
          body: fakeInitialRoundTripResponse({
            outbounds: [fakeItinerary({ departureToken: SPECIAL_DEPARTURE_TOKEN })],
          }),
        },
        { body: fakeReturnResponse({ returns: [fakeItinerary()], error }) },
      ],
    });

    await assert.rejects(
      () => provider.search(queryRoundTrip),
      (received) => {
        const message = String(received.message);
        assert.ok(!message.includes(SPECIAL_DEPARTURE_TOKEN), `${label}: token literal vazou`);
        assert.ok(!message.includes(ENCODED_SPECIAL_DEPARTURE_TOKEN), `${label}: token codificado vazou`);
        assert.ok(!message.includes(API_KEY), `${label}: api_key vazou`);
        assert.ok(!message.includes('https://'), `${label}: URL completa vazou`);
        assert.ok(!message.includes('upstream'), `${label}: texto externo vazou`);
        assert.match(message, /erro do provedor/);
        assert.match(message, /expansão de retorno/);
        return true;
      }
    );

    assert.equal(calls.length, 2, `${label}: a falha deve abortar sem resultado parcial`);
  }
});

test('exceção de rede com URL, api_key e departure_token não vaza dados sensíveis', async () => {
  const networkMessage =
    `network failure https://serpapi.com/search.json?api_key=${API_KEY}` +
    `&departure_token=${ENCODED_SPECIAL_DEPARTURE_TOKEN} (${SPECIAL_DEPARTURE_TOKEN})`;
  const { provider, calls } = createProvider({
    responses: [
      {
        body: fakeInitialRoundTripResponse({
          outbounds: [fakeItinerary({ departureToken: SPECIAL_DEPARTURE_TOKEN })],
        }),
      },
      new Error(networkMessage),
    ],
  });

  await assert.rejects(
    () => provider.search(queryRoundTrip),
    (error) => {
      const message = String(error.message);
      assert.match(message, /falha de rede/);
      assert.match(message, /expansão de retorno/);
      assert.ok(!message.includes(SPECIAL_DEPARTURE_TOKEN), 'token literal vazou');
      assert.ok(!message.includes(ENCODED_SPECIAL_DEPARTURE_TOKEN), 'token codificado vazou');
      assert.ok(!message.includes(API_KEY), 'api_key vazou');
      assert.ok(!message.includes('https://'), 'URL completa vazou');
      assert.ok(!message.includes('network failure'), 'mensagem bruta de rede vazou');
      return true;
    }
  );

  assert.equal(calls.length, 2, 'a falha de rede deve abortar sem resultado parcial');
});

// --------------------------------------------------------------- moeda (D3)

test('moeda: BRL explícito (inclusive minúsculas) -> raw offer BRL', async () => {
  for (const currency of ['BRL', 'brl', 'Brl']) {
    const { provider } = createProvider({
      responses: [{ body: fakeOneWayResponse({ outbounds: [fakeItinerary()], currency }) }],
    });
    const offers = await provider.search(queryOneWay);
    assert.equal(offers[0].currency, 'BRL', `moeda ${currency} deveria normalizar para BRL`);
  }
});

test('moeda: USD na resposta -> erro alto (sem conversão)', async () => {
  const { provider } = createProvider({
    responses: [{ body: fakeOneWayResponse({ outbounds: [fakeItinerary()], currency: 'USD' }) }],
  });

  await assert.rejects(
    () => provider.search(queryOneWay),
    (error) => {
      const message = String(error.message);
      assert.match(message, /moeda da resposta.*difere da solicitada \(BRL\)/);
      assert.ok(!message.includes('USD'), 'valor de moeda externo não deve ser ecoado');
      return true;
    }
  );
});

test('moeda: ausente -> fallback BRL (requisição enviou currency=BRL)', async () => {
  const { provider } = createProvider({
    responses: [{ body: fakeOneWayResponse({ outbounds: [fakeItinerary()], currency: null }) }],
  });

  const offers = await provider.search(queryOneWay);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].currency, 'BRL');
});

test('moeda: divergência na 2ª requisição aborta a busca', async () => {
  const { provider } = createProvider({
    responses: [
      { body: fakeInitialRoundTripResponse({ outbounds: [fakeItinerary({ departureToken: 'T1' })] }) },
      { body: fakeReturnResponse({ returns: [fakeItinerary({ price: 2000 })], currency: 'USD' }) },
    ],
  });

  await assert.rejects(
    () => provider.search(queryRoundTrip),
    (error) => {
      const message = String(error.message);
      assert.match(message, /moeda da resposta.*difere da solicitada \(BRL\)/);
      assert.ok(!message.includes('USD'), 'valor de moeda externo não deve ser ecoado');
      return true;
    }
  );
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
