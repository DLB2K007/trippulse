// Métricas de preço — funções PURAS.
//
// Sem banco de dados, sem relógio, sem I/O, sem dependências externas: a mesma
// entrada produz sempre a mesma saída. Isso permite testar o núcleo da análise
// de preços com fixtures determinísticas, sem depender do banco nem do provedor
// simulado (cujos preços são ruído — ver limitações estatísticas abaixo).
//
// Entrada: a série de observações de preço de UMA oferta, em qualquer ordem:
//   [{ total, currency, observedAt }, ...]
//
// CRITÉRIOS DE CÁLCULO (aprovados no planejamento do Dia 9):
//
// 1. Dinheiro é calculado em CENTAVOS INTEIROS. `total` chega como número
//    decimal (ex.: 1234.56) e vira 123456 centavos. Comparações e percentuais
//    usam inteiros; só a saída é convertida de volta para a moeda.
// 2. `historicalMedian` (preço de referência) considera SOMENTE as observações
//    ANTERIORES à atual. O preço atual nunca entra na própria referência.
// 3. A classificação exige no mínimo 3 observações ANTERIORES — ou seja, 4
//    observações no total. Com menos, o resultado é INSUFFICIENT_DATA.
// 4. `trend` e `classification` são conceitos diferentes:
//    - `trend` (FIRST_OBSERVATION / DROPPED / ROSE / UNCHANGED) descreve apenas
//      a direção do último movimento, comparando o preço atual com o anterior.
//    - `classification` (OPPORTUNITY / FAIR / ABOVE_HISTORY) descreve a POSIÇÃO
//      do preço atual em relação à mediana do histórico (10% abaixo / 10% acima).
//    Portanto DROPPED NÃO implica OPPORTUNITY: um preço pode cair e continuar
//    acima da mediana histórica.
// 5. A classificação é DESCRITIVA do histórico observado. Ela não afirma que o
//    preço está barato em relação ao mercado — não existe preço de mercado
//    disponível no sistema, apenas o que já foi observado para aquela oferta.
//
// POLÍTICA DE ARREDONDAMENTO (uma única regra para todo o dinheiro):
//
// 6. Nenhuma estatística é arredondada internamente. A média é uma divisão e
//    portanto pode ter fração de centavo (ex.: 10000.666... centavos), e a
//    mediana de uma quantidade PAR de observações também (ex.: 10000.5). Os
//    valores fracionários seguem exatos até a saída; a conversão para moeda
//    (`centsToAmount`) é o ÚNICO ponto de arredondamento, sempre para o centavo
//    mais próximo (meio para cima). Média e mediana usam exatamente a mesma
//    regra, então são consistentes entre si.
// 7. A CLASSIFICAÇÃO COMPARA O PERCENTUAL JÁ ARREDONDADO a 2 casas — o mesmo
//    número que sai em `variationVsPreviousPct` / `variationVsMedianPct`. Isso
//    é intencional: garante que o consumidor consiga conferir a classificação
//    na mão (-10.00 é OPPORTUNITY, -9.99 é FAIR tests). O percentual arredondado
//    também é o que alimenta o percentual exibido; usar um valor invisível para
//    decidir exigiria confiar em precisão que a resposta não mostra.
//
// VALIDAÇÃO DAS OPÇÕES:
//
// 8. `options` é opcional e, quando presente, precisa ser um OBJETO SIMPLES
//    (literal ou sem protótipo). null, arrays, strings, números, funções, Date
//    e Map são rejeitados com TypeError — aceitar lixo silenciosamente aqui
//    significaria classificar preços com limiares que ninguém escolheu.
// 9. Somente as três chaves de ANALYSIS_DEFAULTS são aceitas. Chave desconhecida
//    também é TypeError: um typo (`opportunityDrop`) não deve virar limiar padrão
//    em silêncio.
// 10. Valores: `minPreviousObservations` inteiro >= 0 (zero é válido e significa
//    "não exigir histórico anterior"; sem mediana o resultado continua
//    INSUFFICIENT_DATA por NO_REFERENCE_PRICE). `opportunityDropPct` entre 0 e
//    100 (uma queda de preço positivo não pode passar de 100%; acima disso a
//    regra seria inalcançável). `aboveHistoryPct` >= 0, sem teto: valores altos
//    apenas tornam ABOVE_HISTORY mais exigente, o que é uma configuração
//    legítima. Negativos, NaN, Infinity e não-números são rejeitados. Passar
//    `undefined` para uma chave conhecida vale como "usar o padrão". O objeto
//    `criteria` devolvido é congelado.
//
// ORDENAÇÃO E EMPATES:
//
// 11. A série é ordenada por `observedAt` crescente, e a última observação é o
//    preço atual. Empates (mesmo instante) são resolvidos pela ORDEM DE ENTRADA:
//    Array.prototype.sort é estável por especificação (ES2019), então o
//    resultado é determinístico para a mesma entrada.
// 12. NÃO existe critério secundário confiável no modelo atual: PriceHistory tem
//    apenas `id` (UUID v4 aleatório, sem relação com a ordem dos fatos) e
//    `observedAt` (sem `createdAt`). Ordenar por `id` seria arbitrário, não
//    cronológico — então não é usado. Consequência documentada: duas
//    observações no mesmo instante têm ordem definida por quem monta a série;
//    o chamador (service) deve entregar a série em ordem estável e, se quiser
//    desempate real, precisará de uma coluna de sequência/criação no futuro.
// 13. Observações inválidas são DESCARTADAS e contadas em
//    `invalidObservationCount`: total não numérico, não finito, <= 0, moeda
//    vazia, data inválida, total positivo que arredonda para zero centavos
//    (ex.: 0.004) e total acima do teto de centavos seguros (item 15).
//
// MOEDA MISTA:
//
// 14. Se a série contém mais de uma moeda, NENHUMA comparação é feita: `currency`
//    é null, `variationVs*` e `trend` são null e a classificação é
//    INSUFFICIENT_DATA com razão MIXED_CURRENCY. As estatísticas do histórico
//    (`historicalMedian` e `historical.*`) também ficam null, porque média,
//    mínimo, máximo e mediana de valores em moedas diferentes seriam números
//    sem significado. `sampleSize` continua sendo a contagem factual de
//    observações válidas do histórico.
//
// LIMITES NUMÉRICOS (verificação de segurança numérica):
//
// 15. Um preço só é aceito se a conversão couber em um INTEIRO SEGURO de
//    centavos (Number.isSafeInteger). Acima de Number.MAX_SAFE_INTEGER não há
//    exatidão garantida em comparações nem em somas, então a observação é
//    descartada como inválida e contada em invalidObservationCount — nunca
//    arredondada em silêncio. O teto é R$ 90.071.992.547.409,91 por observação.
// 16. A escala para centavos usa expoente DECIMAL ("1.005e2" -> 100.5), não a
//    multiplicação binária `total * 100`: 1.005 * 100 === 100.49999999999999 e
//    arredondaria para 1.00. Com a escala decimal, meio centavo sobe de forma
//    determinística (1.005 -> 1.01; 0.005 -> 0.01) e 1.0049 -> 1.00. Valores em
//    notação científica (`1e21`) não aceitam o sufixo e caem na multiplicação,
//    sendo rejeitados pelo teto do item 15.
// 17. A soma dos centavos do histórico (só a média usa soma) é feita por
//    DECOMPOSIÇÃO INTEIRA — quociente e resto por n — em vez de acumulação
//    direta: somar centavos pode passar de MAX_SAFE_INTEGER com poucas
//    observações grandes e aí a soma deixa de ser exata. Medido: com centavos
//    [MAX_SAFE, MAX_SAFE-1, MAX_SAFE-1] a soma direta erra a média em 1 centavo;
//    a decomposição reproduz o valor exato do oráculo BigInt. `whole` nunca
//    ultrapassa a média (<= maior centavo) e o resto é reduzido a cada passo,
//    então o resultado é exato, não estoura e não depende da ordem.
// 18. Na saída, dinheiro volta a ser float de 2 casas. Perto do teto o float não
//    representa todo centavo (ex.: MAX_SAFE/100), então o inteiro em centavos é a
//    fonte de verdade e o valor exibido é o float mais próximo do arredondado.
//
// LIMITAÇÕES ESTATÍSTICAS QUE A SAÍDA CARREGA (e que a API/README devem
// declarar ao usuário):
//
// - Amostra pequena: com 3 observações anteriores a mediana é literalmente um
//   dos valores observados; não há intervalo de confiança, percentil confiável
//   nem "probabilidade de cair".
// - Ausência de referência externa: "10% abaixo da mediana" significa abaixo do
//   próprio passado, não abaixo do mercado. `min` é o menor preço OBSERVADO.
// - Amostragem enviesada: só existe observação quando alguém pesquisa, então a
//   série reflete horários de uso, não a dinâmica de preços.
// - Regressão à média: após uma queda, o valor tende a voltar; rotular queda
//   como oportunidade é otimista por construção.
// - Múltiplas comparações: analisar várias ofertas aumenta a chance de alguma
//   parecer oportunidade apenas por acaso.
// - Não estacionariedade: mediana de todo o histórico mistura regimes
//   diferentes quando existirem dados reais ao longo de meses.
// - Dados simulados são preços INDEPENDENTES: a regra de "10% abaixo da mediana"
//   dispara por volta de 43% das vezes por puro acaso (medido com o provedor
//   simulado, 3.000 sementes). Nenhum limiar pode ser calibrado com simulação;
//   a classificação é validada por fixtures, não pelos dados simulados.
// - Variações abaixo de ~0,5% são indistinguíveis de arredondamento de centavos.
// - Empates de `observedAt` não têm desempate cronológico real (ver item 12).

