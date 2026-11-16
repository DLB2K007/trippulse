import * as offersService from './offers.service.js';

const tripParamsSchema = {
  type: 'object',
  required: ['tripId'],
  properties: {
    tripId: { type: 'string', description: 'UUID da viagem.' },
  },
};

// Histórico consolidado das ofertas persistidas de uma viagem.
// Recurso aninhado em /trips.
export async function offerRoutes(app) {
  app.get(
    '/:tripId/offers/history',
    {
      schema: {
        tags: ['Offers'],
        operationId: 'getOfferHistory',
        summary: 'Consulta o histórico consolidado de ofertas',
        description:
          'Lê exclusivamente do banco a série completa de observações por oferta, com current, previous, best e trend.',
        params: tripParamsSchema,
        response: {
          200: { $ref: 'OfferHistoryEnvelope#' },
          400: { $ref: 'ErrorResponse#' },
          404: { $ref: 'ErrorResponse#' },
          500: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request) => {
      return offersService.listOfferHistoryForTrip(request.params.tripId);
    }
  );
}
