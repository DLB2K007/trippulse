// Oportunidades de compra de uma viagem — SOMENTE LEITURA.
//
// Este service não contém regra: ele COMPÕE o que já existe e delega a decisão
// determinística à política pura.
//
//   - analysis.service.analyzeTripPrices: valida o UUID (400), garante 404,
//     devolve a viagem e a classificação descritiva de cada oferta. É a única
//     fonte de OPPORTUNITY/FAIR/ABOVE_HISTORY — a política não recalcula nada;
//   - offers.service.listOfferHistoryForTrip: entrega a série completa por
//     oferta, de onde sai a cobertura de DIAS DISTINTOS (o envelope de análise
//     não expõe os carimbos do histórico, só a contagem);
//   - opportunity-policy.identifyOpportunities: portões, ranking por moeda,
//     exclusões com motivo e resumo.
//
// Custo explícito: duas leituras por chamada (análise + histórico), ambas sem
// escrita. É aceitável no MVP e evita duplicar a composição da análise; não há
// cache nem persistência de oportunidade nesta etapa.

import { analyzeTripPrices } from '../analysis/analysis.service.js';
import { listOfferHistoryForTrip } from '../offers/offers.service.js';
import { identifyOpportunities } from './opportunity-policy.js';

const DAY_IN_MS = 86_400_000;

// Dias distintos (UTC) cobertos pelas observações ANTERIORES. A última
// observação da série (ordem ascendente) é o preço atual e não conta como
// histórico — mesma convenção do núcleo do Dia 9.
function countDistinctUtcDays(observations) {
  const days = new Set();

  for (const observation of observations) {
    const time = new Date(observation?.observedAt).getTime();

    if (!Number.isFinite(time)) {
      continue;
    }

    days.add(Math.floor(time / DAY_IN_MS));
  }

  return days.size;
}

async function buildObservationDaysByOfferId(tripId) {
  const { offers } = await listOfferHistoryForTrip(tripId);
  const days = {};

  for (const offer of offers) {
    const observations = Array.isArray(offer.observations) ? offer.observations : [];
    const previous = observations.slice(0, Math.max(observations.length - 1, 0));

    days[offer.id] = countDistinctUtcDays(previous);
  }

  return days;
}

/**
 * Lista as oportunidades determinísticas de uma viagem.
 *
 * @param {string} tripId
 * @param {{now?: Date}} [options] referência de recência injetável (testes)
 * @returns {Promise<object>} envelope de oportunidades
 */
export async function listTripOpportunities(tripId, { now = new Date() } = {}) {
  // Primeiro a análise: é ela que valida UUID/existência com as mensagens já
  // usadas pela API e que define a classificação descritiva.
  const analysis = await analyzeTripPrices(tripId);
  const observationDaysByOfferId = await buildObservationDaysByOfferId(tripId);

  return identifyOpportunities({
    trip: analysis.trip,
    offers: analysis.offers,
    observationDaysByOfferId,
    now,
  });
}
