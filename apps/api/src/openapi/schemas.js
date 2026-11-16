// Componentes JSON Schema compartilhados entre validação/serialização Fastify e
// geração OpenAPI 3.1.
//
// IMPORTANTE: `schema.response` do Fastify também é usado pelo serializer. Um
// campo retornado pelo service que não esteja declarado aqui é REMOVIDO da
// resposta HTTP. Por isso os schemas abaixo são completos e FECHADOS: cada
// campo público precisa ser declarado explicitamente. O fechamento é a
// allowlist do contrato; campos internos ou novos não são expostos por
// acidente. Apenas mapas realmente dinâmicos (moedas e `params` de erro do
// Ajv) usam `additionalProperties` não-booleano.

const nullableString = { type: ['string', 'null'] };
const nullableNumber = { type: ['number', 'null'] };
const nullableInteger = { type: ['integer', 'null'] };
const nullableBoolean = { type: ['boolean', 'null'] };

const ref = (name) => ({ $ref: `${name}#` });

const object = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});

const arrayOf = (name) => ({ type: 'array', items: ref(name) });

const money = object({
  total: { type: 'number' },
  currency: { type: 'string' },
});

const observedMoney = object({
  total: { type: 'number' },
  currency: { type: 'string' },
  observedAt: { type: 'string', format: 'date-time' },
});

const route = object({
  origin: { type: 'string' },
  destination: { type: 'string' },
});

const dates = object({
  // O provedor simulado devolve data-hora ISO; o SerpApi normaliza para
  // YYYY-MM-DD. O contrato preserva a string real, sem inventar um formato
  // único que um dos provedores não cumpre.
  departureDate: { type: 'string' },
  arrivalDate: { type: 'string' },
});

const flight = object({
  airline: { type: 'string' },
  flightNumber: { type: 'string' },
  stops: { type: 'integer' },
  cabinClass: { type: 'string' },
  baggagePieces: nullableInteger,
  refundable: nullableBoolean,
});

const price = object({
  currency: { type: 'string' },
  total: { type: 'number' },
  base: nullableNumber,
  taxes: nullableNumber,
});

const searchQuery = object({
  origin: { type: 'string' },
  destination: { type: 'string' },
  departureDate: { type: 'string' },
  returnDate: { type: 'string' },
});

