// Testes unitários do normalizador de ofertas de voos.
// Execução: node --test

import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeFlightOffer } from '../apps/api/src/integrations/flight-providers/normalize.js';

const relatedQuery = {
  destination: 'Lisboa, Portugal',
  departureDate: '2027-03-10',
  returnDate: '2027-03-20',
};

const simulatedProvider = {
  name: 'simulated-airways',
  isSimulated: true,
};

function buildRawOffer(overrides = {}) {
  return {
    result_id: 'SIM-LIS-123456',
    route: { origin_iata: 'GRU', destination_iata: 'LIS' },
    outbound_leg: {
      carrier_name: 'Simulated Airways',
      carrier_code: 'SIA',
      flight_number: 'SIA1234',
      depart_at: '2027-03-10T06:00:00Z',
      arrive_at: '2027-03-10T18:00:00Z',
      connection_count: 0,
      seat_class: 'ECONOMY',
    },
    pricing: { currency: 'BRL', fare_brl: 1000, tax_fees_brl: 100, grand_total_brl: 1100 },
    baggage_pieces: 0,
    refundable: false,
    ...overrides,
  };
}

test('normaliza oferta bruta para o padrão canônico do TripPulse', () => {
  const normalized = normalizeFlightOffer(simulatedProvider, buildRawOffer(), relatedQuery);

  assert.equal(normalized.provider, 'simulated-airways');
  assert.equal(normalized.isSimulated, true);
  assert.equal(normalized.dataClassification, 'SIMULATED');
  assert.equal(normalized.type, 'flight');
  assert.deepEqual(normalized.route, { origin: 'GRU', destination: 'LIS' });
  assert.deepEqual(normalized.flight.flightNumber, 'SIA1234');
  assert.equal(normalized.price.total, 1100);
  assert.equal(normalized.price.taxes, 100);
  assert.deepEqual(normalized.relatedQuery, relatedQuery);
});

test('classifica REAL sem lançar (barra realocada para flights.service, Dia 11.8)', () => {
  const realProvider = { name: 'amadeus', isSimulated: false };

  // A classificação continua explícita; o BLOQUEIO de exposição/persistência
  // REAL (HttpError 503) está em modules/flights/flights.service.js,
  // pós-normalização e antes de qualquer escrita no banco.
  const normalized = normalizeFlightOffer(realProvider, buildRawOffer(), relatedQuery);

  assert.equal(normalized.isSimulated, false);
  assert.equal(normalized.dataClassification, 'REAL');
});

test('mapeador serpapi: itinerário bruto -> padrão canônico (Dia 11.8)', () => {
  // Fixtures SINTÉTICAS (tests/fixtures/serpapi-fixtures.js) — nunca respostas reais.
  const serpapiProvider = { name: 'serpapi', isSimulated: false };
  const rawOffer = {
    type: 'round trip',
    currency: 'BRL',
    price: 2100,
    outbound: {
      flights: [
        {
          departure_airport: { id: 'GRU', time: '2027-03-10 10:00' },
          arrival_airport: { id: 'LIS', time: '2027-03-10 22:00' },
          airline: 'Fake Air',
          flight_number: 'FA100',
        },
        {
          departure_airport: { id: 'OPO', time: '2027-03-10 23:30' },
          arrival_airport: { id: 'MAD', time: '2027-03-11 01:00' },
          airline: 'Fake Air',
          flight_number: 'FA101',
        },
      ],
      total_duration: 900,
    },
    return: {
      flights: [
        {
          departure_airport: { id: 'LIS', time: '2027-03-20 12:00' },
          arrival_airport: { id: 'GRU', time: '2027-03-20 21:00' },
          airline: 'Fake Air',
          flight_number: 'FA200',
        },
      ],
      total_duration: 540,
    },
  };

  const normalized = normalizeFlightOffer(serpapiProvider, rawOffer, relatedQuery);

  assert.equal(normalized.provider, 'serpapi');
  assert.equal(normalized.isSimulated, false);
  assert.equal(normalized.dataClassification, 'REAL');
  assert.deepEqual(normalized.route, { origin: 'GRU', destination: 'MAD' });
  // Datas: DIA da partida/chegada da IDA (hora local sem offset — pendência
  // documentada no normalizador).
  assert.deepEqual(normalized.dates, { departureDate: '2027-03-10', arrivalDate: '2027-03-11' });
  assert.equal(normalized.flight.airline, 'Fake Air');
  assert.equal(normalized.flight.flightNumber, 'FA100');
  assert.equal(normalized.flight.stops, 1); // 2 legs = 1 stop
  assert.equal(normalized.flight.cabinClass, 'ECONOMY');
  assert.equal(normalized.flight.baggagePieces, null);
  assert.equal(normalized.flight.refundable, null);
  // base/taxes: SerpApi não decompõe o preço (pendência registrada).
  assert.deepEqual(normalized.price, { currency: 'BRL', total: 2100, base: null, taxes: null });
  assert.deepEqual(normalized.relatedQuery, relatedQuery);
});

// --- Regressões da auditoria D1: flight_number é OBRIGATÓRIO ---

function buildSerpApiOneWay(overrides = {}) {
  return {
    type: 'one way',
    currency: 'BRL',
    price: 1000,
    outbound: {
      flights: [
        {
          departure_airport: { id: 'GRU', time: '2027-03-10 10:00' },
          arrival_airport: { id: 'LIS', time: '2027-03-10 22:00' },
          airline: 'Fake Air',
          ...overrides,
        },
      ],
      total_duration: 720,
    },
  };
}