export const ANALYSIS_DEFAULTS = Object.freeze({
  // Observações ANTERIORES necessárias para poder classificar (total >= 4).
  minPreviousObservations: 3,
  // Distância percentual mínima abaixo da mediana histórica para OPPORTUNITY.
  opportunityDropPct: 10,
  // Distância percentual mínima acima da mediana histórica para ABOVE_HISTORY.
  aboveHistoryPct: 10,
});

// Vocabulário de tendência já usado em modules/offers/offers.service.js.
// A lógica é replicada aqui de propósito: importar o service traria o Prisma
// para dentro de um módulo puro (e exigiria DATABASE_URL nos testes unitários).
// As regras são idênticas e cobertas por teste; unificar em `shared/` é uma
// limpeza futura, fora do escopo deste passo.
export const PRICE_TREND = Object.freeze({
  FIRST_OBSERVATION: 'FIRST_OBSERVATION',
  DROPPED: 'DROPPED',
  ROSE: 'ROSE',
  UNCHANGED: 'UNCHANGED',
});

export const PRICE_CLASSIFICATION = Object.freeze({
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
  OPPORTUNITY: 'OPPORTUNITY',
  FAIR: 'FAIR',
  ABOVE_HISTORY: 'ABOVE_HISTORY',
});

const OPTION_KEYS = Object.freeze(Object.keys(ANALYSIS_DEFAULTS));

