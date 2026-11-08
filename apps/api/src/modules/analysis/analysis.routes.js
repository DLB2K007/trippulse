import * as analysisService from './analysis.service.js';

// Validação inteira da requisição em UMA única configuração de schema.
//
// params: o :tripId é obrigatório e string (o formato UUID é regra de domínio,
// validada em trips.service, que responde 400).
//
// querystring: o endpoint não aceita parâmetros — os limiares vêm de
// ANALYSIS_DEFAULTS e são devolvidos em `criteria`. `maxProperties: 0` recusa
// qualquer chave. Não dá para usar `additionalProperties: false` aqui: o Ajv do
// Fastify roda com `removeAdditional: true`, que REMOVE a propriedade extra em
// vez de falhar quando `additionalProperties` é false — a chave desapareceria
// em silêncio e `?minPreviousObservations=1` pareceria ter sido aceita.
const requestSchema = {
  params: {
    type: 'object',
    required: ['tripId'],
    properties: {
      tripId: { type: 'string' },
    },
  },
  querystring: {
    type: 'object',
    maxProperties: 0,
    properties: {},
  },
};

// Análise consolidada de preços de uma viagem. Recurso aninhado em /trips e
// estritamente de LEITURA: não cria snapshot nem observação.
export async function analysisRoutes(app) {
  app.get(
    '/:tripId/analysis',
    { schema: requestSchema },
    async (request) => {
      return analysisService.analyzeTripPrices(request.params.tripId);
    }
  );
}
