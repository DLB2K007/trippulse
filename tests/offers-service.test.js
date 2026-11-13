// Testes do domínio de ofertas: identidade de oferta e snapshot persistido.
// Requer o banco de dados ativo (docker compose up -d).

import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../apps/api/src/config/prisma.js';
import {
  buildOfferExternalKey,
  listOfferHistoryForTrip,
  persistOfferSnapshot,
} from '../apps/api/src/modules/offers/offers.service.js';

const FIXED_OFFER = {
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
  relatedQuery: { destination: 'Lisboa, Portugal', departureDate: '2027-06-01', returnDate: '2027-06-10' },
};

// O service exige um client transacional; este helper mantém os testes de
// comportamento sem replicar a abertura de transação em cada caso.
async function persistSnapshot(tripId, offers) {
  return prisma.$transaction((tx) => persistOfferSnapshot(tripId, offers, tx));
}

test('externalKey combina provedor, rota, voo e partida de forma estável', () => {
  assert.equal(
    buildOfferExternalKey(FIXED_OFFER),
    'simulated-airways|GRU|LIS|Simulated Airways|SIA4321|2027-06-01T08:00:00Z'
  );
});

test('persistOfferSnapshot exige tx explícito e falha antes de qualquer operação no banco', async (t) => {
  const trip = await prisma.trip.create({
    data: {
      name: 'Teste tx obrigatório',
      destination: 'Lisboa, Portugal',
      startDate: new Date('2027-06-01'),
      endDate: new Date('2027-06-10'),
    },
  });
  t.after(async () => {
    await prisma.trip.delete({ where: { id: trip.id } });
  });

  await assert.rejects(
    () => persistOfferSnapshot(trip.id, [FIXED_OFFER]),
    (error) => {
      assert.equal(error.constructor, TypeError);
      assert.match(error.message, /client transacional/);
      return true;
    }
  );

  await assert.rejects(
    () => persistOfferSnapshot(trip.id, [FIXED_OFFER], {}),
    TypeError
  );

  assert.equal(await prisma.flightOffer.count({ where: { tripId: trip.id } }), 0);
  assert.equal(await prisma.priceHistory.count({ where: { flightOffer: { tripId: trip.id } } }), 0);
});

// Correção da auditoria D5 — defesa em profundidade: o bloqueio de REAL não
// pode depender exclusivamente do orquestrador (flights.service.js). Mesmo
// que um caminho interno futuro chame persistOfferSnapshot diretamente com
// ofertas REAL, nada é persistido: falha ALTO antes da primeira escrita.
test('persistOfferSnapshot (D5): oferta REAL chamada DIRETAMENTE falha 503 antes de escrever', async (t) => {
  const trip = await prisma.trip.create({
    data: {
      name: 'Teste D5 defesa real direta',
      destination: 'Lisboa, Portugal',
      startDate: new Date('2027-06-01'),
      endDate: new Date('2027-06-10'),
    },
  });
  t.after(async () => {
    await prisma.trip.delete({ where: { id: trip.id } });
  });

  const realOffer = { ...FIXED_OFFER, dataClassification: 'REAL' };

  await assert.rejects(
    () => persistSnapshot(trip.id, [realOffer]),
    (error) => {
      assert.equal(error.statusCode, 503);
      assert.match(error.message, /Provedores reais ainda não estão liberados/);
      return true;
    }
  );

  // PROVA do D5: nem oferta, nem observação, nem histórico.
  assert.equal(await prisma.flightOffer.count({ where: { tripId: trip.id } }), 0);
  assert.equal(await prisma.priceHistory.count({ where: { flightOffer: { tripId: trip.id } } }), 0);
});

test('persistOfferSnapshot (D5): fluxo SIMULATED não é afetado pela defesa', async (t) => {
  const trip = await prisma.trip.create({
    data: {
      name: 'Teste D5 simulated intacto',
      destination: 'Lisboa, Portugal',
      startDate: new Date('2027-06-01'),
      endDate: new Date('2027-06-10'),
    },
  });
  t.after(async () => {
    await prisma.trip.delete({ where: { id: trip.id } });
  });

  const snapshot = await persistSnapshot(trip.id, [FIXED_OFFER]);
  assert.equal(snapshot.size, 1);
  assert.equal(await prisma.flightOffer.count({ where: { tripId: trip.id } }), 1);
  assert.equal(await prisma.priceHistory.count({ where: { flightOffer: { tripId: trip.id } } }), 1);
});

