// Testes unitários do módulo de métricas de preço (Dia 9, Passo 1).
// NÃO requerem banco de dados: o módulo é puro (sem Prisma, sem I/O).
//
// As fixtures usam séries conhecidas para provar as regras aprovadas no
// planejamento — em especial que a mediana de referência exclui o preço atual
// e que a classificação exige 3 observações ANTERIORES (4 no total).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ANALYSIS_DEFAULTS,
  PRICE_CLASSIFICATION,
  PRICE_TREND,
  analyzePriceSeries,
} from '../apps/api/src/modules/analysis/price-metrics.js';

// Observações mensais fictícias, com dia fixo para ordenação determinística.
function observation(total, day, currency = 'BRL') {
  return {
    total,
    currency,
    observedAt: new Date(Date.UTC(2027, 0, day, 12, 0, 0)).toISOString(),
  };
}

function series(...totals) {
  return totals.map((total, index) => observation(total, index + 1));
}

test('rejeita entrada que nao seja array', () => {
  assert.throws(() => analyzePriceSeries(null), TypeError);
  assert.throws(() => analyzePriceSeries({ total: 100 }), TypeError);
});

test('serie vazia: nada a analisar', () => {
  const result = analyzePriceSeries([]);

  assert.equal(result.observationCount, 0);
  assert.equal(result.invalidObservationCount, 0);
  assert.equal(result.current, null);
  assert.equal(result.previous, null);
  assert.equal(result.historicalMedian, null);
  assert.equal(result.historical.sampleSize, 0);
  assert.equal(result.variationVsPreviousPct, null);
  assert.equal(result.variationVsMedianPct, null);
  assert.equal(result.trend, null);
  assert.equal(result.classification, PRICE_CLASSIFICATION.INSUFFICIENT_DATA);
  assert.equal(result.classificationReason, 'NO_CURRENT_OBSERVATION');
});

test('uma observacao: FIRST_OBSERVATION e dados insuficientes', () => {
  const result = analyzePriceSeries([observation(1200, 1)]);

  assert.equal(result.current.total, 1200);
  assert.equal(result.previous, null);
  assert.equal(result.historicalMedian, null);
  assert.equal(result.trend, PRICE_TREND.FIRST_OBSERVATION);
  assert.equal(result.classification, PRICE_CLASSIFICATION.INSUFFICIENT_DATA);
  assert.equal(result.classificationReason, 'NOT_ENOUGH_PREVIOUS_OBSERVATIONS');
});

test('mediana de historico com quantidade par e calculada, mas ainda insuficiente', () => {
  const result = analyzePriceSeries(series(100, 200, 300));

  assert.equal(result.historical.sampleSize, 2);
  assert.equal(result.historicalMedian.total, 150);
  assert.equal(result.historicalMedian.sampleSize, 2);
  assert.equal(result.classification, PRICE_CLASSIFICATION.INSUFFICIENT_DATA);
});

test('tres observacoes (2 anteriores) continuam insuficientes', () => {
  const result = analyzePriceSeries(series(100, 100, 100));

  assert.equal(result.historical.sampleSize, 2);
  assert.equal(result.trend, PRICE_TREND.UNCHANGED);
  assert.equal(result.classification, PRICE_CLASSIFICATION.INSUFFICIENT_DATA);
  assert.equal(result.classificationReason, 'NOT_ENOUGH_PREVIOUS_OBSERVATIONS');
});

test('quatro observacoes: mediana ignora o preco atual', () => {
  // Se o atual entrasse na mediana, ela seria 250 (media de 200 e 300).
  const result = analyzePriceSeries(series(100, 200, 300, 400));

  assert.equal(result.observationCount, 4);
  assert.equal(result.current.total, 400);
  assert.equal(result.previous.total, 300);
  assert.equal(result.historicalMedian.total, 200);
  assert.equal(result.historicalMedian.sampleSize, 3);
  assert.equal(result.variationVsPreviousPct, 33.33);
  assert.equal(result.variationVsMedianPct, 100);
  assert.equal(result.trend, PRICE_TREND.ROSE);
  assert.equal(result.classification, PRICE_CLASSIFICATION.ABOVE_HISTORY);
});

