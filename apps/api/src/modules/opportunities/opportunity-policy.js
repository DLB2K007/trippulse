// Identificação determinística de oportunidades de compra — funções PURAS.
//
// Sem banco, sem relógio interno, sem I/O e sem dependências externas: a mesma
// entrada (envelope de análise + `now` + política) produz sempre a mesma saída.
//
// RELAÇÃO COM O DIA 9 (não duplica regra):
//   A classificação descritiva (OPPORTUNITY / FAIR / ABOVE_HISTORY / ...) é
//   calculada por `analysis/price-metrics.js` e chega pronta no envelope de
//   `analysis.service.js`. Este módulo NÃO recalcula percentual nem mediana:
//   ele apenas aplica PORTÕES de elegibilidade sobre aquele resultado. Uma
//   oferta pode ser OPPORTUNITY e ainda assim não ser oportunidade (dado
//   simulado, amostra curta, observação antiga, economia abaixo do piso).
//
// DECISÕES REGISTRADAS:
//
// 1. ECONOMIA HISTÓRICA OBSERVADA, NUNCA GARANTIDA. O único número monetário
//    que este módulo produz é `historicalDifference` = mediana histórica menos
//    preço atual observado. É diferença em relação ao PASSADO da própria
//    oferta: não é economia futura, não é projeção, não é garantia e não é
//    recomendação de compra. Os textos de limitação acompanham a resposta
//    justamente para que o número não seja lido como decisão financeira.
//
// 2. `Trip.startDate` É DATA DE CALENDÁRIO. No schema é `DATE NOT NULL`
//    (`start_date`), sem hora e sem fuso; `docs/contexto.md` não define a
//    semântica do campo. Interpretação adotada e documentada: é o dia de
//    início (partida) da viagem. Uma viagem só é monitorável enquanto esse dia
//    não passou: compara-se a data com o dia UTC de `now` (inclusivo, ou seja,
//    viagem que começa hoje ainda é elegível). Se o campo estiver ausente ou
//    fora do formato `YYYY-MM-DD`, a viagem é tratada como não ativa — falhar
//    para o lado conservador em vez de inventar uma data.
//
// 3. MOEDAS NUNCA SE MISTURAM. O ranking é feito DENTRO de cada moeda e o
//    limite é aplicado por moeda; valores de moedas diferentes nunca são
//    comparados e não existe conversão cambial no sistema. O piso absoluto é
//    declarado por moeda (`minAbsoluteSavingCentsByCurrency`) porque R$ 100 e
//    US$ 100 não são o mesmo valor: uma moeda sem piso definido é excluída com
//    motivo próprio em vez de herdar um piso arbitrário.
//
// 4. ORDEM DOS PORTÕES É CONTRATO. Cada oferta é reprovada pelo PRIMEIRO
//    portão que falhar, na ordem abaixo, e o motivo registrado é esse. Assim a
//    resposta é auditável e o teste de precedência é estável:
//        TRIP_NOT_ACTIVE → SIMULATED_DATA / UNCLASSIFIED_DATA →
//        MALFORMED_OFFER → NO_CURRENT_PRICE → MIXED_CURRENCY → SMALL_SAMPLE →
//        INVALID_OBSERVATION_TIME → STALE_OBSERVATION →
//        NOT_BELOW_THRESHOLD → NO_CURRENCY_FLOOR → BELOW_ABSOLUTE_FLOOR →
//        RANK_LIMIT_EXCEEDED
//
// 5. QUALIDADE DO DADO É PORTA DE ENTRADA, NÃO RÓTULO. `SIMULATED` e qualquer
//    valor desconhecido são SEMPRE excluídos; nada é promovido a dado real.
//    Consequência honesta: com o provedor simulado atual (único existente no
//    MVP), a lista de oportunidades é vazia por construção — o endpoint expõe
//    o funil de exclusões, não resultados fabricados.
//
// 6. AMOSTRA E RECÊNCIA CONTRA FALSOS POSITIVOS. Exigir mais observações
//    anteriores do que o mínimo descritivo (5 em vez de 3), em pelo menos 2
//    dias distintos, e uma observação atual com no máximo 24 horas reduz
//    (não elimina) leituras baseadas em série curta ou em preço velho.
//
// 7. DINHEIRO EM CENTAVOS INTEIROS. A comparação do piso absoluto é feita em
//    centavos, com a mesma conversão decimal do núcleo (`"1.005e2"`), porque
//    subtrair floats de 2 casas produz valores como 99.99999999999999. Este
//    arquivo é puro de propósito: importar `price-metrics.js` traria junto
//    regras de classificação que não pertencem a este portão (e o núcleo
//    aprovado no Dia 9 não deve ser alterado).
//
// 8. SEM PERSISTÊNCIA. Oportunidade é RESULTADO CALCULADO, não entidade: o
//    banco guarda viagens, ofertas e observações. Persistir exigiria decidir
//    expiração, deduplicação e idempotência de alerta — problemas que só
//    existem quando houver notificação e dados reais.