test('snapshot persiste oferta e histórico: FIRST_OBSERVATION > UNCHANGED > best', async (t) => {
  const trip = await prisma.trip.create({
    data: {
      name: 'Teste offers snapshot',
      destination: 'Lisboa, Portugal',
      startDate: new Date('2027-06-01'),
      endDate: new Date('2027-06-10'),
    },
  });

  // Após o teste, o cascade apaga a oferta e o histórico criados.
  t.after(async () => {
    await prisma.trip.delete({ where: { id: trip.id } });
  });

  // 1ª observação: cria a oferta no banco.
  const firstSnapshot = await persistSnapshot(trip.id, [FIXED_OFFER]);
  const firstEntry = firstSnapshot.get(buildOfferExternalKey(FIXED_OFFER));

  assert.equal(firstEntry.trend, 'FIRST_OBSERVATION');
  assert.equal(firstEntry.previous, null);
  assert.equal(firstEntry.current.total, 1500);
  assert.equal(firstEntry.best.total, 1500);

  // 2ª observação com o MESMO preço: custo de identidade deduplicado no banco
  // (@@unique tripId+externalKey) e tendência UNCHANGED.
  const secondSnapshot = await persistSnapshot(trip.id, [FIXED_OFFER]);
  const secondEntry = secondSnapshot.get(buildOfferExternalKey(FIXED_OFFER));

  assert.equal(secondEntry.trend, 'UNCHANGED');
  assert.equal(secondEntry.previous.total, 1500);
  assert.equal(secondEntry.current.total, 1500);
  assert.equal(secondEntry.best.total, 1500);

  const observationsInDb = await prisma.priceHistory.count({
    where: { flightOffer: { tripId: trip.id, externalKey: buildOfferExternalKey(FIXED_OFFER) } },
  });
  assert.equal(observationsInDb, 2);

  const offersInDb = await prisma.flightOffer.count({ where: { tripId: trip.id } });
  assert.equal(offersInDb, 1);
});

test('snapshot com múltiplas ofertas preserva todas as ofertas e observações na mesma transação', async (t) => {
  const trip = await prisma.trip.create({
    data: {
      name: 'Teste múltiplas ofertas',
      destination: 'Lisboa, Portugal',
      startDate: new Date('2027-06-01'),
      endDate: new Date('2027-06-10'),
    },
  });
  t.after(async () => {
    await prisma.trip.delete({ where: { id: trip.id } });
  });

  const secondOffer = {
    ...FIXED_OFFER,
    flight: { ...FIXED_OFFER.flight, flightNumber: 'SIA4322' },
  };

  const snapshot = await persistSnapshot(trip.id, [FIXED_OFFER, secondOffer]);

  assert.equal(snapshot.size, 2);
  assert.equal(snapshot.get(buildOfferExternalKey(FIXED_OFFER)).trend, 'FIRST_OBSERVATION');
  assert.equal(snapshot.get(buildOfferExternalKey(secondOffer)).trend, 'FIRST_OBSERVATION');
  assert.equal(await prisma.flightOffer.count({ where: { tripId: trip.id } }), 2);
  assert.equal(await prisma.priceHistory.count({ where: { flightOffer: { tripId: trip.id } } }), 2);
});

