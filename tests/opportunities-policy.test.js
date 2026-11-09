// Testes do núcleo puro de identificação de oportunidades.
// Sem banco de dados: o núcleo recebe o envelope de análise do Dia 9 e devolve
// oportunidades/exclusões de forma determinística.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  identifyOpportunities,
  OPPORTUNITY_EXCLUSION,
  OPPORTUNITY_POLICY_DEFAULTS,
  OPPORTUNITY_LIMITATION_NOTES,
} from '../apps/api/src/modules/opportunities/opportunity-policy.js';

const NOW = new Date('2027-05-01T12:00:00.000Z');

function hoursAgo(hours) {
  return new Date(NOW.getTime() - hours * 3_600_000).toISOString();
}

function makeTrip(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Viagem teste',
    destination: 'Lisboa, Portugal',
    startDate: '2027-06-10',
    endDate: '2027-06-20',
    ...overrides,
  };
}

function makeOffer(overrides = {}) {
  const { analysis = {}, ...rest } = overrides;
  const flightNumber = rest.flightNumber ?? 'AAA111';

  return {
    offerId: rest.offerId ?? 'offer-1',
    externalKey: `fixture-airlines|GRU|LIS|Fixture Airways|${flightNumber}|2027-06-10T10:00:00.000Z`,
    provider: 'fixture-airlines',
    dataClassification: 'REAL',
    simulated: false,
    type: 'flight',
    route: { origin: 'GRU', destination: 'LIS' },
    dates: {
      departureDate: '2027-06-10T10:00:00.000Z',
      arrivalDate: '2027-06-10T22:00:00.000Z',
    },
    flight: {
      airline: 'Fixture Airways',
      flightNumber,
      stops: 0,
      cabinClass: 'ECONOMY',
      baggagePieces: 0,
      refundable: false,
    },
    analysis: {
      observationCount: 6,
      invalidObservationCount: 0,
      currency: 'BRL',
      mixedCurrency: false,
      current: { total: 800, currency: 'BRL', observedAt: hoursAgo(1) },
      previous: { total: 1200, currency: 'BRL', observedAt: hoursAgo(48) },
      historicalMedian: { total: 1000, currency: 'BRL', sampleSize: 5 },
      historical: {
        sampleSize: 5,
        mean: { total: 1000, currency: 'BRL' },
        min: { total: 900, currency: 'BRL' },
        max: { total: 1100, currency: 'BRL' },
        spread: { total: 200, currency: 'BRL' },
      },
      variationVsPreviousPct: -33.33,
      variationVsMedianPct: -20,
      trend: 'DROPPED',
      classification: 'OPPORTUNITY',
      classificationReason: null,
      ...analysis,
    },
    ...rest,
  };
}

// Monta a entrada no formato do service: a contagem de dias distintos vem do
// histórico (fora do envelope de análise), então é injetada aqui.
function run(offers, { days = {}, trip = makeTrip(), now = NOW, policy } = {}) {
  const observationDaysByOfferId = Object.fromEntries(
    offers.map((offer) => [offer.offerId, days[offer.offerId] ?? 2])
  );

  return identifyOpportunities({ trip, offers, observationDaysByOfferId, now, policy });
}

function reasonsOf(result) {
  return result.excluded.map((exclusion) => exclusion.reason);
}

test('oferta real elegivel vira oportunidade com diferenca historica observada', () => {
  const offer = makeOffer();
  const result = run([offer]);

  assert.equal(result.summary.evaluatedOfferCount, 1);
  assert.equal(result.summary.opportunityCount, 1);
  assert.equal(result.summary.excludedCount, 0);
  assert.equal(result.summary.currencies[0], 'BRL');
  assert.equal(result.summary.containsSimulatedData, false);

  const opportunity = result.opportunities[0];

  assert.equal(opportunity.rank, 1);
  assert.equal(opportunity.offerId, offer.offerId);
  assert.equal(opportunity.dataClassification, 'REAL');
  assert.deepEqual(opportunity.current, { total: 800, currency: 'BRL' });
  assert.deepEqual(opportunity.reference, {
    type: 'HISTORICAL_MEDIAN',
    total: 1000,
    currency: 'BRL',
    sampleSize: 5,
  });
  assert.deepEqual(opportunity.historicalDifference, { total: 200, currency: 'BRL' });
  assert.deepEqual(opportunity.historicalSample, {
    previousObservations: 5,
    distinctObservationDays: 2,
  });
  assert.equal(opportunity.variationVsMedianPct, -20);
  assert.equal(opportunity.observedAt, hoursAgo(1));

  // O portão é de elegibilidade: nenhum campo de garantia e nenhum preço de
  // mercado são inventados.
  assert.equal('guaranteedSaving' in opportunity, false);
  assert.equal('marketPrice' in opportunity, false);
});

