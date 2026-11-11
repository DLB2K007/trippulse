// Testes puros das barreiras fail-closed (D5/D6, segunda auditoria do Dia 11.8).
// Sem banco: persistOfferSnapshot recebe um client falso e a guarda precisa
// falhar antes de qualquer chamada. O import de offers.service exige
// DATABASE_URL no processo; nenhuma conexão é aberta por este arquivo.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertOnlySimulatedOffers,
  assertOnlySimulatedProviders,
} from '../apps/api/src/shared/real-barrier.js';
import { persistOfferSnapshot } from '../apps/api/src/modules/offers/offers.service.js';
import { prisma } from '../apps/api/src/config/prisma.js';
import { searchFlightsForTrip } from '../apps/api/src/modules/flights/flights.service.js';

function offer(overrides = {}) {
  return {
    provider: 'simulated-airways',
    isSimulated: true,
    dataClassification: 'SIMULATED',
    type: 'flight',
    route: { origin: 'GRU', destination: 'LIS' },
    dates: { departureDate: '2027-06-01T08:00:00Z', arrivalDate: '2027-06-01T20:00:00Z' },
    flight: {
      airline: 'Simulated Airways',
      flightNumber: 'SIA4321',
      stops: 0,
      cabinClass: 'ECONOMY',
      baggagePieces: 0,
      refundable: false,
    },
    price: { currency: 'BRL', total: 1500, base: 1300, taxes: 200 },
    ...overrides,
  };
}

function makeTx() {
  const calls = [];
  const tx = {
    calls,
    flightOffer: {
      findUnique: async () => {
        calls.push('findUnique');
        return null;
      },
      create: async () => {
        calls.push('createOffer');
        return { id: 'offer-1' };
      },
    },
    priceHistory: {
      create: async () => {
        calls.push('createHistory');
        return { total: 1500, currency: 'BRL' };
      },
      findFirst: async () => {
        calls.push('findFirst');
        return { total: 1500, currency: 'BRL', observedAt: new Date() };
      },
    },
  };
  return tx;
}

const is503 = (error) => error.statusCode === 503;

test('D6 fail-closed: somente isSimulated === true pode executar', () => {
  const provider = (overrides = {}) => ({
    name: 'stub-provider',
    search: async () => [],
    isSimulated: true,
    ...overrides,
  });

  assert.doesNotThrow(() => assertOnlySimulatedProviders([provider()]));

  for (const invalidProvider of [
    provider({ isSimulated: false }),
    provider({ isSimulated: undefined }),
    provider({ isSimulated: null }),
    provider({ isSimulated: 'true' }),
    provider({ isSimulated: 1 }),
    provider({ name: undefined }),
    provider({ name: '' }),
    provider({ name: '   ' }),
    provider({ search: undefined }),
    provider({ search: 'not-a-function' }),
    null,
    [],
    'provider',
    42,
  ]) {
    assert.throws(
      () => assertOnlySimulatedProviders([invalidProvider]),
      is503,
      `provider=${String(invalidProvider)}`
    );
  }

  assert.throws(() => assertOnlySimulatedProviders([]), is503);
  assert.throws(
    () => assertOnlySimulatedProviders([provider(), provider({ name: '' })]),
    is503
  );
  assert.throws(() => assertOnlySimulatedProviders(null), TypeError);

  let searchCalls = 0;
  assert.throws(
    () => assertOnlySimulatedProviders([
      provider({ isSimulated: false, search: () => { searchCalls += 1; } }),
    ]),
    is503
  );
  assert.equal(searchCalls, 0, 'a barreira não pode chamar search');
});

test('D5 fail-closed: classificação/flags ausentes ou inconsistentes não passam', async () => {
  const invalidOffers = [
    offer({ dataClassification: 'REAL' }),
    offer({ dataClassification: 'UNCLASSIFIED' }),
    offer({ dataClassification: undefined }),
    offer({ isSimulated: false, dataClassification: 'SIMULATED' }),
    offer({ isSimulated: undefined }),
    offer({ isSimulated: null }),
    offer({ isSimulated: 1 }),
    offer({ isSimulated: 'true' }),
    null,
    [],
  ];

  for (const candidate of invalidOffers) {
    assert.throws(() => assertOnlySimulatedOffers([candidate]), is503);

    const tx = makeTx();
    await assert.rejects(
      () => persistOfferSnapshot('trip-1', [candidate], tx),
      is503
    );
    assert.deepEqual(tx.calls, [], `escrita antes da rejeição: ${JSON.stringify(candidate)}`);
  }
});