const priceInsights = {
  type: 'object',
  additionalProperties: false,
  properties: {
    lowest_price: nullableNumber,
    price_level: nullableString,
    typical_price_range: {
      anyOf: [
        { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
        { type: 'null' },
      ],
    },
    price_history: {
      anyOf: [
        {
          type: 'array',
          items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
        },
        { type: 'null' },
      ],
    },
  },
};

const relatedQuery = object(
  {
    origin: { type: 'string' },
    destination: { type: 'string' },
    departureDate: { type: 'string' },
    returnDate: { type: 'string' },
    priceInsights,
  },
  ['origin', 'destination', 'departureDate', 'returnDate']
);

const priceSnapshot = object({
  observedAt: { type: 'string', format: 'date-time' },
  current: money,
  previous: {
    anyOf: [ref('MoneyWithObservation'), { type: 'null' }],
  },
  best: {
    anyOf: [ref('MoneyWithObservation'), { type: 'null' }],
  },
  trend: { type: 'string', enum: ['FIRST_OBSERVATION', 'DROPPED', 'ROSE', 'UNCHANGED'] },
});

const definitions = {
  HealthResponse: object({
    status: { type: 'string' },
    service: { type: 'string' },
  }),

  Trip: object({
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    destination: { type: 'string' },
    origin: nullableString,
    startDate: { type: 'string', format: 'date' },
    endDate: { type: 'string', format: 'date' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  }),

  Money: money,

  MoneyWithObservation: observedMoney,

  FlightRoute: route,

  FlightDates: dates,

  FlightDetails: flight,

  OfferPrice: price,

  SearchQuery: searchQuery,

  RelatedQuery: relatedQuery,

  PriceSnapshot: priceSnapshot,

  FlightOfferSearch: object({
    provider: { type: 'string' },
    isSimulated: { type: 'boolean' },
    dataClassification: { type: 'string', description: 'SIMULATED ou REAL; valores desconhecidos não são promovidos.' },
    type: { type: 'string' },
    route: ref('FlightRoute'),
    dates: ref('FlightDates'),
    flight: ref('FlightDetails'),
    price: ref('OfferPrice'),
    relatedQuery: ref('RelatedQuery'),
    history: ref('PriceSnapshot'),
  }),

  FlightSearchEnvelope: object({
    simulated: { type: 'boolean' },
    persisted: { type: 'boolean' },
    providerCount: { type: 'integer' },
    query: ref('SearchQuery'),
    offers: arrayOf('FlightOfferSearch'),
  }),

  PriceObservation: object({
    currency: { type: 'string' },
    total: { type: 'number' },
    base: nullableNumber,
    taxes: nullableNumber,
    observedAt: { type: 'string', format: 'date-time' },
  }),

  HistoryOffer: object({
    id: { type: 'string', format: 'uuid' },
    provider: { type: 'string' },
    dataClassification: { type: 'string' },
    type: { type: 'string' },
    route: ref('FlightRoute'),
    dates: ref('FlightDates'),
    flight: ref('FlightDetails'),
    externalKey: { type: 'string' },
    observations: { type: 'array', items: ref('PriceObservation') },
    current: { anyOf: [ref('PriceObservation'), { type: 'null' }] },
    previous: { anyOf: [ref('PriceObservation'), { type: 'null' }] },
    best: { anyOf: [ref('PriceObservation'), { type: 'null' }] },
    trend: { type: 'string', enum: ['FIRST_OBSERVATION', 'DROPPED', 'ROSE', 'UNCHANGED'] },
  }),

  OfferHistoryEnvelope: object({
    tripId: { type: 'string', format: 'uuid' },
    offerCount: { type: 'integer' },
    offers: arrayOf('HistoryOffer'),
  }),

  AnalysisTrip: object({
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    destination: { type: 'string' },
    startDate: { type: 'string', format: 'date' },
    endDate: { type: 'string', format: 'date' },
  }),

  AnalysisCriteria: object({
    minPreviousObservations: { type: 'integer' },
    opportunityDropPct: { type: 'number' },
    aboveHistoryPct: { type: 'number' },
  }),

  AnalysisCurrent: object({
    total: { type: 'number' },
    currency: { type: 'string' },
    observedAt: { type: 'string', format: 'date-time' },
  }),

  HistoricalMedian: object({
    total: { type: 'number' },
    currency: { type: 'string' },
    sampleSize: { type: 'integer' },
  }),

  HistoricalStats: object({
    sampleSize: { type: 'integer' },
    mean: { anyOf: [ref('Money'), { type: 'null' }] },
    min: { anyOf: [ref('Money'), { type: 'null' }] },
    max: { anyOf: [ref('Money'), { type: 'null' }] },
    spread: { anyOf: [ref('Money'), { type: 'null' }] },
  }),

  AnalysisResult: object({
    observationCount: { type: 'integer' },
    invalidObservationCount: { type: 'integer' },
    currency: nullableString,
    mixedCurrency: { type: 'boolean' },
    current: { anyOf: [ref('AnalysisCurrent'), { type: 'null' }] },
    previous: { anyOf: [ref('AnalysisCurrent'), { type: 'null' }] },
    historicalMedian: { anyOf: [ref('HistoricalMedian'), { type: 'null' }] },
    historical: ref('HistoricalStats'),
    variationVsPreviousPct: nullableNumber,
    variationVsMedianPct: nullableNumber,
    trend: {
      type: ['string', 'null'],
      enum: ['FIRST_OBSERVATION', 'DROPPED', 'ROSE', 'UNCHANGED', null],
    },
    classification: {
      type: 'string',
      enum: ['INSUFFICIENT_DATA', 'OPPORTUNITY', 'FAIR', 'ABOVE_HISTORY'],
    },
    classificationReason: {
      type: ['string', 'null'],
      enum: [
        'NO_CURRENT_OBSERVATION',
        'MIXED_CURRENCY',
        'NOT_ENOUGH_PREVIOUS_OBSERVATIONS',
        'NO_REFERENCE_PRICE',
        null,
      ],
    },
    criteria: ref('AnalysisCriteria'),
  }),

  ExplanationReference: object({
    type: { type: 'string', enum: ['HISTORICAL_MEDIAN'] },
    total: { type: 'number' },
    currency: { type: 'string' },
    sampleSize: { type: 'integer' },
  }),

  AnalysisExplanation: object({
    reason: {
      type: 'string',
      enum: [
        'BELOW_MEDIAN_BY_THRESHOLD',
        'WITHIN_MEDIAN_RANGE',
        'ABOVE_MEDIAN_BY_THRESHOLD',
        'NO_CURRENT_OBSERVATION',
        'MIXED_CURRENCY',
        'NOT_ENOUGH_PREVIOUS_OBSERVATIONS',
        'NO_REFERENCE_PRICE',
      ],
    },
    reference: { anyOf: [ref('ExplanationReference'), { type: 'null' }] },
    thresholds: ref('AnalysisCriteria'),
  }),

  AnalysisOffer: object({
    offerId: { type: 'string', format: 'uuid' },
    provider: { type: 'string' },
    dataClassification: { type: 'string' },
    simulated: { type: 'boolean' },
    type: { type: 'string' },
    route: ref('FlightRoute'),
    dates: ref('FlightDates'),
    flight: ref('FlightDetails'),
    externalKey: { type: 'string' },
    analysis: ref('AnalysisResult'),
    explanation: ref('AnalysisExplanation'),
  }),

  ClassificationCounts: object({
    INSUFFICIENT_DATA: { type: 'integer' },
    OPPORTUNITY: { type: 'integer' },
    FAIR: { type: 'integer' },
    ABOVE_HISTORY: { type: 'integer' },
  }),

  AnalysisSummary: object({
    offerCount: { type: 'integer' },
    classifiedOfferCount: { type: 'integer' },
    classificationCounts: ref('ClassificationCounts'),
    currencies: { type: 'array', items: { type: 'string' } },
    mixedCurrencyOfferCount: { type: 'integer' },
  }),

  AnalysisDataQuality: object({
    observationCount: { type: 'integer' },
    invalidObservationCount: { type: 'integer' },
    simulatedOfferCount: { type: 'integer' },
    realOfferCount: { type: 'integer' },
    unclassifiedOfferCount: { type: 'integer' },
    containsSimulatedData: { type: 'boolean' },
    offersWithEnoughHistory: { type: 'integer' },
    offersWithoutEnoughHistory: { type: 'integer' },
  }),

  AnalysisEnvelope: object({
    trip: ref('AnalysisTrip'),
    summary: ref('AnalysisSummary'),
    dataQuality: ref('AnalysisDataQuality'),
    criteria: ref('AnalysisCriteria'),
    offers: arrayOf('AnalysisOffer'),
    limitations: { type: 'array', items: { type: 'string' } },
  }),

  OpportunityTrip: object({
    id: nullableString,
    name: nullableString,
    destination: nullableString,
    startDate: { type: ['string', 'null'], format: 'date' },
    endDate: { type: ['string', 'null'], format: 'date' },
  }),

  CurrencyFloors: {
    type: 'object',
    additionalProperties: { type: 'integer' },
  },

  OpportunityPolicy: object({
    minHistoricalSampleSize: { type: 'integer' },
    minDistinctObservationDays: { type: 'integer' },
    maxObservationAgeHours: { type: 'number' },
    minAbsoluteSavingCentsByCurrency: ref('CurrencyFloors'),
    maxOpportunitiesPerCurrency: { type: 'integer' },
  }),

  ExcludedByReason: object({
    TRIP_NOT_ACTIVE: { type: 'integer' },
    SIMULATED_DATA: { type: 'integer' },
    UNCLASSIFIED_DATA: { type: 'integer' },
    MALFORMED_OFFER: { type: 'integer' },
    NO_CURRENT_PRICE: { type: 'integer' },
    MIXED_CURRENCY: { type: 'integer' },
    SMALL_SAMPLE: { type: 'integer' },
    INVALID_OBSERVATION_TIME: { type: 'integer' },
    STALE_OBSERVATION: { type: 'integer' },
    NOT_BELOW_THRESHOLD: { type: 'integer' },
    NO_CURRENCY_FLOOR: { type: 'integer' },
    BELOW_ABSOLUTE_FLOOR: { type: 'integer' },
    RANK_LIMIT_EXCEEDED: { type: 'integer' },
  }),

  OpportunitySummary: object({
    evaluatedOfferCount: { type: 'integer' },
    opportunityCount: { type: 'integer' },
    excludedCount: { type: 'integer' },
    excludedByReason: ref('ExcludedByReason'),
    currencies: { type: 'array', items: { type: 'string' } },
    containsSimulatedData: { type: 'boolean' },
  }),

  HistoricalSample: object({
    previousObservations: { type: 'integer' },
    distinctObservationDays: { type: 'integer' },
  }),

  Opportunity: object({
    rank: { type: 'integer' },
    offerId: { type: 'string', format: 'uuid' },
    externalKey: { type: 'string' },
    provider: nullableString,
    dataClassification: { type: 'string' },
    route: { anyOf: [ref('FlightRoute'), { type: 'null' }] },
    dates: { anyOf: [ref('FlightDates'), { type: 'null' }] },
    flight: { anyOf: [ref('FlightDetails'), { type: 'null' }] },
    current: ref('Money'),
    reference: ref('ExplanationReference'),
    historicalSample: ref('HistoricalSample'),
    variationVsMedianPct: nullableNumber,
    historicalDifference: ref('Money'),
    observedAt: { type: 'string', format: 'date-time' },
  }),

  OpportunityExclusion: object({
    offerId: nullableString,
    externalKey: { type: 'string' },
    reason: {
      type: 'string',
      enum: [
        'TRIP_NOT_ACTIVE',
        'SIMULATED_DATA',
        'UNCLASSIFIED_DATA',
        'MALFORMED_OFFER',
        'NO_CURRENT_PRICE',
        'MIXED_CURRENCY',
        'SMALL_SAMPLE',
        'INVALID_OBSERVATION_TIME',
        'STALE_OBSERVATION',
        'NOT_BELOW_THRESHOLD',
        'NO_CURRENCY_FLOOR',
        'BELOW_ABSOLUTE_FLOOR',
        'RANK_LIMIT_EXCEEDED',
      ],
    },
    detail: { type: 'string' },
  }),

  OpportunitiesEnvelope: object({
    trip: ref('OpportunityTrip'),
    policy: ref('OpportunityPolicy'),
    summary: ref('OpportunitySummary'),
    opportunities: arrayOf('Opportunity'),
    excluded: arrayOf('OpportunityExclusion'),
    limitations: { type: 'array', items: { type: 'string' } },
  }),

  MonitoringItemOk: object(
    {
      tripId: nullableString,
      status: { type: 'string', enum: ['OK'] },
      opportunityCount: { type: 'integer', minimum: 0 },
      evaluatedOfferCount: { type: 'integer', minimum: 0 },
      containsSimulatedData: { type: 'boolean' },
    },
    ['tripId', 'status']
  ),

  MonitoringItemFailed: object(
    {
      tripId: nullableString,
      status: { type: 'string', enum: ['FAILED'] },
      stage: { type: 'string', enum: ['SEARCH', 'OPPORTUNITIES'] },
      error: { type: 'string' },
      opportunityCount: { type: 'integer', minimum: 0 },
      evaluatedOfferCount: { type: 'integer', minimum: 0 },
      containsSimulatedData: { type: 'boolean' },
    },
    ['tripId', 'status', 'stage', 'error', 'opportunityCount', 'evaluatedOfferCount', 'containsSimulatedData']
  ),

  MonitoringItemSkipped: object(
    {
      tripId: nullableString,
      status: { type: 'string', enum: ['SKIPPED'] },
      reason: { type: 'string', enum: ['TRIP_NOT_ACTIVE', 'MALFORMED_TRIP'] },
      detail: { type: 'string' },
      opportunityCount: { type: 'integer', minimum: 0 },
      evaluatedOfferCount: { type: 'integer', minimum: 0 },
      containsSimulatedData: { type: 'boolean' },
    },
    ['tripId', 'status', 'reason', 'detail', 'opportunityCount', 'evaluatedOfferCount', 'containsSimulatedData']
  ),

  MonitoringItem: {
    oneOf: [
      ref('MonitoringItemOk'),
      ref('MonitoringItemFailed'),
      ref('MonitoringItemSkipped'),
    ],
  },

  ValidationIssue: object(
    {
      instancePath: { type: 'string' },
      schemaPath: { type: 'string' },
      keyword: { type: 'string' },
      params: { type: 'object', additionalProperties: true },
      message: { type: 'string' },
    },
    []
  ),

  MonitoringRun: object({
    runId: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: ['RUNNING', 'COMPLETED', 'FAILED'] },
    trigger: { type: 'string', enum: ['MANUAL', 'SCHEDULED'] },
    startedAt: { type: 'string', format: 'date-time' },
    finishedAt: { type: ['string', 'null'], format: 'date-time' },
    durationMs: nullableInteger,
    tripCount: { type: 'integer' },
    monitorableCount: { type: 'integer' },
    skippedCount: { type: 'integer' },
    okCount: { type: 'integer' },
    failedCount: { type: 'integer' },
    opportunityCount: { type: 'integer' },
    items: { type: 'array', items: ref('MonitoringItem') },
    failureReason: nullableString,
  }),

  ErrorResponse: object(
    {
      statusCode: { type: 'integer' },
      error: { type: 'string' },
      message: { type: 'string' },
      code: { type: 'string' },
      validation: {
        type: 'array',
        items: ref('ValidationIssue'),
      },
      validationContext: { type: 'string' },
    },
    ['statusCode', 'error', 'message']
  ),
};

export const OPENAPI_SCHEMAS = definitions;

export function registerOpenApiSchemas(app) {
  for (const [name, schema] of Object.entries(definitions)) {
    app.addSchema({ ...schema, $id: name });
  }
}

export { ref };

export const schemaRef = ref;

export function arraySchema(name) {
  return arrayOf(name);
}

export const noContentSchema = { type: 'null' };