test('a resposta declara economia historica observada, nao economia garantida', () => {
  const result = run([makeOffer()]);

  assert.ok(result.limitations.length > 0);
  assert.ok(
    result.limitations.some((note) => note.includes('economia histórica observada')),
  );
  assert.ok(
    result.limitations.some((note) => note.includes('não recomendação de compra')),
  );
  assert.deepEqual(result.limitations, [...OPPORTUNITY_LIMITATION_NOTES]);
});

test('oferta simulada e excluida mesmo quando a classificacao e OPPORTUNITY', () => {
  const result = run([makeOffer({ dataClassification: 'SIMULATED' })]);

  assert.equal(result.summary.opportunityCount, 0);
  assert.equal(result.summary.excludedCount, 1);
  assert.equal(result.summary.containsSimulatedData, true);
  assert.deepEqual(reasonsOf(result), [OPPORTUNITY_EXCLUSION.SIMULATED_DATA]);
  assert.match(result.excluded[0].detail, /provedor simulado/);
});

test('classificacao desconhecida nao e promovida a dado real', () => {
  const result = run([makeOffer({ dataClassification: 'UNKNOWN' })]);

  assert.equal(result.summary.opportunityCount, 0);
  assert.deepEqual(reasonsOf(result), [OPPORTUNITY_EXCLUSION.UNCLASSIFIED_DATA]);
});

test('precedencia: viagem inativa vence todos os outros motivos', () => {
  const result = run([makeOffer({ dataClassification: 'SIMULATED' })], {
    trip: makeTrip({ startDate: '2027-04-30' }),
  });

  assert.deepEqual(reasonsOf(result), [OPPORTUNITY_EXCLUSION.TRIP_NOT_ACTIVE]);
});

test('viagem que comeca hoje ainda e monitoravel; a de ontem nao', () => {
  const today = run([makeOffer()], { trip: makeTrip({ startDate: '2027-05-01' }) });
  assert.equal(today.summary.opportunityCount, 1);

  const yesterday = run([makeOffer()], { trip: makeTrip({ startDate: '2027-04-30' }) });
  assert.equal(yesterday.summary.opportunityCount, 0);
  assert.deepEqual(reasonsOf(yesterday), [OPPORTUNITY_EXCLUSION.TRIP_NOT_ACTIVE]);
  assert.match(yesterday.excluded[0].detail, /partida já passou/);
});

test('startDate ausente ou invalida trata a viagem como nao monitoravel', () => {
  const missing = run([makeOffer()], { trip: makeTrip({ startDate: undefined }) });
  const invalid = run([makeOffer()], { trip: makeTrip({ startDate: '10/06/2027' }) });

  assert.deepEqual(reasonsOf(missing), [OPPORTUNITY_EXCLUSION.TRIP_NOT_ACTIVE]);
  assert.deepEqual(reasonsOf(invalid), [OPPORTUNITY_EXCLUSION.TRIP_NOT_ACTIVE]);
});

test('amostra curta exclui mesmo com classificacao OPPORTUNITY', () => {
  const offer = makeOffer({
    analysis: { historical: { sampleSize: 4 }, historicalMedian: { total: 1000, currency: 'BRL', sampleSize: 4 } },
  });
  const result = run([offer]);

  assert.equal(result.summary.opportunityCount, 0);
  assert.deepEqual(reasonsOf(result), [OPPORTUNITY_EXCLUSION.SMALL_SAMPLE]);
  assert.match(result.excluded[0].detail, /mínimo exigido: 5/);
});