export const OPPORTUNITY_EXCLUSION = Object.freeze({
  TRIP_NOT_ACTIVE: 'TRIP_NOT_ACTIVE',
  SIMULATED_DATA: 'SIMULATED_DATA',
  UNCLASSIFIED_DATA: 'UNCLASSIFIED_DATA',
  MALFORMED_OFFER: 'MALFORMED_OFFER',
  NO_CURRENT_PRICE: 'NO_CURRENT_PRICE',
  MIXED_CURRENCY: 'MIXED_CURRENCY',
  SMALL_SAMPLE: 'SMALL_SAMPLE',
  INVALID_OBSERVATION_TIME: 'INVALID_OBSERVATION_TIME',
  STALE_OBSERVATION: 'STALE_OBSERVATION',
  NOT_BELOW_THRESHOLD: 'NOT_BELOW_THRESHOLD',
  NO_CURRENCY_FLOOR: 'NO_CURRENCY_FLOOR',
  BELOW_ABSOLUTE_FLOOR: 'BELOW_ABSOLUTE_FLOOR',
  RANK_LIMIT_EXCEEDED: 'RANK_LIMIT_EXCEEDED',
});

export const OPPORTUNITY_POLICY_DEFAULTS = Object.freeze({
  // Observações ANTERIORES exigidas (mais estrito que o mínimo descritivo 3).
  minHistoricalSampleSize: 5,
  // Dias distintos (UTC) cobertos pelas observações anteriores.
  minDistinctObservationDays: 2,
  // Idade máxima da observação atual, relativa ao `now` injetado.
  maxObservationAgeHours: 24,
  // Piso absoluto de diferença, em CENTAVOS, por moeda. Sem câmbio: uma moeda
  // ausente aqui é excluída (NO_CURRENCY_FLOOR), não herda o piso de outra.
  minAbsoluteSavingCentsByCurrency: Object.freeze({ BRL: 10000 }),
  // Limite de oportunidades por moeda (o ranking nunca cruza moedas).
  maxOpportunitiesPerCurrency: 10,
});

const POLICY_KEYS = Object.freeze(Object.keys(OPPORTUNITY_POLICY_DEFAULTS));

const HOUR_IN_MS = 3_600_000;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const OPPORTUNITY_LIMITATION_NOTES = Object.freeze([
  'historicalDifference é a diferença entre o preço atual observado e a mediana das observações ANTERIORES da própria oferta: é economia histórica observada, não economia garantida, não projeção futura e não recomendação de compra.',
  'O sistema não tem preço de mercado: comparar com o próprio passado não indica que a passagem está barata para a viagem.',
  'Ofertas com dataClassification SIMULATED são sempre excluídas: seus preços são gerados pelo provedor simulado e não representam ofertas reais.',
  'Ofertas com classificação desconhecida também são excluídas; nada é promovido a dado real.',
  'A amostra mínima (5 observações anteriores em pelo menos 2 dias distintos) e a recência (24 horas) reduzem, mas não eliminam, falsos positivos por série curta ou preço velho.',
  'O ranking é feito dentro de cada moeda; valores em moedas diferentes nunca são comparados e não há conversão cambial.',
  'Múltiplas ofertas na mesma viagem aumentam a chance de alguma parecer oportunidade apenas por acaso.',
  'Sem provedor real, a lista permanece vazia: no MVP todos os dados persistidos são simulados.',
  'Cada chamada executa duas leituras somente de leitura (análise e histórico) e não há cache.',
  'A viagem só é considerada monitorável enquanto startDate (data de calendário de início) não tiver passado.',
]);

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

