// Testes unitários do provedor de voos simulado.
// Execução: node --test

import test from 'node:test';
import assert from 'node:assert/strict';

import { simulatedFlightProvider } from '../apps/api/src/integrations/flight-providers/simulated/simulated-flight-provider.js';

const query = {
  origin: 'Curitiba, Paraná, Brasil',
  destination: 'Lisboa, Portugal',
  departureDate: '2027-03-10',
  returnDate: '2027-03-20',
};

test('devolve entre 3 e 5 ofertas', async () => {
  const offers = await simulatedFlightProvider.search(query);

  assert.ok(offers.length >= 3 && offers.length <= 5);
});

test('rota determinística: origem e destino derivam do texto canônico (Dia 11.6)', async () => {
  const offers = await simulatedFlightProvider.search(query);

  // "Curitiba..." -> CUR; "Lisboa..." -> LIS (primeiras 3 letras A-Z).
  for (const offer of offers) {
    assert.equal(offer.route.origin_iata, 'CUR');
    assert.equal(offer.route.destination_iata, 'LIS');
  }
});

test('barreira: consulta sem origin lança TypeError alto (nada de hub inferido)', async () => {
  const { origin, ...semOrigin } = query;

  await assert.rejects(
    simulatedFlightProvider.search(semOrigin),
    (error) => error instanceof TypeError && /origin/.test(error.message)
  );
});

test('todas as datas/horarios sao ISO validos (regressao do T010 invalido)', async () => {
  const offers = await simulatedFlightProvider.search(query);

  for (const offer of offers) {
    const departure = new Date(offer.outbound_leg.depart_at);
    const arrival = new Date(offer.outbound_leg.arrive_at);

    assert.ok(!Number.isNaN(departure.getTime()), `depart_at invalido: ${offer.outbound_leg.depart_at}`);
    assert.ok(!Number.isNaN(arrival.getTime()), `arrive_at invalido: ${offer.outbound_leg.arrive_at}`);
  }
});

test('identidade estavel e preos variam com a semente de variacao', async () => {
  const [first, second, third] = await Promise.all([
    simulatedFlightProvider.search(query, { variationSeed: 0 }),
    simulatedFlightProvider.search(query, { variationSeed: 1 }),
    simulatedFlightProvider.search(query, { variationSeed: 0 }),
  ]);

  const identityList = (offers) =>
    offers.map((offer) => `${offer.result_id}|${offer.outbound_leg.flight_number}`);

  // mesma semente -> identica; semente diferente -> identidade preservada, preco alterado
  assert.deepEqual(identityList(first), identityList(third));
  assert.deepEqual(identityList(second), identityList(first));
  assert.notDeepEqual(
    second.map((o) => o.pricing.grand_total_brl),
    first.map((o) => o.pricing.grand_total_brl)
  );
});