test('historico concentrado em um unico dia e amostra insuficiente', () => {
  const result = run([makeOffer()], { days: { 'offer-1': 1 } });

  assert.equal(result.summary.opportunityCount, 0);
  assert.deepEqual(reasonsOf(result), [OPPORTUNITY_EXCLUSION.SMALL_SAMPLE]);
  assert.match(result.excluded[0].detail, /1 dia\(s\) distinto/);
});

test('limite de recencia: 24h ainda elegivel, 25h expirada', () => {
  const atLimit = run([makeOffer({ analysis: { current: { total: 800, currency: 'BRL', observedAt: hoursAgo(24) } } })]);
  assert.equal(atLimit.summary.opportunityCount, 1);

  const stale = run([makeOffer({ analysis: { current: { total: 800, currency: 'BRL', observedAt: hoursAgo(25) } } })]);
  assert.equal(stale.summary.opportunityCount, 0);
  assert.deepEqual(reasonsOf(stale), [OPPORTUNITY_EXCLUSION.STALE_OBSERVATION]);
});

test('observacao no futuro ou com data invalida e dado inconsistente', () => {
  const future = run([
    makeOffer({ analysis: { current: { total: 800, currency: 'BRL', observedAt: hoursAgo(-1) } } }),
  ]);
  const invalid = run([
    makeOffer({ analysis: { current: { total: 800, currency: 'BRL', observedAt: 'ontem' } } }),
  ]);

  assert.deepEqual(reasonsOf(future), [OPPORTUNITY_EXCLUSION.INVALID_OBSERVATION_TIME]);
  assert.deepEqual(reasonsOf(invalid), [OPPORTUNITY_EXCLUSION.INVALID_OBSERVATION_TIME]);
});

test('classificacoes FAIR e ABOVE_HISTORY nao sao oportunidades', () => {
  const fair = run([makeOffer({ analysis: { classification: 'FAIR', variationVsMedianPct: 1.5 } })]);
  const above = run([
    makeOffer({ analysis: { classification: 'ABOVE_HISTORY', variationVsMedianPct: 15 } }),
  ]);

  assert.deepEqual(reasonsOf(fair), [OPPORTUNITY_EXCLUSION.NOT_BELOW_THRESHOLD]);
  assert.deepEqual(reasonsOf(above), [OPPORTUNITY_EXCLUSION.NOT_BELOW_THRESHOLD]);
});

test('piso absoluto: R$ 99,99 exclui e R$ 100,00 passa (limite exato)', () => {
  const below = run([
    makeOffer({ analysis: { current: { total: 900.01, currency: 'BRL', observedAt: hoursAgo(1) } } }),
  ]);
  const exact = run([
    makeOffer({ analysis: { current: { total: 900, currency: 'BRL', observedAt: hoursAgo(1) } } }),
  ]);

  assert.deepEqual(reasonsOf(below), [OPPORTUNITY_EXCLUSION.BELOW_ABSOLUTE_FLOOR]);
  assert.equal(exact.summary.opportunityCount, 1);
  assert.deepEqual(exact.opportunities[0].historicalDifference, { total: 100, currency: 'BRL' });
});

test('moeda sem piso declarado nao herda piso de outra moeda', () => {
  const usd = makeOffer({
    analysis: {
      currency: 'USD',
      current: { total: 800, currency: 'USD', observedAt: hoursAgo(1) },
      previous: { total: 1200, currency: 'USD', observedAt: hoursAgo(48) },
      historicalMedian: { total: 1000, currency: 'USD', sampleSize: 5 },
      historical: { sampleSize: 5 },
    },
  });

  const withoutFloor = run([usd]);
  assert.equal(withoutFloor.summary.opportunityCount, 0);
  assert.deepEqual(reasonsOf(withoutFloor), [OPPORTUNITY_EXCLUSION.NO_CURRENCY_FLOOR]);

  const withFloor = run([usd], {
    policy: { minAbsoluteSavingCentsByCurrency: { BRL: 10000, USD: 10000 } },
  });
  assert.equal(withFloor.summary.opportunityCount, 1);
});