test('snapshot usa a ordem canônica: current não é a recém-inserida, previous composto e best desempatado', async (t) => {
  const trip = await prisma.trip.create({
    data: {
      name: 'Teste ordem canônica do histórico',
      destination: 'Lisboa, Portugal',
      startDate: new Date('2027-06-01'),
      endDate: new Date('2027-06-10'),
    },
  });
  t.after(async () => {
    await prisma.trip.delete({ where: { id: trip.id } });
  });

  await persistSnapshot(trip.id, [FIXED_OFFER]);

  const offer = await prisma.flightOffer.findUnique({
    where: { tripId_externalKey: { tripId: trip.id, externalKey: buildOfferExternalKey(FIXED_OFFER) } },
  });

  // Observações futuras, inseridas diretamente, com o MESMO observedAt. A
  // segunda tem sequence maior e deve ser a current canônica.
  const future = new Date(Date.now() + 60 * 60 * 1000);
  await prisma.priceHistory.create({
    data: {
      offerId: offer.id,
      currency: 'BRL',
      total: 1200,
      base: null,
      taxes: null,
      observedAt: future,
    },
  });
  await prisma.priceHistory.create({
    data: {
      offerId: offer.id,
      currency: 'BRL',
      total: 1300,
      base: 1000,
      taxes: 300,
      observedAt: future,
    },
  });

  // A nova pesquisa tem observedAt ANTERIOR às observações futuras. Ela não é
  // current; o comparativo continua sendo o da série canônica.
  const snapshot = await persistSnapshot(trip.id, [
    {
      ...FIXED_OFFER,
      price: { ...FIXED_OFFER.price, total: 1400, base: null, taxes: null },
    },
  ]);
  const entry = snapshot.get(buildOfferExternalKey(FIXED_OFFER));

  // O observedAt de topo é o instante da captura deste snapshot; current é a
  // última observação pela ordem canônica (as observações futuras).
  const storedHistory = await listOfferHistoryForTrip(trip.id);
  const storedOffer = storedHistory.offers.find((item) => item.id === offer.id);
  assert.equal(storedOffer.current.observedAt, future.toISOString());
  assert.notEqual(entry.observedAt.toISOString(), storedOffer.current.observedAt);
  assert.ok(entry.observedAt.getTime() < new Date(storedOffer.current.observedAt).getTime());

  assert.equal(entry.current.total, 1300);
  assert.equal(entry.previous.total, 1200);
  assert.equal(entry.best.total, 1200);
  assert.equal(entry.trend, 'ROSE');
  assert.equal('sequence' in entry.current, false);
  assert.equal('sequence' in entry.previous, false);
  assert.equal('sequence' in entry.best, false);
  assert.doesNotThrow(() => JSON.stringify(entry));

  const rows = await prisma.priceHistory.findMany({
    where: { offerId: offer.id },
    orderBy: [{ observedAt: 'asc' }, { sequence: 'asc' }],
  });
  assert.equal(rows.length, 4);
  assert.equal(new Set(rows.map((row) => row.sequence)).size, 4);

  const inserted = rows.find((row) => row.total === 1400);
  assert.equal(inserted.base, null);
  assert.equal(inserted.taxes, null);
});

test('snapshot é atômico: falha no meio não deixa oferta nem observação (Dia 11.6)', async (t) => {
  const trip = await prisma.trip.create({
    data: {
      name: 'Teste snapshot atômico',
      destination: 'Lisboa, Portugal',
      startDate: new Date('2027-06-01'),
      endDate: new Date('2027-06-10'),
    },
  });
  t.after(async () => {
    await prisma.trip.delete({ where: { id: trip.id } });
  });

  // Segunda oferta com departureDate inválido: a criação da oferta falha no
  // MEIO do snapshot, depois da primeira oferta + observação já escritas na
  // transação. O rollback precisa apagar TAMBÉM o que veio antes.
  const brokenOffer = {
    ...FIXED_OFFER,
    flight: { ...FIXED_OFFER.flight, flightNumber: 'SIA9999' },
    dates: { ...FIXED_OFFER.dates, departureDate: 'não-é-uma-data' },
  };

  await assert.rejects(
    prisma.$transaction((tx) => persistOfferSnapshot(trip.id, [FIXED_OFFER, brokenOffer], tx))
  );

  assert.equal(await prisma.flightOffer.count({ where: { tripId: trip.id } }), 0);
  assert.equal(await prisma.priceHistory.count({ where: { flightOffer: { tripId: trip.id } } }), 0);
});
