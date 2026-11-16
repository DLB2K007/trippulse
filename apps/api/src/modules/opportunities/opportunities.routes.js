import * as opportunitiesService from './opportunities.service.js';

// Validação inteira da requisição em UMA única configuração de schema, igual à
// rota de análise: o :tripId é string obrigatória (o formato UUID é regra de
// domínio, validada em trips.service, que responde 400) e a querystring não
// aceita chave alguma — a política é fixa e vem em `policy` na resposta.
//
// `maxProperties: 0` em vez de `additionalProperties: false` porque o Ajv do
// Fastify roda com `removeAdditional: true`: a chave extra seria REMOVIDA em
// silêncio e `?minHistoricalSampleSize=0` pareceria aceita.
const requestSchema = {
  params: {
    type: 'object',
    required: ['tripId'],
    properties: {
      tripId: { type: 'string', description: 'UUID da viagem.' },
    },
  },
  querystring: {
    type: 'object',
    maxProperties: 0,
    properties: {},
  },
};

// Oportunidades de compra de uma viagem. Recurso aninhado em /trips e
// estritamente de LEITURA: não persiste oportunidade, não cria observação e
// não consulta provedor.
export async function opportunitiesRoutes(app) {
  app.get(
    '/:tripId/opportunities',
    {
      schema: {
        tags: ['Opportunities'],
        operationId: 'getTripOpportunities',
        summary: 'Lista oportunidades de compra de uma viagem',
        description:
          'Aplica a política determinística sobre a análise existente, com exclusões motivadas, ranking por moeda e diferença histórica observada. Não é recomendação de compra.',
        params: requestSchema.params,
        querystring: requestSchema.querystring,
        response: {
          200: { $ref: 'OpportunitiesEnvelope#' },
          400: { $ref: 'ErrorResponse#' },
          404: { $ref: 'ErrorResponse#' },
          500: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request) => {
      return opportunitiesService.listTripOpportunities(request.params.tripId);
    }
  );
}