test('exatamente 10% abaixo da mediana historica e OPPORTUNITY (limite inclusivo)', () => {
  const result = analyzePriceSeries(series(100, 100, 100, 90));

  assert.equal(result.historicalMedian.total, 100);
  assert.equal(result.variationVsMedianPct, -10);
  assert.equal(result.trend, PRICE_TREND.DROPPED);
  assert.equal(result.classification, PRICE_CLASSIFICATION.OPPORTUNITY);
  assert.equal(result.classificationReason, null);
});

test('9,99% abaixo da mediana historica permanece FAIR', () => {
  const result = analyzePriceSeries(series(100, 100, 100, 90.01));

  assert.equal(result.variationVsMedianPct, -9.99);
  assert.equal(result.classification, PRICE_CLASSIFICATION.FAIR);
});

test('artitmetica em centavos: 1000,01 -> 900,01 e exatamente -10%', () => {
  const result = analyzePriceSeries(series(1000.01, 1000.01, 1000.01, 900.01));

  assert.equal(result.historicalMedian.total, 1000.01);
  assert.equal(result.current.total, 900.01);
  assert.equal(result.variationVsMedianPct, -10);
  assert.equal(result.classification, PRICE_CLASSIFICATION.OPPORTUNITY);
});

test('DROPPED nao implica OPPORTUNITY', () => {
  // Cai em relacao ao anterior (120 -> 105), mas segue ACIMA da mediana 100.
  const result = analyzePriceSeries(series(100, 100, 120, 105));

  assert.equal(result.trend, PRICE_TREND.DROPPED);
  assert.equal(result.historicalMedian.total, 100);
  assert.equal(result.variationVsMedianPct, 5);
  assert.equal(result.classification, PRICE_CLASSIFICATION.FAIR);
});

test('ROSE nao implica ABOVE_HISTORY', () => {
  // Sobe em relacao ao anterior (95 -> 99) e fica perto da mediana 95.
  const result = analyzePriceSeries(series(80, 100, 95, 99));

  assert.equal(result.trend, PRICE_TREND.ROSE);
  assert.equal(result.historicalMedian.total, 95);
  assert.equal(result.classification, PRICE_CLASSIFICATION.FAIR);
});

test('preco repetido: UNCHANGED e FAIR sem variacao', () => {
  const result = analyzePriceSeries(series(100, 100, 100, 100));

  assert.equal(result.trend, PRICE_TREND.UNCHANGED);
  assert.equal(result.variationVsPreviousPct, 0);
  assert.equal(result.variationVsMedianPct, 0);
  assert.equal(result.classification, PRICE_CLASSIFICATION.FAIR);
});

test('variacoes percentuais usam a referencia correta', () => {
  // anterior 120, mediana do historico 150 (100, 150, 200).
  const result = analyzePriceSeries(series(100, 150, 200, 100));

  assert.equal(result.previous.total, 200);
  assert.equal(result.historicalMedian.total, 150);
  assert.equal(result.variationVsPreviousPct, -50);
  assert.equal(result.variationVsMedianPct, -33.33);
});

test('estatisticas do historico excluem a observacao atual', () => {
  const result = analyzePriceSeries(series(100, 200, 300, 1000));

  assert.equal(result.historical.sampleSize, 3);
  assert.deepEqual(result.historical.mean, { total: 200, currency: 'BRL' });
  assert.deepEqual(result.historical.min, { total: 100, currency: 'BRL' });
  assert.deepEqual(result.historical.max, { total: 300, currency: 'BRL' });
  assert.deepEqual(result.historical.spread, { total: 200, currency: 'BRL' });
});

test('moeda mista bloqueia comparacoes e classificacao', () => {
  const result = analyzePriceSeries([
    observation(100, 1, 'BRL'),
    observation(100, 2, 'BRL'),
    observation(100, 3, 'BRL'),
    observation(20, 4, 'USD'),
  ]);

  assert.equal(result.mixedCurrency, true);
  assert.equal(result.currency, null);
  assert.equal(result.variationVsPreviousPct, null);
  assert.equal(result.variationVsMedianPct, null);
  assert.equal(result.trend, null);
  assert.equal(result.classification, PRICE_CLASSIFICATION.INSUFFICIENT_DATA);
  assert.equal(result.classificationReason, 'MIXED_CURRENCY');
});