function failPolicy(message) {
  throw new TypeError(`política inválida: ${message}`);
}

function validateCurrencyFloors(floors) {
  if (!isPlainObject(floors)) {
    failPolicy('minAbsoluteSavingCentsByCurrency precisa ser um objeto simples de moeda -> centavos.');
  }

  const entries = Object.entries(floors);

  if (entries.length === 0) {
    failPolicy('minAbsoluteSavingCentsByCurrency precisa declarar ao menos uma moeda.');
  }

  const normalized = {};

  for (const [currency, cents] of entries) {
    const key = currency.trim();

    if (key === '') {
      failPolicy('minAbsoluteSavingCentsByCurrency não aceita moeda vazia.');
    }

    if (key !== currency.toUpperCase()) {
      failPolicy(`minAbsoluteSavingCentsByCurrency: use a moeda em maiúsculas (${key.toUpperCase()}).`);
    }

    if (!Number.isInteger(cents) || cents <= 0) {
      failPolicy(`minAbsoluteSavingCentsByCurrency.${key} precisa ser um inteiro de centavos maior que zero.`);
    }

    normalized[key] = cents;
  }

  return Object.freeze(normalized);
}

// Valida e congela a política. Um limiar inválido falha alto em vez de excluir
// silenciosamente todas as ofertas (ou nenhuma) com um valor que ninguém escolheu.
function validatePolicy(policy) {
  if (policy === undefined) {
    return Object.freeze({
      ...OPPORTUNITY_POLICY_DEFAULTS,
      minAbsoluteSavingCentsByCurrency: validateCurrencyFloors(
        OPPORTUNITY_POLICY_DEFAULTS.minAbsoluteSavingCentsByCurrency
      ),
    });
  }

  if (!isPlainObject(policy)) {
    failPolicy('precisa ser um objeto simples (ou ser omitida).');
  }

  const unknownKeys = Object.keys(policy).filter((key) => !POLICY_KEYS.includes(key));

  if (unknownKeys.length > 0) {
    failPolicy(`chave desconhecida (${unknownKeys.join(', ')}). Aceitas: ${POLICY_KEYS.join(', ')}.`);
  }

  const criteria = { ...OPPORTUNITY_POLICY_DEFAULTS };

  for (const key of POLICY_KEYS) {
    if (key === 'minAbsoluteSavingCentsByCurrency') {
      continue;
    }

    const value = policy[key];

    if (value === undefined) {
      continue;
    }

    if (typeof value !== 'number' || !Number.isFinite(value)) {
      failPolicy(`${key} precisa ser um número finito.`);
    }

    criteria[key] = value;
  }

  if (!Number.isInteger(criteria.minHistoricalSampleSize) || criteria.minHistoricalSampleSize < 0) {
    failPolicy('minHistoricalSampleSize precisa ser um inteiro maior ou igual a zero.');
  }

  if (!Number.isInteger(criteria.minDistinctObservationDays) || criteria.minDistinctObservationDays < 0) {
    failPolicy('minDistinctObservationDays precisa ser um inteiro maior ou igual a zero.');
  }

  if (criteria.maxObservationAgeHours <= 0) {
    failPolicy('maxObservationAgeHours precisa ser maior que zero.');
  }

  if (!Number.isInteger(criteria.maxOpportunitiesPerCurrency) || criteria.maxOpportunitiesPerCurrency < 1) {
    failPolicy('maxOpportunitiesPerCurrency precisa ser um inteiro maior ou igual a um.');
  }

  criteria.minAbsoluteSavingCentsByCurrency = validateCurrencyFloors(
    policy.minAbsoluteSavingCentsByCurrency === undefined
      ? OPPORTUNITY_POLICY_DEFAULTS.minAbsoluteSavingCentsByCurrency
      : policy.minAbsoluteSavingCentsByCurrency
  );

  return Object.freeze(criteria);
}

