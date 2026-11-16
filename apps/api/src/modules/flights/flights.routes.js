import * as flightsService from './flights.service.js';

const tripParamsSchema = {
  type: 'object',
  required: ['tripId'],
  properties: {
    tripId: { type: 'string', description: 'UUID da viagem.' },
  },
};

// Pesquisa de passagens de uma viagem. Recurso aninhado em /trips.
export async function flightRoutes(app) {
  app.get(
    '/:tripId/flights',
    {
      schema: {
        tags: ['Flights'],
        operationId: 'searchFlights',
        summary: 'Pesquisa passagens de uma viagem',
        description:
          'Executa a pesquisa nos provedores habilitados, normaliza e persiste um snapshot atômico de ofertas e observações. A barreira REAL permanece ativa.',
        params: tripParamsSchema,
        response: {
          200: { $ref: 'FlightSearchEnvelope#' },
          400: { $ref: 'ErrorResponse#' },
          404: { $ref: 'ErrorResponse#' },
          409: { $ref: 'ErrorResponse#' },
          500: { $ref: 'ErrorResponse#' },
          503: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request) => {
      return flightsService.searchFlightsForTrip(request.params.tripId);
    }
  );
}