test('observacoes invalidas sao descartadas e contadas', () => {
  const result = analyzePriceSeries([
    observation(0, 1),
    observation(-5, 2),
    { total: 'abc', currency: 'BRL', observedAt: '2027-01-03T12:00:00.000Z' },
    { total: 100, currency: '', observedAt: '2027-01-04T12:00:00.000Z' },
    { total: 100, currency: 'BRL', observedAt: 'data-invalida' },
    observation(100, 6),
    observation(100, 7),
    observation(100, 8),
    observation(90, 9),
  ]);

  assert.equal(result.invalidObservationCount, 5);
  assert.equal(result.observationCount, 4);
  assert.equal(result.current.total, 90);
  assert.equal(result.historicalMedian.total, 100);
  assert.equal(result.classification, PRICE_CLASSIFICATION.OPPORTUNITY);
});

test('ordena cronologicamente e nao muta a entrada', () => {
  const input = [
    observation(300, 3),
    observation(100, 1),
    observation(400, 4),
    observation(200, 2),
  ];
  const snapshot = input.map((item) => ({ ...item }));

  const result = analyzePriceSeries(input);

  assert.equal(result.current.total, 400);
  assert.equal(result.previous.total, 300);
  assert.equal(result.historicalMedian.total, 200);
  assert.equal(result.observationCount, 4);
  assert.deepEqual(input, snapshot);
});

test('limiar de oportunidade pode ser ajustado por opcao explicita', () => {
  const result = analyzePriceSeries(series(100, 100, 100, 94), { opportunityDropPct: 5 });

  assert.equal(result.variationVsMedianPct, -6);
  assert.equal(result.classification, PRICE_CLASSIFICATION.OPPORTUNITY);
  assert.equal(result.criteria.opportunityDropPct, 5);
  assert.equal(result.criteria.minPreviousObservations, 3);
});

test('padroes aprovados ficam congelados e visiveis', () => {
  assert.equal(Object.isFrozen(ANALYSIS_DEFAULTS), true);
  assert.equal(ANALYSIS_DEFAULTS.minPreviousObservations, 3);
  assert.equal(ANALYSIS_DEFAULTS.opportunityDropPct, 10);
  assert.equal(ANALYSIS_DEFAULTS.aboveHistoryPct, 10);

  // O objeto devolvido tambem e congelado: nenhum consumidor altera os
  // criterios que produziram a classificacao.
  const result = analyzePriceSeries(series(100, 100, 100, 90));

  assert.equal(Object.isFrozen(result.criteria), true);
  assert.throws(() => {
    result.criteria.opportunityDropPct = 0;
  }, TypeError);
});

test('options invalidas sao rejeitadas', () => {
  const validSeries = series(100, 100, 100, 90);

  // options que nao sao objetos simples.
  for (const options of [null, [], '10', 42, () => {}, new Date()]) {
    assert.throws(() => analyzePriceSeries(validSeries, options), TypeError);
  }

  // Chave desconhecida (typo nao pode virar limiar padrao silenciosamente).
  assert.throws(
    () => analyzePriceSeries(validSeries, { opportunityDrop: 5 }),
    /chave desconhecida/,
  );

  // Valores negativos, nao finitos, nao numericos e incompativeis.
  for (const options of [
    { opportunityDropPct: -1 },
    { opportunityDropPct: 101 },
    { opportunityDropPct: NaN },
    { opportunityDropPct: Infinity },
    { opportunityDropPct: '10' },
    { aboveHistoryPct: -0.1 },
    { minPreviousObservations: 2.5 },
    { minPreviousObservations: -1 },
  ]) {
    assert.throws(() => analyzePriceSeries(validSeries, options), TypeError);
  }
});

test('chave conhecida como undefined volta ao padrao', () => {
  const result = analyzePriceSeries(series(100, 100, 100, 90), {
    opportunityDropPct: undefined,
  });

  assert.equal(result.criteria.opportunityDropPct, ANALYSIS_DEFAULTS.opportunityDropPct);
  assert.equal(result.classification, PRICE_CLASSIFICATION.OPPORTUNITY);
});

