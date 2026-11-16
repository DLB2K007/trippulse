import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { tripsRoutes } from './modules/trips/trips.routes.js';
import { flightRoutes } from './modules/flights/flights.routes.js';
import { offerRoutes } from './modules/offers/offers.routes.js';
import { analysisRoutes } from './modules/analysis/analysis.routes.js';
import { opportunitiesRoutes } from './modules/opportunities/opportunities.routes.js';
import { monitoringRoutes } from './modules/monitoring/monitoring.routes.js';
import { registerOpenApiSchemas } from './openapi/schemas.js';

export const OPENAPI_TAGS = [
  { name: 'Health', description: 'Saúde da API.' },
  { name: 'Trips', description: 'Cadastro e manutenção de viagens.' },
  { name: 'Flights', description: 'Pesquisa de passagens e snapshot de ofertas.' },
  { name: 'Offers', description: 'Histórico consolidado de ofertas observadas.' },
  { name: 'Analysis', description: 'Análise descritiva do histórico de preços.' },
  { name: 'Opportunities', description: 'Oportunidades determinísticas de compra.' },
  { name: 'Monitoring', description: 'Execuções do ciclo de monitoramento.' },
];

export const OPENAPI_INFO = {
  title: 'TripPulse API',
  description:
    'Contrato HTTP da API TripPulse. Não há autenticação nesta fase; a documentação deve permanecer desabilitada em produção por padrão.',
  version: '0.1.0',
};

const RESPONSE_DESCRIPTIONS = {
  200: 'Requisição processada com sucesso.',
  201: 'Recurso criado com sucesso.',
  204: 'Recurso removido; sem corpo de resposta.',
  400: 'Requisição inválida (UUID, body, querystring ou regra de domínio).',
  404: 'Recurso não encontrado.',
  409: 'Conflito com o estado atual do recurso.',
  500: 'Erro interno inesperado.',
  503: 'Provedor externo indisponível.',
};

const ERROR_EXAMPLES = {
  400: {
    statusCode: 400,
    error: 'Bad Request',
    message: 'O identificador da viagem precisa ser um UUID válido.',
  },
  404: {
    statusCode: 404,
    error: 'Not Found',
    message: 'Viagem não encontrada.',
  },
  409: {
    statusCode: 409,
    error: 'Conflict',
    message: 'A viagem já possui ofertas; rota e período não podem ser alterados.',
  },
  500: {
    statusCode: 500,
    error: 'Internal Server Error',
    message: 'Erro interno inesperado.',
  },
  503: {
    statusCode: 503,
    error: 'Service Unavailable',
    message: 'O provedor de voos está temporariamente indisponível.',
  },
};

const TRIP_EXAMPLE = {
  id: '3f1c2a9e-7b4d-4c1a-8e2f-5a6b7c8d9e0f',
  name: 'Férias em Lisboa',
  origin: 'GRU',
  destination: 'LIS',
  startDate: '2027-09-01',
  endDate: '2027-09-10',
  createdAt: '2026-11-16T12:00:00.000Z',
  updatedAt: '2026-11-16T12:00:00.000Z',
};

const FLIGHT_ROUTE_EXAMPLE = { origin: 'GRU', destination: 'LIS' };
const FLIGHT_DATES_EXAMPLE = {
  departureDate: '2027-09-01T10:00:00.000Z',
  arrivalDate: '2027-09-01T22:00:00.000Z',
};
const FLIGHT_DETAILS_EXAMPLE = {
  airline: 'Fixture Airways',
  flightNumber: 'FA123',
  stops: 0,
  cabinClass: 'ECONOMY',
  baggagePieces: 1,
  refundable: false,
};
const SEARCH_QUERY_EXAMPLE = {
  origin: 'GRU',
  destination: 'LIS',
  departureDate: '2027-09-01',
  returnDate: '2027-09-10',
};
const MONITORING_RUN_EXAMPLE = {
  runId: '8a7b6c5d-4e3f-4a2b-9c1d-0e1f2a3b4c5d',
  status: 'COMPLETED',
  trigger: 'MANUAL',
  startedAt: '2026-11-16T12:00:00.000Z',
  finishedAt: '2026-11-16T12:00:02.000Z',
  durationMs: 2000,
  tripCount: 1,
  monitorableCount: 1,
  skippedCount: 0,
  okCount: 1,
  failedCount: 0,
  opportunityCount: 0,
  items: [],
  failureReason: null,
};

