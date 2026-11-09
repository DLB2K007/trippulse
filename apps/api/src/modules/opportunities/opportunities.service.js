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

// Espelho fiel da seleção do núcleo do Dia 9 (price-metrics.normalize):
// linhas com total inválido, moeda ausente ou data inválida são DESCARTADAS,
// e a "observação atual" é a ÚLTIMA linha cronologicamente VÁLIDA — nunca a
// última linha bruta (que pode ser inválida). Manter em sincronia com o núcleo;
// divergências só seriam possíveis com dados que o banco não produz hoje
// (observedAt e total são sempre válidos nas linhas persistidas).
// Redução pura exportada para o teste de regressão (não aciona o banco).
export function distinctDaysBeforeCurrent(observations) {
  const usable = (Array.isArray(observations) ? observations : [])
    .map((observation) => {
      const currency =
        typeof observation?.currency === 'string' ? observation.currency.trim() : '';
      const total = observation?.total;
      const time = new Date(observation?.observedAt).getTime();

      return { currency, total, time };
    })
    .filter(
      (row) =>
        Number.isFinite(row.time) &&
        row.currency !== '' &&
        typeof row.total === 'number' &&
        Number.isFinite(row.total) &&
        row.total > 0
    )
    // Sort estável: empates de observedAt mantêm a ordem de entrada (núcleo).
    .sort((a, b) => a.time - b.time);

  // Histórico do núcleo = linhas válidas MENOS a última cronológica. Contar
  // "tudo menos a última linha bruta" incluiria o dia do próprio current
  // quando a linha mais recente é inválida — inflando dias distintos.
  const days = new Set();

  for (const row of usable.slice(0, Math.max(usable.length - 1, 0))) {
    days.add(Math.floor(row.time / DAY_IN_MS));
  }

  return days.size;
}

async function buildObservationDaysByOfferId(tripId) {
  const { offers } = await listOfferHistoryForTrip(tripId);
  const days = {};

  for (const offer of offers) {
    days[offer.id] = distinctDaysBeforeCurrent(
      Array.isArray(offer.observations) ? offer.observations : []
    );
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
