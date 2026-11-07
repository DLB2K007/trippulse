// Domínio das ofertas: persistência de snapshots de oferta e histórico de preços.
// Consumido pelo módulo flights (e futuramente por hotéis/veículos/atividades).

import { prisma } from '../../config/prisma.js';

// Identidade externa de uma oferta: mesma combinação de provedor + rota +
// voo + partida representa o MESMO voo observado, mesmo que o preço mude.
export function buildOfferExternalKey(offer) {
  return [
    offer.provider,
    offer.route.origin,
    offer.route.destination,
    offer.flight.airline,
    offer.flight.flightNumber,
    offer.dates.departureDate,
  ].join('|');
}

function buildTrend(previousObservation, currentTotal) {
  if (!previousObservation) {
    return 'FIRST_OBSERVATION';
  }

  if (currentTotal < previousObservation.total) {
    return 'DROPPED';
  }

  if (currentTotal > previousObservation.total) {
    return 'ROSE';
  }

  return 'UNCHANGED';
}

// Persiste o snapshot de uma pesquisa e calcula o comparativo de cada oferta.
// Retorna um Map: externalKey -> { observedAt, current, previous, best, trend }.
export async function persistOfferSnapshot(tripId, offers) {
  const observedAt = new Date();
  const snapshotResult = new Map();

  for (const offer of offers) {
    const externalKey = buildOfferExternalKey(offer);

    const existingOffer = await prisma.flightOffer.findUnique({
      where: { tripId_externalKey: { tripId, externalKey } },
    });

    let previousObservation = null;
    let flightOfferRow;

    if (existingOffer) {
      flightOfferRow = existingOffer;
      previousObservation = await prisma.priceHistory.findFirst({
        where: { offerId: existingOffer.id, observedAt: { lt: observedAt } },
        orderBy: { observedAt: 'desc' },
      });
    } else {
      flightOfferRow = await prisma.flightOffer.create({
        data: {
          tripId,
          provider: offer.provider,
          dataClassification: offer.dataClassification,
          type: offer.type,
          origin: offer.route.origin,
          destination: offer.route.destination,
          departureDate: new Date(offer.dates.departureDate),
          arrivalDate: new Date(offer.dates.arrivalDate),
          airline: offer.flight.airline,
          flightNumber: offer.flight.flightNumber,
          stops: offer.flight.stops,
          cabinClass: offer.flight.cabinClass,
          baggagePieces: offer.flight.baggagePieces,
          refundable: offer.flight.refundable,
          externalKey,
        },
      });
    }

    const currentObservation = await prisma.priceHistory.create({
      data: {
        offerId: flightOfferRow.id,
        currency: offer.price.currency,
        total: offer.price.total,
        base: offer.price.base,
        taxes: offer.price.taxes,
        observedAt,
      },
    });

    const bestObservation = await prisma.priceHistory.findFirst({
      where: { offerId: flightOfferRow.id },
      orderBy: { total: 'asc' },
    });

    snapshotResult.set(externalKey, {
      observedAt,
      current: {
        total: currentObservation.total,
        currency: currentObservation.currency,
      },
      previous: previousObservation
        ? {
            total: previousObservation.total,
            currency: previousObservation.currency,
            observedAt: previousObservation.observedAt,
          }
        : null,
      best: {
        total: bestObservation.total,
        currency: bestObservation.currency,
        observedAt: bestObservation.observedAt,
      },
      trend: buildTrend(previousObservation, currentObservation.total),
    });
  }

  return snapshotResult;
}
