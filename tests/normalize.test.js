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

test('bloqueia classificação REAL enquanto provedores reais não estiverem liberados', () => {
  const realProvider = { name: 'amadeus', isSimulated: false };

  assert.throws(() => normalizeFlightOffer(realProvider, buildRawOffer(), relatedQuery), {
    message: /Provedores reais ainda não estão liberados/,
  });
});

test('rejeita oferta bruta incompleta (campo obrigatório ausente)', () => {
  const incompleteRaw = buildRawOffer({
    pricing: { currency: 'BRL', fare_brl: 1000, tax_fees_brl: 100 },
  });

  assert.throws(() => normalizeFlightOffer(simulatedProvider, incompleteRaw, relatedQuery), {
    message: /Oferta normalizada incompleta/,
  });
});
