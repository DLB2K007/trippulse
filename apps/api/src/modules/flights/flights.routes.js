import * as flightsService from './flights.service.js';

const tripParamsSchema = {
  type: 'object',
  required: ['tripId'],
  properties: {
    tripId: { type: 'string' },
  },
};

// Pesquisa de passagens de uma viagem. Recurso aninhado em /trips.
export async function flightRoutes(app) {
  app.get(
    '/:tripId/flights',
    { schema: { params: tripParamsSchema } },
    async (request) => {
      return flightsService.searchFlightsForTrip(request.params.tripId);
    }
  );
}