const RESPONSE_EXAMPLES = {
  getHealth: {
    200: { status: 'ok', service: 'trippulse-api' },
  },
  createTrip: { 201: TRIP_EXAMPLE },
  listTrips: { 200: [TRIP_EXAMPLE] },
  getTrip: { 200: TRIP_EXAMPLE },
  updateTrip: { 200: { ...TRIP_EXAMPLE, name: 'Férias em Portugal' } },
  searchFlights: {
    200: {
      simulated: true,
      persisted: true,
      providerCount: 1,
      query: SEARCH_QUERY_EXAMPLE,
      offers: [
        {
          provider: 'simulated-airways',
          isSimulated: true,
          dataClassification: 'SIMULATED',
          type: 'flight',
          route: FLIGHT_ROUTE_EXAMPLE,
          dates: FLIGHT_DATES_EXAMPLE,
          flight: FLIGHT_DETAILS_EXAMPLE,
          price: { currency: 'BRL', total: 3500, base: 3000, taxes: 500 },
          relatedQuery: SEARCH_QUERY_EXAMPLE,
          history: {
            observedAt: '2026-11-16T12:00:00.000Z',
            current: { total: 3500, currency: 'BRL' },
            previous: null,
            best: null,
            trend: 'FIRST_OBSERVATION',
          },
        },
      ],
    },
  },
  getOfferHistory: {
    200: {
      tripId: TRIP_EXAMPLE.id,
      offerCount: 1,
      offers: [
        {
          id: '7e6d5c4b-3a2f-4e1d-9c8b-7a6f5e4d3c2b',
          provider: 'simulated-airways',
          dataClassification: 'SIMULATED',
          type: 'flight',
          route: FLIGHT_ROUTE_EXAMPLE,
          dates: FLIGHT_DATES_EXAMPLE,
          flight: FLIGHT_DETAILS_EXAMPLE,
          externalKey: 'simulated|GRU|LIS|FA123|2027-09-01T10:00:00.000Z',
          observations: [
            {
              currency: 'BRL',
              total: 3500,
              base: 3000,
              taxes: 500,
              observedAt: '2026-11-16T12:00:00.000Z',
            },
          ],
          current: {
            currency: 'BRL',
            total: 3500,
            base: 3000,
            taxes: 500,
            observedAt: '2026-11-16T12:00:00.000Z',
          },
          previous: null,
          best: {
            currency: 'BRL',
            total: 3500,
            base: 3000,
            taxes: 500,
            observedAt: '2026-11-16T12:00:00.000Z',
          },
          trend: 'FIRST_OBSERVATION',
        },
      ],
    },
  },
  getTripAnalysis: {
    200: {
      trip: {
        id: TRIP_EXAMPLE.id,
        name: TRIP_EXAMPLE.name,
        destination: TRIP_EXAMPLE.destination,
        startDate: TRIP_EXAMPLE.startDate,
        endDate: TRIP_EXAMPLE.endDate,
      },
      summary: {
        offerCount: 1,
        classifiedOfferCount: 1,
        classificationCounts: {
          INSUFFICIENT_DATA: 1,
          OPPORTUNITY: 0,
          FAIR: 0,
          ABOVE_HISTORY: 0,
        },
        currencies: ['BRL'],
        mixedCurrencyOfferCount: 0,
      },
      dataQuality: {
        observationCount: 1,
        invalidObservationCount: 0,
        simulatedOfferCount: 1,
        realOfferCount: 0,
        unclassifiedOfferCount: 0,
        containsSimulatedData: true,
        offersWithEnoughHistory: 0,
        offersWithoutEnoughHistory: 1,
      },
      criteria: {
        minPreviousObservations: 3,
        opportunityDropPct: 10,
        aboveHistoryPct: 10,
      },
      offers: [
        {
          offerId: '7e6d5c4b-3a2f-4e1d-9c8b-7a6f5e4d3c2b',
          provider: 'simulated-airways',
          dataClassification: 'SIMULATED',
          simulated: true,
          type: 'flight',
          route: FLIGHT_ROUTE_EXAMPLE,
          dates: FLIGHT_DATES_EXAMPLE,
          flight: FLIGHT_DETAILS_EXAMPLE,
          externalKey: 'simulated|GRU|LIS|FA123|2027-09-01T10:00:00.000Z',
          analysis: {
            observationCount: 1,
            invalidObservationCount: 0,
            currency: 'BRL',
            mixedCurrency: false,
            current: {
              total: 3500,
              currency: 'BRL',
              observedAt: '2026-11-16T12:00:00.000Z',
            },
            previous: null,
            historicalMedian: null,
            historical: { sampleSize: 0, mean: null, min: null, max: null, spread: null },
            variationVsPreviousPct: null,
            variationVsMedianPct: null,
            trend: null,
            classification: 'INSUFFICIENT_DATA',
            classificationReason: 'NOT_ENOUGH_PREVIOUS_OBSERVATIONS',
            criteria: {
              minPreviousObservations: 3,
              opportunityDropPct: 10,
              aboveHistoryPct: 10,
            },
          },
          explanation: {
            reason: 'NOT_ENOUGH_PREVIOUS_OBSERVATIONS',
            reference: null,
            thresholds: {
              minPreviousObservations: 3,
              opportunityDropPct: 10,
              aboveHistoryPct: 10,
            },
          },
        },
      ],
      limitations: [],
    },
  },
  getTripOpportunities: {
    200: {
      trip: {
        id: TRIP_EXAMPLE.id,
        name: TRIP_EXAMPLE.name,
        destination: TRIP_EXAMPLE.destination,
        startDate: TRIP_EXAMPLE.startDate,
        endDate: TRIP_EXAMPLE.endDate,
      },
      policy: {
        minHistoricalSampleSize: 3,
        minDistinctObservationDays: 2,
        maxObservationAgeHours: 72,
        minAbsoluteSavingCentsByCurrency: { BRL: 5000 },
        maxOpportunitiesPerCurrency: 3,
      },
      summary: {
        evaluatedOfferCount: 1,
        opportunityCount: 0,
        excludedCount: 1,
        excludedByReason: {
          TRIP_NOT_ACTIVE: 0,
          SIMULATED_DATA: 1,
          UNCLASSIFIED_DATA: 0,
          MALFORMED_OFFER: 0,
          NO_CURRENT_PRICE: 0,
          MIXED_CURRENCY: 0,
          SMALL_SAMPLE: 0,
          INVALID_OBSERVATION_TIME: 0,
          STALE_OBSERVATION: 0,
          NOT_BELOW_THRESHOLD: 0,
          NO_CURRENCY_FLOOR: 0,
          BELOW_ABSOLUTE_FLOOR: 0,
          RANK_LIMIT_EXCEEDED: 0,
        },
        currencies: ['BRL'],
        containsSimulatedData: true,
      },
      opportunities: [],
      excluded: [
        {
          offerId: '7e6d5c4b-3a2f-4e1d-9c8b-7a6f5e4d3c2b',
          externalKey: 'simulated|GRU|LIS|FA123|2027-09-01T10:00:00.000Z',
          reason: 'SIMULATED_DATA',
          detail: 'Oferta simulada não gera oportunidade.',
        },
      ],
      limitations: [],
    },
  },
  startMonitoringRun: { 200: MONITORING_RUN_EXAMPLE },
  listMonitoringRuns: { 200: [MONITORING_RUN_EXAMPLE] },
};