function toCents(total) {
  if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) {
    return null;
  }

  const text = String(total);

  // Escala em expoente DECIMAL: a conversão decimal -> número é corretamente
  // arredondada, então "1.005e2" é exatamente 100.5. Multiplicar por 100 em
  // binário daria 100.49999999999999 e o meio centavo cairia para 1.00.
  // Notação científica (`1e21`, `1e-7`) não aceita o sufixo: usa a
  // multiplicação e, se for grande demais, é rejeitada pelo teto abaixo.
  const scaled = /e/i.test(text) ? total * 100 : Number(`${text}e2`);
  const cents = Math.round(scaled);

  // Acima de MAX_SAFE_INTEGER centavos, comparações e somas perdem exatidão.
  // Também cobre Infinity, NaN e total positivo que arredonda para zero
  // centavos (ex.: 0.004), que não é um preço representável.
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    return null;
  }

  return cents;
}

// Único ponto de arredondamento monetário da saída: meio centavo para cima.
// Aplica-se igualmente à média (que pode ser fracionária por natureza) e à
// mediana de quantidade par (que pode ser x.5 centavos).
function centsToAmount(cents) {
  return Math.round(cents) / 100;
}

function roundPercent(value) {
  return Math.round(value * 100) / 100;
}

function medianCents(sortedCents) {
  if (sortedCents.length === 0) {
    return null;
  }

  const middle = sortedCents.length >> 1;

  if (sortedCents.length % 2 === 1) {
    return sortedCents[middle];
  }

  // Média dos dois centrais pode resultar em fração de centavo; o valor exato
  // é mantido até a saída, exatamente como a média histórica.
  return (sortedCents[middle - 1] + sortedCents[middle]) / 2;
}

// Média dos centavos sem estourar MAX_SAFE_INTEGER e sem acumular erro de
// arredondamento. Cada centavo é separado em quociente e resto exatos por n:
// media = whole + restante/n. A soma direta de centavos grandes deixa de ser
// exata bem antes de virar Infinity (duas observações no teto já bastam).
function meanCents(centsList) {
  const count = centsList.length;

  if (count === 0) {
    return null;
  }

  let whole = 0;
  let remainder = 0;

  for (const cents of centsList) {
    // Resto e quociente são inteiros exatos para operandos seguros.
    const rest = cents % count;
    whole += (cents - rest) / count;
    remainder += rest;

    // Resto sempre fica < count, então nem ele nem `whole` (<= maior centavo)
    // saem da faixa segura, e o carregamento mantém a conta exata.
    if (remainder >= count) {
      remainder -= count;
      whole += 1;
    }
  }

  return whole + remainder / count;
}