test('moeda misturada nunca e comparada', () => {
  const result = run([makeOffer({ analysis: { mixedCurrency: true, currency: null } })]);

  assert.deepEqual(reasonsOf(result), [OPPORTUNITY_EXCLUSION.MIXED_CURRENCY]);
});

test('oferta sem preco atual e excluida com motivo proprio', () => {
  const result = run([makeOffer({ analysis: { current: null } })]);

  assert.deepEqual(reasonsOf(result), [OPPORTUNITY_EXCLUSION.NO_CURRENT_PRICE]);
});

test('oferta malformada nao vira oportunidade', () => {
  const missingAnalysis = identifyOpportunities({
    trip: makeTrip(),
    offers: [{ offerId: 'x', externalKey: 'k', dataClassification: 'REAL' }],
    observationDaysByOfferId: { x: 2 },
    now: NOW,
  });

  assert.deepEqual(reasonsOf(missingAnalysis), [OPPORTUNITY_EXCLUSION.MALFORMED_OFFER]);

  const mismatchedCurrency = run([
    makeOffer({ analysis: { historicalMedian: { total: 1000, currency: 'USD', sampleSize: 5 } } }),
  ]);

  assert.deepEqual(reasonsOf(mismatchedCurrency), [OPPORTUNITY_EXCLUSION.MALFORMED_OFFER]);
});

test('ranking ordena por diferenca absoluta, depois percentual, depois externalKey', () => {
  const result = run([
    makeOffer({
      offerId: 'menor',
      flightNumber: 'CCC333',
      analysis: { current: { total: 900, currency: 'BRL', observedAt: hoursAgo(1) } },
    }),
    makeOffer({
      offerId: 'maior',
      flightNumber: 'AAA111',
      analysis: { current: { total: 700, currency: 'BRL', observedAt: hoursAgo(1) } },
    }),
    makeOffer({
      offerId: 'empate-pct-forte',
      flightNumber: 'BBB222',
      analysis: {
        current: { total: 700, currency: 'BRL', observedAt: hoursAgo(1) },
        variationVsMedianPct: -30,
      },
    }),
  ]);

  assert.deepEqual(
    result.opportunities.map((opportunity) => [opportunity.rank, opportunity.offerId]),
    [
      [1, 'empate-pct-forte'],
      [2, 'maior'],
      [3, 'menor'],
    ]
  );
});

test('ranking e limite sao separados por moeda', () => {
  const brl = makeOffer({
    offerId: 'brl-1',
    flightNumber: 'BRL111',
  });
  const usd = makeOffer({
    offerId: 'usd-1',
    flightNumber: 'USD111',
    analysis: {
      currency: 'USD',
      current: { total: 1000, currency: 'USD', observedAt: hoursAgo(1) },
      previous: { total: 1600, currency: 'USD', observedAt: hoursAgo(48) },
      historicalMedian: { total: 1500, currency: 'USD', sampleSize: 5 },
      historical: { sampleSize: 5 },
    },
  });

  const result = run([usd, brl], {
    policy: {
      minAbsoluteSavingCentsByCurrency: { BRL: 10000, USD: 10000 },
      maxOpportunitiesPerCurrency: 1,
    },
  });

  assert.deepEqual(result.summary.currencies, ['BRL', 'USD']);
  assert.deepEqual(
    result.opportunities.map((opportunity) => [
      opportunity.rank,
      opportunity.current.currency,
      opportunity.historicalDifference.total,
    ]),
    [
      [1, 'BRL', 200],
      [1, 'USD', 500],
    ]
  );
});

test('limite por moeda exclui o excedente com motivo explicito', () => {
  const result = run(
    [
      makeOffer({
        offerId: 'a',
        flightNumber: 'A11111',
        analysis: { current: { total: 700, currency: 'BRL', observedAt: hoursAgo(1) } },
      }),
      makeOffer({
        offerId: 'b',
        flightNumber: 'B22222',
        analysis: { current: { total: 800, currency: 'BRL', observedAt: hoursAgo(1) } },
      }),
    ],
    { policy: { maxOpportunitiesPerCurrency: 1 } }
  );

  assert.equal(result.summary.opportunityCount, 1);
  assert.equal(result.opportunities[0].offerId, 'a');
  assert.deepEqual(reasonsOf(result), [OPPORTUNITY_EXCLUSION.RANK_LIMIT_EXCEEDED]);
  assert.equal(
    result.summary.opportunityCount + result.summary.excludedCount,
    result.summary.evaluatedOfferCount
  );
});

