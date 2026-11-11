// Teste de barreira REAL com banco (Dia 11.8): nenhuma oferta REAL é exposta
// ou persistida. Requer o banco ativo (docker compose up -d).
//
// O provedor REAL aqui é um stub (nome fake, isSimulated: false) entregando
// ofertas em formato de simulador — DI de providers, padrão do projeto.
// Nenhuma chamada externa real é feita.

import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../apps/api/src/config/prisma.js';
import { searchFlightsForTrip } from '../apps/api/src/modules/flights/flights.service.js';

// Formato bruto do simulador (o stub usa o fallback de mapeamento).
function rawOffer(overrides = {}) {
  return {
    result_id: 'FAKE-REAL-1',
    route: { origin_iata: 'GRU', destination_iata: 'LIS' },
    outbound_leg: {
      carrier_name: 'Fake Real Air',
      carrier_code: 'FRA',
      flight_number: 'FRA1000',
      depart_at: '2027-09-01T10:00:00Z',
      arrive_at: '2027-09-01T18:00:00Z',
      connection_count: 0,
      seat_class: 'ECONOMY',
    },
    pricing: { currency: 'BRL', fare_brl: 1000, tax_fees_brl: 100, grand_total_brl: 1100 },
    baggage_pieces: 1,
    refundable: false,
    ...overrides,
  };
}

function createRealProvider() {
  return {
    name: 'fake-real-provider',
    isSimulated: false, // registro declara REAL
    async search() {
      return [rawOffer()];
    },
  };
}

function createSimulatedProvider() {
  return {
    name: 'fake-simulated-provider',
    isSimulated: true,
    async search() {
      return [rawOffer()];
    },
  };
}

async function createTrip() {
  return prisma.trip.create({
    data: {
      name: 'Teste barreira REAL',
      origin: 'São Paulo, SP, Brasil',
      destination: 'Lisboa, Portugal',
      startDate: new Date('2027-09-01'),
      endDate: new Date('2027-09-10'),
    },
  });
}

async function cleanupTrip(tripId) {
  await prisma.priceHistory.deleteMany({ where: { flightOffer: { tripId } } });
  await prisma.flightOffer.deleteMany({ where: { tripId } });
  await prisma.trip.delete({ where: { id: tripId } });
}

test('barreira REAL: pesquisa com oferta REAL falha com 503 ANTES da transação', async () => {
  const trip = await createTrip();

  try {
    await assert.rejects(
      () => searchFlightsForTrip(trip.id, { providers: [createRealProvider()] }),
      (error) => {
        assert.equal(error.statusCode, 503);
        assert.match(error.message, /Provedores reais ainda não estão liberados/);
        return true;
      }
    );

    // NADA persistido: nem oferta, nem histórico de preços.
    assert.equal(await prisma.flightOffer.count({ where: { tripId: trip.id } }), 0);
    assert.equal(await prisma.priceHistory.count({ where: { flightOffer: { tripId: trip.id } } }), 0);
  } finally {
    await cleanupTrip(trip.id);
  }
});

// Correção da auditoria D6: o bloqueio acontece ANTES de executar qualquer
// provedor REAL — a chamada externa (e o custo dos créditos) nunca acontece,
// nem em pesquisa manual nem no ciclo do agendador (que usa este mesmo
// serviço sem DI). A barreira pós-normalização permanece como defesa adicional.
test('barreira REAL (D6): provider REAL NUNCA executa — zero chamadas externas', async () => {
  const trip = await createTrip();
  let searchCalls = 0;

  try {
    const realProvider = {
      name: 'fake-real-provider-counts',
      isSimulated: false,
      async search() {
        searchCalls += 1;
        return [rawOffer()];
      },
    };

    await assert.rejects(
      () => searchFlightsForTrip(trip.id, { providers: [realProvider] }),
      (error) => {
        assert.equal(error.statusCode, 503);
        return true;
      }
    );

    // PROVA do D6: nenhuma execução do provider, nenhuma linha escrita.
    assert.equal(searchCalls, 0);
    assert.equal(await prisma.flightOffer.count({ where: { tripId: trip.id } }), 0);
    assert.equal(await prisma.priceHistory.count({ where: { flightOffer: { tripId: trip.id } } }), 0);
  } finally {
    await cleanupTrip(trip.id);
  }
});

test('controle positivo: oferta SIMULADA equivalente persiste normalmente', async () => {
  const trip = await createTrip();

  try {
    const result = await searchFlightsForTrip(trip.id, { providers: [createSimulatedProvider()] });

    assert.equal(result.offers.length, 1);
    assert.equal(result.offers[0].dataClassification, 'SIMULATED');
    assert.equal(await prisma.flightOffer.count({ where: { tripId: trip.id } }), 1);
    assert.equal(await prisma.priceHistory.count({ where: { flightOffer: { tripId: trip.id } } }), 1);
  } finally {
    await cleanupTrip(trip.id);
  }
});

test('barreira REAL com provedor misto (SIMULADO + REAL): 503 e nada persiste', async () => {
  const trip = await createTrip();

  try {
    await assert.rejects(
      () =>
        searchFlightsForTrip(trip.id, {
          providers: [createSimulatedProvider(), createRealProvider()],
        }),
      (error) => error.statusCode === 503
    );

    assert.equal(await prisma.flightOffer.count({ where: { tripId: trip.id } }), 0);
  } finally {
    await cleanupTrip(trip.id);
  }
});