function addResponseDetails(openapiObject) {
  for (const pathItem of Object.values(openapiObject.paths ?? {})) {
    for (const operation of Object.values(pathItem)) {
      if (!operation || typeof operation !== 'object' || !operation.responses) continue;

      for (const [status, response] of Object.entries(operation.responses)) {
        response.description = RESPONSE_DESCRIPTIONS[status] ?? response.description;

        const content = response.content?.['application/json'];
        if (!content) continue;

        const example =
          RESPONSE_EXAMPLES[operation.operationId]?.[status] ?? ERROR_EXAMPLES[status];
        if (example) {
          content.examples = { exemplo: { value: example } };
        }
      }
    }
  }

  return openapiObject;
}

async function healthRoutes(app) {
  app.get(
    '/health',
    {
      schema: {
        tags: ['Health'],
        operationId: 'getHealth',
        summary: 'Verifica a saúde da API',
        description: 'Responde com o estado básico do serviço.',
        response: {
          200: { $ref: 'HealthResponse#' },
        },
      },
    },
    async () => {
      return {
        status: 'ok',
        service: 'trippulse-api',
      };
    }
  );
}

/**
 * Monta a aplicação Fastify.
 *
 * @param {object} [options]
 * @param {boolean} [options.docsEnabled=false] registra Swagger/OpenAPI e a UI
 *   somente quando explicitamente habilitado. O default seguro também mantém
 *   os testes e o bootstrap sem exposição acidental da documentação.
 * @returns {import('fastify').FastifyInstance}
 */