function percentChange(currentCents, referenceCents) {
  if (referenceCents === null || referenceCents <= 0) {
    return null;
  }

  return roundPercent(((currentCents - referenceCents) / referenceCents) * 100);
}

// Mesmas regras de buildTrend (modules/offers/offers.service.js): comparação
// estrita, sem tolerância — a tendência é categórica, não uma medida de força.
function computeTrend(previousCents, currentCents) {
  if (currentCents < previousCents) {
    return PRICE_TREND.DROPPED;
  }

  if (currentCents > previousCents) {
    return PRICE_TREND.ROSE;
  }

  return PRICE_TREND.UNCHANGED;
}

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

function failOption(message) {
  throw new TypeError(`options inválida: ${message}`);
}

// Valida e congela os critérios. Qualquer configuração que não faça sentido
// falha alto em vez de produzir classificação silenciosamente errada.
function validateOptions(options) {
  if (options === undefined) {
    return Object.freeze({ ...ANALYSIS_DEFAULTS });
  }

  if (!isPlainObject(options)) {
    failOption('precisa ser um objeto simples (ou ser omitida).');
  }

  const unknownKeys = Object.keys(options).filter((key) => !OPTION_KEYS.includes(key));

  if (unknownKeys.length > 0) {
    failOption(
      `chave desconhecida (${unknownKeys.join(', ')}). Aceitas: ${OPTION_KEYS.join(', ')}.`,
    );
  }

  const criteria = { ...ANALYSIS_DEFAULTS };

  for (const key of OPTION_KEYS) {
    const value = options[key];

    // Propriedade ausente ou explicitamente undefined = usar o padrão.
    if (value === undefined) {
      continue;
    }

    if (typeof value !== 'number' || !Number.isFinite(value)) {
      failOption(`${key} precisa ser um número finito.`);
    }

    criteria[key] = value;
  }

  if (!Number.isInteger(criteria.minPreviousObservations) || criteria.minPreviousObservations < 0) {
    failOption('minPreviousObservations precisa ser um inteiro maior ou igual a zero.');
  }

  // Queda máxima possível de um preço positivo é 100%; acima disso a regra
  // de OPPORTUNITY seria inalcançável por construção.
  if (criteria.opportunityDropPct < 0 || criteria.opportunityDropPct > 100) {
    failOption('opportunityDropPct precisa estar entre 0 e 100.');
  }

  // Sem teto de propósito: um limiar alto só torna ABOVE_HISTORY mais exigente.
  if (criteria.aboveHistoryPct < 0) {
    failOption('aboveHistoryPct precisa ser maior ou igual a zero.');
  }

  return Object.freeze(criteria);
}

// Descarta observações inutilizáveis (total não numérico, zero ou negativo,
// moeda ausente, data inválida) e ordena cronologicamente por observedAt.
// Empates mantêm a ordem de entrada (sort estável): não há desempate confiável
// no modelo de dados — ver itens 11 e 12 do cabeçalho.
function normalizeObservations(observations) {
  if (!Array.isArray(observations)) {
    throw new TypeError('A série de observações precisa ser um array.');
  }

  const valid = [];
  let invalidCount = 0;

  for (const observation of observations) {
    const cents = toCents(observation?.total);
    const currency = typeof observation?.currency === 'string' ? observation.currency.trim() : '';
    const time = new Date(observation?.observedAt).getTime();

    if (cents === null || currency === '' || Number.isNaN(time)) {
      invalidCount += 1;
      continue;
    }

    valid.push({
      cents,
      currency,
      observedAt: new Date(time).toISOString(),
      time,
    });
  }

  valid.sort((a, b) => a.time - b.time);

  return { valid, invalidCount };
}

function toMoney(cents, currency) {
  return {
    total: centsToAmount(cents),
    currency,
  };
}

/**
 * Analisa a série de preços de uma oferta.
 *
 * @param {Array<{total: number, currency: string, observedAt: string}>} observations
 *   Observações em qualquer ordem; a última cronologicamente é o preço atual.
 *   Empates de observedAt seguem a ordem de entrada.
 * @param {{minPreviousObservations?: number, opportunityDropPct?: number, aboveHistoryPct?: number}} [options]
 *   Objeto simples; chaves desconhecidas e valores inválidos lançam TypeError.
 * @returns {object} métricas descritivas + trend + classification
 * @throws {TypeError} série que não seja array, options inválida
 */
