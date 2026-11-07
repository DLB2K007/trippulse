import * as offersService from './offers.service.js';

const tripParamsSchema = {
  type: 'object',
  required: ['tripId'],
  properties: {
    tripId: { type: 'string' },
  },
};

// Histórico consolidado das ofertas persistidas de uma viagem.
// Recurso aninhado em /trips.
export async function offerRoutes(app) {
  app.get(
    '/:tripId/offers/history',
    { schema: { params: tripParamsSchema } },
    async (request) => {
      return offersService.listOfferHistoryForTrip(request.params.tripId);
    }
  );
}
