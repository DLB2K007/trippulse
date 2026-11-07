// Orquestra a pesquisa simulada de passagens aéreas de uma viagem cadastrada.
// Fluxo: viagem -> provedores (integrations) -> normalização ->
// snapshot de ofertas/histórico de preços (modules/offers) -> resposta.

import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../shared/errors.js';
import { getFlightProviders } from '../../integrations/flight-providers/index.js';
import { normalizeFlightOffer } from '../../integrations/flight-providers/normalize.js';
import {
  persistOfferSnapshot,
  buildOfferExternalKey,
} from '../offers/offers.service.js';

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
  const priorObservations = await prisma.priceHistory.count({
    // Histórico acumulado do percurso de observações anteriores, usado como
    // semente de variação de preços no provedor (nenhuma observação anterior
    // é necessária no momento da pesquisa atual).
    where: { flightOffer: { tripId } },
  });
  // Cada pesquisa adiciona uma observação por oferta, então o número de
  // observações anteriores cresce uniformemente e separa pesquisas distintas.
  const previousOfferCount = await prisma.flightOffer.count({ where: { tripId } });
  const variationSeed = previousOfferCount > 0 ? Math.floor(priorObservations / previousOfferCount) : 0;

  const providerResults = await Promise.all(
    providers.map(async (provider) => {
      const rawOffers = await provider.search(searchQuery, { variationSeed });
      return rawOffers.map((rawOffer) => normalizeFlightOffer(provider, rawOffer, searchQuery));
    })
  );

  const offers = providerResults.flat();
  // Persistência do snapshot: alimenta o histórico de preços e gera o comparativo.
  const snapshotResult = await persistOfferSnapshot(tripId, offers);

  return {
    simulated: true,
    persisted: true,
    providerCount: providers.length,
    query: {
      destination: searchQuery.destination,
      departureDate: searchQuery.departureDate,
      returnDate: searchQuery.returnDate,
    },
    offers: offers.map((offer) => ({
      ...offer,
      history: snapshotResult.get(buildOfferExternalKey(offer)),
    })),
  };
}
