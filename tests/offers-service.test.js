// Testes do domínio de ofertas: identidade de oferta e snapshot persistido.
// Requer o banco de dados ativo (docker compose up -d).

import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../apps/api/src/config/prisma.js';
import {
  buildOfferExternalKey,
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

test('externalKey combina provedor, rota, voo e partida de forma estável', () => {
  assert.equal(
    buildOfferExternalKey(FIXED_OFFER),
    'simulated-airways|GRU|LIS|Simulated Airways|SIA4321|2027-06-01T08:00:00Z'
  );
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
  const firstSnapshot = await persistOfferSnapshot(trip.id, [FIXED_OFFER]);
  const firstEntry = firstSnapshot.get(buildOfferExternalKey(FIXED_OFFER));

  assert.equal(firstEntry.trend, 'FIRST_OBSERVATION');
  assert.equal(firstEntry.previous, null);
  assert.equal(firstEntry.current.total, 1500);
  assert.equal(firstEntry.best.total, 1500);

  // 2ª observação com o MESMO preço: custo de identidade deduplicado no banco
  // (@@unique tripId+externalKey) e tendência UNCHANGED.
  const secondSnapshot = await persistOfferSnapshot(trip.id, [FIXED_OFFER]);
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