test('saida e deterministica e nao depende da ordem de entrada', () => {
  const a = makeOffer({ offerId: 'a', flightNumber: 'A11111' });
  const b = makeOffer({
    offerId: 'b',
    flightNumber: 'B22222',
    dataClassification: 'SIMULATED',
  });
  const c = makeOffer({
    offerId: 'c',
    flightNumber: 'C33333',
    analysis: { classification: 'FAIR', variationVsMedianPct: 2 },
  });

  const first = run([a, b, c]);
  const second = run([c, a, b]);
  const third = run([a, b, c]);

  assert.deepEqual(first, second);
  assert.deepEqual(first, third);
});

test('nao muta a entrada', () => {
  const offers = [makeOffer(), makeOffer({ offerId: 'offer-2', flightNumber: 'DDD444', dataClassification: 'SIMULATED' })];
  const before = JSON.stringify(offers);

  run(offers);

  assert.equal(JSON.stringify(offers), before);
});

test('resumo fecha a contabilidade e traz todos os motivos, mesmo zerados', () => {
  const result = run([
    makeOffer(),
    makeOffer({ offerId: 'sim', flightNumber: 'SIM111', dataClassification: 'SIMULATED' }),
    makeOffer({ offerId: 'caro', flightNumber: 'CAR111', analysis: { classification: 'ABOVE_HISTORY' } }),
  ]);

  assert.equal(result.summary.opportunityCount, 1);
  assert.equal(result.summary.excludedCount, 2);
  assert.equal(
    result.summary.opportunityCount + result.summary.excludedCount,
    result.summary.evaluatedOfferCount
  );

  const totalExcluded = Object.values(result.summary.excludedByReason).reduce((sum, count) => sum + count, 0);
  assert.equal(totalExcluded, result.summary.excludedCount);
  assert.deepEqual(
    Object.keys(result.summary.excludedByReason).sort(),
    Object.values(OPPORTUNITY_EXCLUSION).sort()
  );
  assert.equal(result.summary.excludedByReason.OPPORTUNITY, undefined);
});

test('politica invalida falha alto em vez de excluir em silencio', () => {
  const invalid = [
    { chaveDesconhecida: 1 },
    { minHistoricalSampleSize: -1 },
    { minDistinctObservationDays: 1.5 },
    { maxObservationAgeHours: 0 },
    { maxOpportunitiesPerCurrency: 0 },
    { minAbsoluteSavingCentsByCurrency: {} },
    { minAbsoluteSavingCentsByCurrency: { brl: 10000 } },
    { minAbsoluteSavingCentsByCurrency: { BRL: 0 } },
    { minAbsoluteSavingCentsByCurrency: { BRL: 100.5 } },
    'nao-e-objeto',
  ];

  for (const policy of invalid) {
    assert.throws(() => run([makeOffer()], { policy }), TypeError);
  }
});

test('entrada invalida falha alto', () => {
  assert.throws(
    () => identifyOpportunities({ trip: makeTrip(), offers: [makeOffer()], now: 'agora' }),
    TypeError
  );
  assert.throws(
    () => identifyOpportunities({ trip: makeTrip(), offers: 'ofertas', now: NOW }),
    TypeError
  );
  assert.throws(
    () => identifyOpportunities({ trip: null, offers: [], now: NOW }),
    TypeError
  );
});

test('politica padrao e devolvida na resposta, congelada em conteudo', () => {
  const result = run([makeOffer()]);

  assert.equal(result.policy.minHistoricalSampleSize, OPPORTUNITY_POLICY_DEFAULTS.minHistoricalSampleSize);
  assert.equal(result.policy.minDistinctObservationDays, 2);
  assert.equal(result.policy.maxObservationAgeHours, 24);
  assert.deepEqual(result.policy.minAbsoluteSavingCentsByCurrency, { BRL: 10000 });
  assert.equal(result.policy.maxOpportunitiesPerCurrency, 10);
});