// Mesma conversão decimal do núcleo puro: `Number("1.005e2")` é exatamente
// 100.5, enquanto `1.005 * 100` é 100.49999999999999. Retorna null quando o
// valor não é um preço representável em centavos inteiros seguros.
function amountToCents(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  const text = String(value);
  const scaled = /e/i.test(text) ? value * 100 : Number(`${text}e2`);
  const cents = Math.round(scaled);

  if (!Number.isSafeInteger(cents) || cents <= 0) {
    return null;
  }

  return cents;
}

// Data de calendário `YYYY-MM-DD` a partir do que veio no envelope de análise
// (que já entrega `startDate` como ISO date) ou de um ISO completo.
function toDateOnly(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const text = value.slice(0, 10);

  if (!DATE_ONLY_PATTERN.test(text)) {
    return null;
  }

  // O padrão regex aceita mês/dia impossíveis ("2027-13-45"). A ida-e-volta por
  // calendário UTC fecha essa brecha: datas que não existem não geram roundtrip
  // idêntico e a viagem é tratada como não ativa (fail-closed).
  const calendarDay = new Date(`${text}T00:00:00Z`);
  const roundtrip = Number.isFinite(calendarDay.getTime())
    ? calendarDay.toISOString().slice(0, 10)
    : null;

  return roundtrip === text ? text : null;
}

// startDate é DATE no banco: o dia UTC de `now` é a referência, sem hora.
// Inclusivo: viagem que começa hoje ainda é elegível.
//
// Exportada para o núcleo de monitoramento (modules/monitoring): a regra
// "viagem monitorável" é UMA só no sistema. Exportar aqui — sem alterar o
// comportamento um byte que seja — garante que diagnóstico e oportunidades
// nunca admitam viagens diferentes.
export function evaluateTripActive(trip, now) {
  const startDate = toDateOnly(trip?.startDate);

  if (startDate === null) {
    return {
      active: false,
      detail: 'startDate ausente ou fora do formato YYYY-MM-DD: viagem tratada como não monitorável.',
    };
  }

  const today = now.toISOString().slice(0, 10);

  if (startDate < today) {
    return {
      active: false,
      detail: `startDate ${startDate} anterior à data atual ${today}: a partida já passou.`,
    };
  }

  return { active: true, detail: null };
}

function moneyOf(total, currency) {
  return { total, currency };
}