test('minPreviousObservations zero classifica com duas observacoes', () => {
  const result = analyzePriceSeries(series(100, 90), { minPreviousObservations: 0 });

  assert.equal(result.historical.sampleSize, 1);
  assert.equal(result.historicalMedian.total, 100);
  assert.equal(result.variationVsMedianPct, -10);
  assert.equal(result.classification, PRICE_CLASSIFICATION.OPPORTUNITY);
});

test('minPreviousObservations zero sem mediana continua insuficiente', () => {
  const result = analyzePriceSeries([observation(100, 1)], { minPreviousObservations: 0 });

  assert.equal(result.historicalMedian, null);
  assert.equal(result.variationVsMedianPct, null);
  assert.equal(result.classification, PRICE_CLASSIFICATION.INSUFFICIENT_DATA);
  assert.equal(result.classificationReason, 'NO_REFERENCE_PRICE');
});

test('historico suficiente sem observacao atual continua insuficiente', () => {
  // minPreviousObservations 0 satisfaz a exigência de amostra mesmo sem
  // nenhuma observação (0 >= 0). Ainda assim não existe preço atual para
  // classificar, e esse motivo tem precedência sobre a falta de referência.
  const empty = analyzePriceSeries([], { minPreviousObservations: 0 });

  assert.equal(empty.historical.sampleSize, 0);
  assert.equal(empty.historicalMedian, null);
  assert.equal(empty.classification, PRICE_CLASSIFICATION.INSUFFICIENT_DATA);
  assert.equal(empty.classificationReason, 'NO_CURRENT_OBSERVATION');

  // Série só com observações inválidas: a amostra não pode ser "fabricada"
  // com dados descartados — válidas continuam zero, sem preço atual.
  const onlyInvalid = analyzePriceSeries(
    [
      observation(0, 1),
      { total: '100', currency: 'BRL', observedAt: observation(100, 2).observedAt },
    ],
    { minPreviousObservations: 0 }
  );

  assert.equal(onlyInvalid.observationCount, 0);
  assert.equal(onlyInvalid.invalidObservationCount, 2);
  assert.equal(onlyInvalid.classification, PRICE_CLASSIFICATION.INSUFFICIENT_DATA);
  assert.equal(onlyInvalid.classificationReason, 'NO_CURRENT_OBSERVATION');
});

test('media fracionaria de centavos arredonda apenas na apresentacao', () => {
  // 100,00 + 100,01 + 100,01 = 300,02 / 3 = 100,00666... -> 100,01 na saida.
  const odd = analyzePriceSeries(series(100, 100.01, 100.01, 100.01));

  assert.equal(odd.historical.sampleSize, 3);
  assert.equal(odd.historical.mean.total, 100.01);

  // 100,00 + 100,01 = 200,01 / 2 = 100,005 -> meio centavo para cima: 100,01.
  const halfCent = analyzePriceSeries(series(100, 100.01, 500));

  assert.equal(halfCent.historical.sampleSize, 2);
  assert.equal(halfCent.historical.mean.total, 100.01);
});

test('empates de observedAt seguem a ordem de entrada', () => {
  const sameInstant = (total) => ({
    total,
    currency: 'BRL',
    observedAt: '2027-02-01T12:00:00.000Z',
  });

  const forward = analyzePriceSeries([sameInstant(100), sameInstant(200), sameInstant(300)]);

  assert.equal(forward.current.total, 300);
  assert.equal(forward.previous.total, 200);
  assert.equal(forward.historicalMedian.total, 150);

  // Mesma entrada, mesmo resultado: o desempate e deterministico (sort estavel).
  const repeated = analyzePriceSeries([sameInstant(100), sameInstant(200), sameInstant(300)]);

  assert.deepEqual(repeated, forward);

  // Limitacao documentada: com o mesmo instante, a ordem vem de quem monta a
  // serie — nao existe desempate cronologico confiavel no modelo de dados.
  const reversed = analyzePriceSeries([sameInstant(300), sameInstant(200), sameInstant(100)]);

  assert.equal(reversed.current.total, 100);
  assert.equal(reversed.previous.total, 200);
  assert.equal(reversed.historicalMedian.total, 250);
});