test('D6: gate impede contagem e busca antes de qualquer provider inválido', async () => {
  const originalTripFindUnique = prisma.trip.findUnique;
  const originalPriceCount = prisma.priceHistory.count;
  const originalOfferCount = prisma.flightOffer.count;
  const originalTransaction = prisma.$transaction;
  let tripLookups = 0;
  let transactionCalls = 0;
  let dbCounts = 0;
  let searchCalls = 0;

  prisma.trip.findUnique = async () => {
    tripLookups += 1;
    return null;
  };
  prisma.$transaction = async () => {
    transactionCalls += 1;
    return null;
  };
  prisma.priceHistory.count = async () => {
    dbCounts += 1;
    return 0;
  };
  prisma.flightOffer.count = async () => {
    dbCounts += 1;
    return 0;
  };

  try {
    const validProvider = {
      name: 'valid-simulated-provider',
      search: async () => {
        searchCalls += 1;
        return [];
      },
      isSimulated: true,
    };

    for (const providers of [
      [],
      [null],
      [[]],
      [{ isSimulated: true }],
      [{ name: 'missing-search', isSimulated: true }],
      [{ name: '', search: async () => [], isSimulated: true }],
      [{ name: 'bad', search: 'not-a-function', isSimulated: true }],
      [{ name: 'missing-flag', search: async () => [] }],
      [{ name: 'null-flag', search: async () => [], isSimulated: null }],
      [{ name: 'bad', search: async () => { searchCalls += 1; }, isSimulated: false }],
      [{ name: 'bad', search: async () => { searchCalls += 1; }, isSimulated: 'true' }],
      [validProvider, { name: '', search: async () => [], isSimulated: true }],
    ]) {
      await assert.rejects(
        () => searchFlightsForTrip('00000000-0000-4000-8000-000000000000', { providers }),
        is503
      );
    }
  } finally {
    prisma.trip.findUnique = originalTripFindUnique;
    prisma.priceHistory.count = originalPriceCount;
    prisma.flightOffer.count = originalOfferCount;
    prisma.$transaction = originalTransaction;
  }

  assert.equal(tripLookups, 0, 'provider inválido não pode consultar a viagem');
  assert.equal(transactionCalls, 0, 'nenhuma transação pode ocorrer antes do gate/consulta');
  assert.equal(dbCounts, 0, 'nenhuma contagem pode ocorrer antes do gate');
  assert.equal(searchCalls, 0, 'nenhum provider inválido pode executar search');
});

test('D6 positivo: SIMULATED válido consulta a viagem e executa search uma vez', async () => {
  const originalTripFindUnique = prisma.trip.findUnique;
  const originalPriceCount = prisma.priceHistory.count;
  const originalOfferCount = prisma.flightOffer.count;
  const originalTransaction = prisma.$transaction;
  let tripLookups = 0;
  let priceCounts = 0;
  let offerCounts = 0;
  let transactionCalls = 0;
  let searchCalls = 0;

  const trip = {
    origin: 'São Paulo, Brasil',
    destination: 'Lisboa, Portugal',
    startDate: new Date('2027-06-01T00:00:00Z'),
    endDate: new Date('2027-06-20T00:00:00Z'),
  };
  const validProvider = {
    name: 'valid-simulated-provider',
    search: async () => {
      searchCalls += 1;
      return [];
    },
    isSimulated: true,
  };

  prisma.trip.findUnique = async () => {
    tripLookups += 1;
    return trip;
  };
  prisma.priceHistory.count = async () => {
    priceCounts += 1;
    return 0;
  };
  prisma.flightOffer.count = async () => {
    offerCounts += 1;
    return 0;
  };
  prisma.$transaction = async () => {
    transactionCalls += 1;
    throw new Error('STOP_AFTER_PROVIDER');
  };

  try {
    await assert.rejects(
      () => searchFlightsForTrip('00000000-0000-4000-8000-000000000000', {
        providers: [validProvider],
      }),
      /STOP_AFTER_PROVIDER/
    );
  } finally {
    prisma.trip.findUnique = originalTripFindUnique;
    prisma.priceHistory.count = originalPriceCount;
    prisma.flightOffer.count = originalOfferCount;
    prisma.$transaction = originalTransaction;
  }

  assert.equal(tripLookups, 1, 'provider válido deve consultar a viagem');
  assert.equal(priceCounts, 1, 'contagem de histórico executada uma vez');
  assert.equal(offerCounts, 1, 'contagem de ofertas executada uma vez');
  assert.equal(searchCalls, 1, 'provider válido deve executar search exatamente uma vez');
  assert.equal(transactionCalls, 1, 'fluxo deve alcançar a transação após a busca');
});

test('D5: lista vazia é operação sem ofertas e não executa escrita', async () => {
  const tx = makeTx();
  const result = await persistOfferSnapshot('trip-1', [], tx);

  assert.equal(result.size, 0);
  assert.deepEqual(tx.calls, []);
});

test('D5: entrada que não é array falha antes do banco', async () => {
  const tx = makeTx();
  await assert.rejects(
    () => persistOfferSnapshot('trip-1', 'not-an-array', tx),
    TypeError
  );
  assert.deepEqual(tx.calls, []);
});

test('D5 fail-closed: lista mista é rejeitada antes de qualquer escrita', async () => {
  const tx = makeTx();
  await assert.rejects(
    () => persistOfferSnapshot('trip-1', [offer(), offer({ dataClassification: 'REAL' })], tx),
    is503
  );
  assert.deepEqual(tx.calls, []);
});

test('fluxo SIMULATED válido continua persistindo normalmente', async () => {
  const tx = makeTx();
  const result = await persistOfferSnapshot('trip-1', [offer()], tx);

  assert.equal(result.size, 1);
  assert.ok(tx.calls.includes('createOffer'));
  assert.ok(tx.calls.includes('createHistory'));
});