// Avalia UM item do envelope de análise. Retorna ou o candidato a oportunidade
// (com os dados que a resposta expõe) ou o motivo da exclusão.
function evaluateOffer(offer, { criteria, now, observationDays, tripState }) {
  const offerId = offer?.offerId ?? null;
  const externalKey = typeof offer?.externalKey === 'string' ? offer.externalKey : '';

  if (!tripState.active) {
    return { ok: false, reason: OPPORTUNITY_EXCLUSION.TRIP_NOT_ACTIVE, detail: tripState.detail };
  }

  // Qualidade do dado: SIMULATED e desconhecido nunca entram na lista.
  if (offer?.dataClassification === 'SIMULATED') {
    return {
      ok: false,
      reason: OPPORTUNITY_EXCLUSION.SIMULATED_DATA,
      detail: 'Preço gerado pelo provedor simulado: não representa oferta real.',
    };
  }

  if (offer?.dataClassification !== 'REAL') {
    return {
      ok: false,
      reason: OPPORTUNITY_EXCLUSION.UNCLASSIFIED_DATA,
      detail: `dataClassification ${JSON.stringify(offer?.dataClassification ?? null)} não é REAL: dado desconhecido não é promovido a real.`,
    };
  }

  if (offerId === null || externalKey === '' || !isPlainObject(offer.analysis)) {
    return {
      ok: false,
      reason: OPPORTUNITY_EXCLUSION.MALFORMED_OFFER,
      detail: 'Oferta sem offerId, externalKey ou bloco analysis.',
    };
  }

  const analysis = offer.analysis;
  const current = analysis.current;
  const median = analysis.historicalMedian;

  if (current === null || current === undefined) {
    return {
      ok: false,
      reason: OPPORTUNITY_EXCLUSION.NO_CURRENT_PRICE,
      detail: 'Oferta sem observação de preço atual.',
    };
  }

  if (analysis.mixedCurrency === true) {
    return {
      ok: false,
      reason: OPPORTUNITY_EXCLUSION.MIXED_CURRENCY,
      detail: 'Série com mais de uma moeda: nenhuma comparação é feita.',
    };
  }

  const previousObservations = analysis.historical?.sampleSize;

  if (!Number.isInteger(previousObservations)) {
    return {
      ok: false,
      reason: OPPORTUNITY_EXCLUSION.MALFORMED_OFFER,
      detail: 'historical.sampleSize ausente ou não inteiro.',
    };
  }

  if (
    previousObservations < criteria.minHistoricalSampleSize ||
    !Number.isInteger(observationDays) ||
    observationDays < criteria.minDistinctObservationDays
  ) {
    return {
      ok: false,
      reason: OPPORTUNITY_EXCLUSION.SMALL_SAMPLE,
      detail: `${previousObservations} observação(ões) anterior(es) em ${observationDays ?? 0} dia(s) distinto(s); mínimo exigido: ${criteria.minHistoricalSampleSize} em ${criteria.minDistinctObservationDays} dia(s).`,
    };
  }

  const observedTime = new Date(current.observedAt).getTime();

  if (!Number.isFinite(observedTime)) {
    return {
      ok: false,
      reason: OPPORTUNITY_EXCLUSION.INVALID_OBSERVATION_TIME,
      detail: 'current.observedAt ausente ou inválida.',
    };
  }

  // Relógio adiantado (observação no futuro) não é idade negativa: é dado
  // inconsistente e não deve virar "fresco" por acidente.
  if (observedTime > now.getTime()) {
    return {
      ok: false,
      reason: OPPORTUNITY_EXCLUSION.INVALID_OBSERVATION_TIME,
      detail: 'current.observedAt está no futuro em relação ao relógio de referência.',
    };
  }

  const ageHours = (now.getTime() - observedTime) / HOUR_IN_MS;

  if (ageHours > criteria.maxObservationAgeHours) {
    return {
      ok: false,
      reason: OPPORTUNITY_EXCLUSION.STALE_OBSERVATION,
      detail: `Observação com ${ageHours.toFixed(2)} h; máximo permitido: ${criteria.maxObservationAgeHours} h.`,
    };
  }

  // A posição relativa ao histórico vem pronta do núcleo do Dia 9: aqui não se
  // recalcula percentual nem se redefine o limiar de OPPORTUNITY.
  if (analysis.classification !== 'OPPORTUNITY') {
    return {
      ok: false,
      reason: OPPORTUNITY_EXCLUSION.NOT_BELOW_THRESHOLD,
      detail: `Classificação descritiva ${JSON.stringify(analysis.classification ?? null)} não é OPPORTUNITY.`,
    };
  }

  const currency = typeof current.currency === 'string' ? current.currency.trim() : '';

  if (currency === '' || !isPlainObject(median) || median.currency !== currency) {
    return {
      ok: false,
      reason: OPPORTUNITY_EXCLUSION.MALFORMED_OFFER,
      detail: 'Moeda ausente ou referência histórica em moeda diferente da atual.',
    };
  }

  const currentCents = amountToCents(current.total);
  const medianCents = amountToCents(median.total);

  if (currentCents === null || medianCents === null) {
    return {
      ok: false,
      reason: OPPORTUNITY_EXCLUSION.MALFORMED_OFFER,
      detail: 'Preço atual ou mediana histórica não representável em centavos.',
    };
  }

  const floors = criteria.minAbsoluteSavingCentsByCurrency;

  // Object.hasOwn fecha o portão contra chaves herdadas do prototype
  // ("constructor", "toString"): moeda declarada é a única fonte de piso e
  // qualquer coisa diferente disso é exclusão (fail-closed), jamais aprovação
  // acidental por um valor arbitrário herdado.
  if (!Object.hasOwn(floors, currency)) {
    return {
      ok: false,
      reason: OPPORTUNITY_EXCLUSION.NO_CURRENCY_FLOOR,
      detail: `Não há piso absoluto definido para ${currency}; nenhum piso é herdado de outra moeda.`,
    };
  }

  const floorCents = floors[currency];

  const differenceCents = medianCents - currentCents;

  if (differenceCents < floorCents) {
    return {
      ok: false,
      reason: OPPORTUNITY_EXCLUSION.BELOW_ABSOLUTE_FLOOR,
      detail: `Diferença de ${(differenceCents / 100).toFixed(2)} ${currency}; piso exigido: ${(floorCents / 100).toFixed(2)} ${currency}.`,
    };
  }

  return {
    ok: true,
    candidate: {
      offerId,
      externalKey,
      provider: offer.provider ?? null,
      dataClassification: offer.dataClassification,
      route: offer.route ?? null,
      dates: offer.dates ?? null,
      flight: offer.flight ?? null,
      current: moneyOf(current.total, currency),
      reference: {
        type: 'HISTORICAL_MEDIAN',
        total: median.total,
        currency,
        sampleSize: median.sampleSize,
      },
      historicalSample: {
        previousObservations,
        distinctObservationDays: observationDays,
      },
      variationVsMedianPct: analysis.variationVsMedianPct,
      // Nome deliberado: diferença observada, não economia garantida.
      historicalDifference: moneyOf(differenceCents / 100, currency),
      observedAt: new Date(observedTime).toISOString(),
      differenceCents,
    },
  };
}

