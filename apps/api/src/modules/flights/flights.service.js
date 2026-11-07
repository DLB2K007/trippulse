// Orquestra a pesquisa simulada de passagens aéreas de uma viagem cadastrada.
// Fluxo: viagem -> provedores (integrations) -> normalização -> ofertas padronizadas.

import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../shared/errors.js';
import { getFlightProviders } from '../../integrations/flight-providers/index.js';
import { normalizeFlightOffer } from '../../integrations/flight-providers/normalize.js';

export async function searchFlightsForTrip(tripId) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });

  if (!trip) {
    throw new HttpError(404, 'Viagem não encontrada.');
  }

  // A viagem não possui cidade de origem no modelo atual; o provedor simulado
  // gera uma origem fictícia. Tudo é retornado com classificação SIMULATED.
  const searchQuery = {
    destination: trip.destination,
    departureDate: trip.startDate.toISOString().slice(0, 10),
    returnDate: trip.endDate.toISOString().slice(0, 10),
  };

  const providers = getFlightProviders();

  const providerResults = await Promise.all(
    providers.map(async (provider) => {
      const rawOffers = await provider.search(searchQuery);
      return rawOffers.map((rawOffer) => normalizeFlightOffer(provider, rawOffer, searchQuery));
    })
  );

  const offers = providerResults.flat();

  return {
    simulated: true,
    providerCount: providers.length,
    query: {
      destination: searchQuery.destination,
      departureDate: searchQuery.departureDate,
      returnDate: searchQuery.returnDate,
    },
    offers,
  };
}