export function analyzePriceSeries(observations, options = {}) {
  const criteria = validateOptions(options);

  const { valid, invalidCount } = normalizeObservations(observations);
  const currencies = new Set(valid.map((observation) => observation.currency));
  const mixedCurrency = currencies.size > 1;
  const currency = currencies.size === 1 ? [...currencies][0] : null;

  const currentObservation = valid.length > 0 ? valid[valid.length - 1] : null;
  const previousObservation = valid.length > 1 ? valid[valid.length - 2] : null;

  // Histórico = tudo, menos a observação atual.
  const history = valid.slice(0, valid.length > 0 ? valid.length - 1 : 0);
  const historyCents = history.map((observation) => observation.cents).sort((a, b) => a - b);

  // Com moedas misturadas, agregar valores de moedas diferentes seria uma conta
  // sem significado: as estatísticas ficam null e só a contagem é informada.
  const canSummarizeHistory = !mixedCurrency && historyCents.length > 0;

  const historicalMedianCents = canSummarizeHistory ? medianCents(historyCents) : null;
  // Média mantida com a precisão exata da divisão (pode ter fração de centavo);
  // o arredondamento para centavo acontece apenas na saída, em centsToAmount.
  const historicalMeanCents = canSummarizeHistory ? meanCents(historyCents) : null;
  const historicalMinCents = canSummarizeHistory ? historyCents[0] : null;
  const historicalMaxCents = canSummarizeHistory
    ? historyCents[historyCents.length - 1]
    : null;

  const canCompare = !mixedCurrency && currentObservation !== null;

  const variationVsPreviousPct =
    canCompare && previousObservation !== null
      ? percentChange(currentObservation.cents, previousObservation.cents)
      : null;

  const variationVsMedianPct =
    canCompare && historicalMedianCents !== null
      ? percentChange(currentObservation.cents, historicalMedianCents)
      : null;

  let trend = null;

  if (canCompare) {
    trend =
      previousObservation === null
        ? PRICE_TREND.FIRST_OBSERVATION
        : computeTrend(previousObservation.cents, currentObservation.cents);
  }

  let classification = PRICE_CLASSIFICATION.INSUFFICIENT_DATA;
  let classificationReason = null;

  if (currentObservation === null) {
    classificationReason = 'NO_CURRENT_OBSERVATION';
  } else if (mixedCurrency) {
    classificationReason = 'MIXED_CURRENCY';
  } else if (history.length < criteria.minPreviousObservations) {
    classificationReason = 'NOT_ENOUGH_PREVIOUS_OBSERVATIONS';
  } else if (variationVsMedianPct === null) {
    classificationReason = 'NO_REFERENCE_PRICE';
  } else if (variationVsMedianPct <= -criteria.opportunityDropPct) {
    // Comparação feita sobre o percentual arredondado, o mesmo que sai na
    // resposta: assim o consumidor consegue conferir a classificação na mão.
    classification = PRICE_CLASSIFICATION.OPPORTUNITY;
  } else if (variationVsMedianPct >= criteria.aboveHistoryPct) {
    classification = PRICE_CLASSIFICATION.ABOVE_HISTORY;
  } else {
    classification = PRICE_CLASSIFICATION.FAIR;
  }

  return {
    observationCount: valid.length,
    invalidObservationCount: invalidCount,
    currency,
    mixedCurrency,
    current: currentObservation
      ? {
          total: centsToAmount(currentObservation.cents),
          currency: currentObservation.currency,
          observedAt: currentObservation.observedAt,
        }
      : null,
    previous: previousObservation
      ? {
          total: centsToAmount(previousObservation.cents),
          currency: previousObservation.currency,
          observedAt: previousObservation.observedAt,
        }
      : null,
    historicalMedian:
      historicalMedianCents !== null
        ? {
            total: centsToAmount(historicalMedianCents),
            currency,
            sampleSize: history.length,
          }
        : null,
    historical: {
      // Contagem factual, mesmo em moeda mista; os agregados é que ficam null.
      sampleSize: history.length,
      mean: historicalMeanCents !== null ? toMoney(historicalMeanCents, currency) : null,
      min: historicalMinCents !== null ? toMoney(historicalMinCents, currency) : null,
      max: historicalMaxCents !== null ? toMoney(historicalMaxCents, currency) : null,
      spread:
        historicalMinCents !== null
          ? toMoney(historicalMaxCents - historicalMinCents, currency)
          : null,
    },
    variationVsPreviousPct,
    variationVsMedianPct,
    trend,
    classification,
    classificationReason,
    criteria,
  };
}