// Ordem do ranking dentro de UMA moeda: maior diferença absoluta primeiro;
// empate vai para a queda percentual mais forte; depois externalKey/offerId
// para que a saída não dependa da ordem de entrada.
function compareCandidates(a, b) {
  if (a.differenceCents !== b.differenceCents) {
    return b.differenceCents - a.differenceCents;
  }

  const aPct = typeof a.variationVsMedianPct === 'number' ? a.variationVsMedianPct : 0;
  const bPct = typeof b.variationVsMedianPct === 'number' ? b.variationVsMedianPct : 0;

  if (aPct !== bPct) {
    return aPct - bPct;
  }

  if (a.externalKey !== b.externalKey) {
    return a.externalKey < b.externalKey ? -1 : 1;
  }

  return a.offerId < b.offerId ? -1 : a.offerId > b.offerId ? 1 : 0;
}

function compareExclusions(a, b) {
  if (a.externalKey !== b.externalKey) {
    return a.externalKey < b.externalKey ? -1 : 1;
  }

  if (a.offerId !== b.offerId) {
    return String(a.offerId) < String(b.offerId) ? -1 : 1;
  }

  return a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0;
}

/**
 * Identifica oportunidades determinísticas a partir do envelope de análise.
 *
 * @param {object} input
 * @param {{id: string, name: string, destination: string, startDate: string, endDate: string}} input.trip
 * @param {Array<object>} input.offers itens de `offers` de `analyzeTripPrices`
 * @param {Record<string, number>} [input.observationDaysByOfferId]
 *   dias distintos (UTC) cobertos pelas observações ANTERIORES de cada oferta.
 *   Ausente = 0, o que reprova no portão de amostra (nunca aprova por omissão).
 * @param {Date} input.now referência de recência e de "hoje" (UTC)
 * @param {object} [input.policy] sobrescreve OPPORTUNITY_POLICY_DEFAULTS
 * @returns {object} oportunidades ranqueadas por moeda + exclusões + resumo
 * @throws {TypeError} entrada ou política inválida
 */