test('total positivo que arredonda para zero e descartado', () => {
  const result = analyzePriceSeries([observation(0.004, 1), observation(0.001, 2)]);

  assert.equal(result.observationCount, 0);
  assert.equal(result.invalidObservationCount, 2);
  assert.equal(result.current, null);
  assert.equal(result.classification, PRICE_CLASSIFICATION.INSUFFICIENT_DATA);

  // Controle: 0,006 arredonda para um centavo e e um preco representavel.
  const representable = analyzePriceSeries([observation(0.006, 1)]);

  assert.equal(representable.observationCount, 1);
  assert.equal(representable.current.total, 0.01);
});

test('estatisticas do historico ficam nulas em moeda mista', () => {
  const result = analyzePriceSeries([
    observation(100, 1, 'BRL'),
    observation(100, 2, 'BRL'),
    observation(20, 3, 'USD'),
    observation(100, 4, 'BRL'),
  ]);

  assert.equal(result.mixedCurrency, true);
  assert.equal(result.currency, null);
  assert.equal(result.historicalMedian, null);
  assert.equal(result.historical.mean, null);
  assert.equal(result.historical.min, null);
  assert.equal(result.historical.max, null);
  assert.equal(result.historical.spread, null);
  // A contagem e factual e continua disponivel.
  assert.equal(result.historical.sampleSize, 3);
});

test('precos acima do limite de centavos seguros sao descartados', () => {
  const result = analyzePriceSeries([
    observation(90071992547409.92, 1), // 1 centavo acima de MAX_SAFE
    observation(Number.MAX_VALUE, 2),
    observation(Number.MAX_SAFE_INTEGER, 3), // em reais, nao em centavos
  ]);

  assert.equal(result.observationCount, 0);
  assert.equal(result.invalidObservationCount, 3);
  assert.equal(result.current, null);
  assert.equal(result.classification, PRICE_CLASSIFICATION.INSUFFICIENT_DATA);
});

test('preco no limite exato de centavos seguros e aceito', () => {
  const result = analyzePriceSeries([observation(90071992547409.91, 1)]);

  assert.equal(result.observationCount, 1);
  assert.equal(result.invalidObservationCount, 0);
  assert.equal(result.current.total, Number.MAX_SAFE_INTEGER / 100);
});

test('meio centavo no total sobe de forma deterministica', () => {
  // Multiplicar por 100 em binario daria 100.49999999999999 para 1.005.
  assert.equal(analyzePriceSeries([observation(1.005, 1)]).current.total, 1.01);
  assert.equal(analyzePriceSeries([observation(2.675, 1)]).current.total, 2.68);
  assert.equal(analyzePriceSeries([observation(0.005, 1)]).current.total, 0.01);
  // Logo abaixo do meio centavo continua descendo.
  assert.equal(analyzePriceSeries([observation(1.0049, 1)]).current.total, 1);
});

test('mediana de historico par com meio centavo arredonda na apresentacao', () => {
  const result = analyzePriceSeries(series(100, 100.01, 500));

  assert.equal(result.historical.sampleSize, 2);
  // Mediana exata de 100,00 e 100,01 e 100,005 centavos -> 100,01 na saida.
  assert.equal(result.historicalMedian.total, 100.01);
});

test('soma do historico nao estoura com observacoes muito grandes', () => {
  const total = 90071992547409.91;
  const result = analyzePriceSeries([
    observation(total, 1),
    observation(total, 2),
    observation(90071992547409.9, 3), // MAX_SAFE - 1 centavo
    observation(total, 4),
  ]);

  assert.equal(result.observationCount, 4);
  assert.equal(result.historical.sampleSize, 3);
  assert.equal(Number.isFinite(result.historical.mean.total), true);
  // Centavos do historico: MAX_SAFE, MAX_SAFE, MAX_SAFE-1 -> soma 2,7e16, acima
  // de MAX_SAFE_INTEGER. A media exata arredonda de volta para MAX_SAFE centavos;
  // a soma direta em float erraria em 1 centavo nesse caso.
  assert.equal(result.historical.mean.total, Number.MAX_SAFE_INTEGER / 100);
});