export function buildApp({ docsEnabled = false } = {}) {
  const app = Fastify({
    logger: true,
  });

  if (docsEnabled) {
    app.register(swagger, {
      openapi: {
        openapi: '3.1.0',
        info: OPENAPI_INFO,
        tags: OPENAPI_TAGS,
        servers: [],
      },
      refResolver: {
        buildLocalReference(json, _baseUri, _fragment, index) {
          if (!json.title && json.$id) {
            json.title = json.$id;
          }
          return json.title || `def-${index}`;
        },
      },
      transform: ({ schema, url }) => ({
        schema,
        // O prefixo `/trips` + rota `/` é servido como `/trips`; o documento
        // não deve publicar `/trips/` como um path diferente.
        url: url === '/trips/' ? '/trips' : url,
      }),
      transformObject: ({ openapiObject }) => addResponseDetails(openapiObject),
    });

    app.register(swaggerUi, {
      routePrefix: '/documentation',
      // A UI usa somente assets locais. A CSP não autoriza estilos remotos nem
      // o validador externo do Swagger UI; `validatorUrl: false` remove a
      // requisição de terceiro que o plugin habilitaria por padrão.
      staticCSP:
        "default-src 'self'; base-uri 'self'; font-src 'self' data:; frame-ancestors 'self'; img-src 'self' data:; object-src 'none'; script-src 'self'; script-src-attr 'none'; style-src 'self'; upgrade-insecure-requests;",
      validatorUrl: false,
      uiConfig: {
        docExpansion: 'list',
        deepLinking: true,
        displayRequestDuration: true,
      },
    });
  }

  registerOpenApiSchemas(app);

  app.register(healthRoutes);
  app.register(tripsRoutes, { prefix: '/trips' });
  app.register(flightRoutes, { prefix: '/trips' });
  app.register(offerRoutes, { prefix: '/trips' });
  app.register(analysisRoutes, { prefix: '/trips' });
  app.register(opportunitiesRoutes, { prefix: '/trips' });
  app.register(monitoringRoutes, { prefix: '/monitoring' });

  return app;
}