export function identifyOpportunities({
  trip,
  offers,
  observationDaysByOfferId = {},
  now,
  policy,
} = {}) {
  const criteria = validatePolicy(policy);

  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('now precisa ser um Date válido.');
  }

  if (!Array.isArray(offers)) {
    throw new TypeError('offers precisa ser um array.');
  }

  if (!isPlainObject(trip)) {
    throw new TypeError('trip precisa ser um objeto.');
  }

  if (!isPlainObject(observationDaysByOfferId)) {
    throw new TypeError('observationDaysByOfferId precisa ser um objeto (offerId -> dias distintos).');
  }

  const tripState = evaluateTripActive(trip, now);
  const containsSimulatedData = offers.some((offer) => offer?.dataClassification === 'SIMULATED');

  const excluded = [];
  const eligibleByCurrency = new Map();

  for (const offer of offers) {
    const offerId = offer?.offerId ?? null;
    const result = evaluateOffer(offer, {
      criteria,
      now,
      observationDays: offerId === null ? 0 : observationDaysByOfferId[offerId],
      tripState,
    });

    if (!result.ok) {
      excluded.push({
        offerId,
        externalKey: typeof offer?.externalKey === 'string' ? offer.externalKey : '',
        reason: result.reason,
        detail: result.detail,
      });
      continue;
    }

    const currency = result.candidate.current.currency;

    if (!eligibleByCurrency.has(currency)) {
      eligibleByCurrency.set(currency, []);
    }

    eligibleByCurrency.get(currency).push(result.candidate);
  }

  // Ranking e limite POR MOEDA: moedas diferentes nunca disputam posição.
  const opportunities = [];
  const currencies = [...eligibleByCurrency.keys()].sort();

  for (const currency of currencies) {
    const ranked = eligibleByCurrency.get(currency).slice().sort(compareCandidates);
    const selected = ranked.slice(0, criteria.maxOpportunitiesPerCurrency);

    selected.forEach((candidate, index) => {
      // O campo interno de centavos não faz parte do contrato da resposta.
      const { differenceCents, ...publicCandidate } = candidate;

      opportunities.push({ rank: index + 1, ...publicCandidate });
    });

    for (const candidate of ranked.slice(criteria.maxOpportunitiesPerCurrency)) {
      excluded.push({
        offerId: candidate.offerId,
        externalKey: candidate.externalKey,
        reason: OPPORTUNITY_EXCLUSION.RANK_LIMIT_EXCEEDED,
        detail: `Fora das ${criteria.maxOpportunitiesPerCurrency} primeiras posições em ${currency}.`,
      });
    }
  }

  // Vocabulário fechado com contagem zero: a ausência de um motivo é um dado,
  // não uma chave que desaparece do contrato.
  const excludedByReason = Object.fromEntries(
    Object.values(OPPORTUNITY_EXCLUSION).map((reason) => [reason, 0])
  );

  for (const exclusion of excluded) {
    excludedByReason[exclusion.reason] += 1;
  }

  return {
    trip: {
      id: trip.id ?? null,
      name: trip.name ?? null,
      destination: trip.destination ?? null,
      startDate: trip.startDate ?? null,
      endDate: trip.endDate ?? null,
    },
    policy: {
      ...criteria,
      minAbsoluteSavingCentsByCurrency: { ...criteria.minAbsoluteSavingCentsByCurrency },
    },
    summary: {
      evaluatedOfferCount: offers.length,
      opportunityCount: opportunities.length,
      excludedCount: excluded.length,
      excludedByReason,
      currencies,
      containsSimulatedData,
    },
    opportunities,
    excluded: excluded.sort(compareExclusions),
    limitations: [...OPPORTUNITY_LIMITATION_NOTES],
  };
}