test('mapeador serpapi (D1): flight_number ausente falha alto — nunca "undefined"', () => {
  const serpapiProvider = { name: 'serpapi', isSimulated: false };
  const raw = buildSerpApiOneWay();
  delete raw.outbound.flights[0].flight_number;

  assert.throws(
    () => normalizeFlightOffer(serpapiProvider, raw, relatedQuery),
    (error) => {
      assert.match(error.message, /flight_number válido/);
      return true;
    }
  );
});

test('mapeador serpapi (D1): flight_number null falha alto', () => {
  const serpapiProvider = { name: 'serpapi', isSimulated: false };
  assert.throws(
    () => normalizeFlightOffer(serpapiProvider, buildSerpApiOneWay({ flight_number: null }), relatedQuery),
    /flight_number válido/
  );
});

test('mapeador serpapi (D1): flight_number vazio e whitespace falham alto', () => {
  const serpapiProvider = { name: 'serpapi', isSimulated: false };
  assert.throws(
    () => normalizeFlightOffer(serpapiProvider, buildSerpApiOneWay({ flight_number: '' }), relatedQuery),
    /flight_number válido/
  );
  assert.throws(
    () => normalizeFlightOffer(serpapiProvider, buildSerpApiOneWay({ flight_number: '   ' }), relatedQuery),
    /flight_number válido/
  );
});

test('mapeador serpapi (D1): flight_number válido string e numérico passam', () => {
  const serpapiProvider = { name: 'serpapi', isSimulated: false };

  const asString = normalizeFlightOffer(
    serpapiProvider,
    buildSerpApiOneWay({ flight_number: 'FA100' }),
    relatedQuery
  );
  assert.equal(asString.flight.flightNumber, 'FA100');

  // Número escalar finito é aceito e convertido de forma determinística.
  const asNumber = normalizeFlightOffer(
    serpapiProvider,
    buildSerpApiOneWay({ flight_number: 100 }),
    relatedQuery
  );
  assert.equal(asNumber.flight.flightNumber, '100');
});

test('mapeador serpapi (D1): números inválidos e identificadores artificiais falham', () => {
  const serpapiProvider = { name: 'serpapi', isSimulated: false };

  for (const flightNumber of [0, -1, NaN, Infinity, 'null', 'undefined', '0']) {
    assert.throws(
      () => normalizeFlightOffer(
        serpapiProvider,
        buildSerpApiOneWay({ flight_number: flightNumber }),
        relatedQuery
      ),
      /flight_number válido/,
      `flight_number=${String(flightNumber)}`
    );
  }
});

test('mapeador serpapi (D1): espaços nas extremidades são normalizados', () => {
  const serpapiProvider = { name: 'serpapi', isSimulated: false };
  const normalized = normalizeFlightOffer(
    serpapiProvider,
    buildSerpApiOneWay({ flight_number: '  FA100  ' }),
    relatedQuery
  );

  assert.equal(normalized.flight.flightNumber, 'FA100');
});

test('normalizador exige isSimulated booleano explícito (fail-closed)', () => {
  for (const isSimulated of [undefined, null, 'true', 'false', 1, 0, {}]) {
    assert.throws(
      () => normalizeFlightOffer({ name: 'stub', isSimulated }, buildRawOffer(), relatedQuery),
      /isSimulated precisa ser booleano/,
      `isSimulated=${String(isSimulated)}`
    );
  }
});

test('mapeador serpapi: price_insights vai para relatedQuery.priceInsights (não persistido)', () => {
  const serpapiProvider = { name: 'serpapi', isSimulated: false };
  const insights = { lowest_price: 900, price_level: 'typical', price_history: [[1731225600, 1000]] };
  const rawOffer = {
    type: 'one way',
    currency: 'BRL',
    price: 1000,
    outbound: {
      flights: [
        {
          departure_airport: { id: 'GRU', time: '2027-03-10 10:00' },
          arrival_airport: { id: 'LIS', time: '2027-03-10 22:00' },
          airline: 'Fake Air',
          flight_number: 'FA100',
        },
      ],
      total_duration: 720,
    },
    price_insights: insights,
  };

  const normalized = normalizeFlightOffer(serpapiProvider, rawOffer, relatedQuery);

  // Metadado de CONTEXTO (agregado do Google) isolado do PriceHistory por
  // oferta: apenas em relatedQuery, que NÃO é persistido pelo offers.service.
  assert.deepEqual(normalized.relatedQuery.priceInsights, insights);
  // Nenhuma coluna do padrão canônico carrega o histórico agregado.
  assert.equal(normalized.price.total, 1000);
});

test('despacho: provedor com nome desconhecido usa o formato do simulador (stubs de teste)', () => {
  // Stubs em tests/api.test.js (fake-slow-provider) entregam ofertas no
  // formato simulado com nomes arbitrários — fallback preservado.
  const stubProvider = { name: 'fake-slow-provider', isSimulated: true };
  const normalized = normalizeFlightOffer(stubProvider, buildRawOffer(), relatedQuery);

  assert.deepEqual(normalized.route, { origin: 'GRU', destination: 'LIS' });
  assert.equal(normalized.dataClassification, 'SIMULATED');
});

test('rejeita oferta bruta incompleta (campo obrigatório ausente)', () => {
  const incompleteRaw = buildRawOffer({
    pricing: { currency: 'BRL', fare_brl: 1000, tax_fees_brl: 100 },
  });

  assert.throws(() => normalizeFlightOffer(simulatedProvider, incompleteRaw, relatedQuery), {
    message: /Oferta normalizada incompleta/,
  });
});
