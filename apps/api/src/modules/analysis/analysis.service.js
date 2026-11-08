// Análise consolidada de preços de uma viagem — SOMENTE LEITURA.
//
// Orquestra o que já existe, sem duplicar regra de negócio:
//   - trips.service.getTripById: valida o UUID, garante 404 e devolve a viagem;
//   - offers.service.listOfferHistoryForTrip: valida o UUID, garante 404 e lê
//     do banco as ofertas com a série completa de observações;
//   - price-metrics.analyzePriceSeries: métricas puras, oferta por oferta.
//
// Este módulo só COMPÕE: não escreve no banco, não cria snapshot, não consulta
// provedor e não usa relógio (a resposta é repetível para o mesmo estado).
// Os limiares vêm de ANALYSIS_DEFAULTS; o endpoint não aceita parâmetros para
// alterá-los, porque classificar com limiares diferentes dos documentados
// exigiria expor essa configuração e testá-la como contrato público.

import {
  analyzePriceSeries,
  ANALYSIS_DEFAULTS,
  PRICE_CLASSIFICATION,
} from './price-metrics.js';
import { getTripById } from '../trips/trips.service.js';
import { listOfferHistoryForTrip } from '../offers/offers.service.js';

// Motivos das classificações que o módulo puro só rotula. Os motivos de
// INSUFFICIENT_DATA já vêm em `analysis.classificationReason` e são
// repassados sem tradução (NO_CURRENT_OBSERVATION, MIXED_CURRENCY,
// NOT_ENOUGH_PREVIOUS_OBSERVATIONS, NO_REFERENCE_PRICE).
export const CLASSIFICATION_EXPLANATION = Object.freeze({
  BELOW_MEDIAN_BY_THRESHOLD: 'BELOW_MEDIAN_BY_THRESHOLD',
  WITHIN_MEDIAN_RANGE: 'WITHIN_MEDIAN_RANGE',
  ABOVE_MEDIAN_BY_THRESHOLD: 'ABOVE_MEDIAN_BY_THRESHOLD',
});

// Mesma ordem e vocabulário do núcleo puro; uma classificação nova aparece aqui
// automaticamente (com contagem zero) em vez de sumir da resposta.
const CLASSIFICATIONS = Object.freeze(Object.values(PRICE_CLASSIFICATION));

// Limitações que a resposta carrega para que o consumidor não leia a
// classificação como recomendação nem como preço de mercado.
const LIMITATION_NOTES = Object.freeze([
  'A classificação compara o preço atual com o histórico observado da própria oferta; não há comparação com o mercado nem entre ofertas.',
  'Não é recomendação de compra: o resultado descreve a posição do preço em relação à mediana das observações anteriores.',
  'Amostra pequena: com 3 observações anteriores a mediana é um dos próprios valores observados, sem intervalo de confiança.',
  'Só existe observação quando uma pesquisa é executada; a série reflete os horários de uso do sistema, não a dinâmica real de preços.',
  'Variações abaixo de 0,5% são indistinguíveis do arredondamento de centavos.',
  'Ofertas com menos de 4 observações no total permanecem em INSUFFICIENT_DATA.',
]);

const SIMULATED_DATA_NOTE =
  'As ofertas com dataClassification SIMULATED têm preços gerados pelo provedor simulado: identificam o fluxo, mas não representam ofertas reais nem preços de mercado.';

// Ordem determinística das ofertas na resposta. offers.service lista por
// flightNumber, que pode empatar entre provedores; externalKey é único por
// viagem (@@unique tripId+externalKey), então ordenar por ele (e por id como
// desempate defensivo) garante resposta repetível sem tocar no service existente.
function compareOffers(a, b) {
  if (a.externalKey !== b.externalKey) {
    return a.externalKey < b.externalKey ? -1 : 1;
  }

  if (a.id === b.id) {
    return 0;
  }

  return a.id < b.id ? -1 : 1;
}

function explainClassification(analysis) {
  let reason = analysis.classificationReason;

  if (reason === null) {
    if (analysis.classification === PRICE_CLASSIFICATION.OPPORTUNITY) {
      reason = CLASSIFICATION_EXPLANATION.BELOW_MEDIAN_BY_THRESHOLD;
    } else if (analysis.classification === PRICE_CLASSIFICATION.ABOVE_HISTORY) {
      reason = CLASSIFICATION_EXPLANATION.ABOVE_MEDIAN_BY_THRESHOLD;
    } else {
      reason = CLASSIFICATION_EXPLANATION.WITHIN_MEDIAN_RANGE;
    }
  }

  return {
    reason,
    reference: analysis.historicalMedian
      ? { type: 'HISTORICAL_MEDIAN', ...analysis.historicalMedian }
      : null,
    thresholds: {
      minPreviousObservations: analysis.criteria.minPreviousObservations,
      opportunityDropPct: analysis.criteria.opportunityDropPct,
      aboveHistoryPct: analysis.criteria.aboveHistoryPct,
    },
  };
}

// Indicadores da resposta. São DOIS eixos distintos, que não se confundem:
//
// - AMOSTRA (dataQuality.offersWithEnoughHistory): a oferta tem ao menos
//   `minPreviousObservations` observações ANTERIORES, ou seja, histórico
//   suficiente para TENTAR classificar. É contagem de tamanho de série.
// - RESULTADO (summary.classifiedOfferCount e classificationCounts): a oferta
//   REALMENTE recebeu OPPORTUNITY, FAIR ou ABOVE_HISTORY. É o veredito.
//
// Os dois números podem divergir sem inconsistência: uma oferta com amostra
// suficiente continua INSUFFICIENT_DATA se a série mistura moedas ou não tiver
// preço de referência. Por isso classifiedOfferCount <= offersWithEnoughHistory.
//
// observationCount/invalidObservationCount somam as séries por oferta; a atual
// está incluída na contagem de válidas (o histórico usado no cálculo é
// anterior a ela, mas o dado disponível é a série inteira).
function summarizeOffers(analyzedOffers) {
  const classificationCounts = Object.fromEntries(
    CLASSIFICATIONS.map((classification) => [classification, 0])
  );

  let observationCount = 0;
  let invalidObservationCount = 0;
  let simulatedOfferCount = 0;
  let realOfferCount = 0;
  let unclassifiedOfferCount = 0;
  let mixedCurrencyOfferCount = 0;
  let offersWithEnoughHistory = 0;

  const currencies = new Set();

  for (const { dataClassification, analysis } of analyzedOffers) {
    classificationCounts[analysis.classification] += 1;
    observationCount += analysis.observationCount;
    invalidObservationCount += analysis.invalidObservationCount;

    // Contagem ESTRITA pelo valor armazenado: nada é inferido do preço e uma
    // classificação desconhecida nunca é apresentada como dado real.
    if (dataClassification === 'SIMULATED') {
      simulatedOfferCount += 1;
    } else if (dataClassification === 'REAL') {
      realOfferCount += 1;
    } else {
      unclassifiedOfferCount += 1;
    }

    if (analysis.mixedCurrency) {
      mixedCurrencyOfferCount += 1;
    }

    if (analysis.currency !== null) {
      currencies.add(analysis.currency);
    }

    if (analysis.historical.sampleSize >= analysis.criteria.minPreviousObservations) {
      offersWithEnoughHistory += 1;
    }
  }

  const classifiedOfferCount =
    analyzedOffers.length - classificationCounts.INSUFFICIENT_DATA;

  return {
    summary: {
      offerCount: analyzedOffers.length,
      classifiedOfferCount,
      classificationCounts,
      currencies: [...currencies].sort(),
      mixedCurrencyOfferCount,
    },
    dataQuality: {
      observationCount,
      invalidObservationCount,
      simulatedOfferCount,
      realOfferCount,
      unclassifiedOfferCount,
      containsSimulatedData: simulatedOfferCount > 0,
      offersWithEnoughHistory,
      offersWithoutEnoughHistory: analyzedOffers.length - offersWithEnoughHistory,
    },
  };
}

export async function analyzeTripPrices(tripId) {
  // getTripById valida o UUID (400) e a existência (404) com as mesmas
  // mensagens já usadas pelo restante da API.
  const trip = await getTripById(tripId);
  const { offers } = await listOfferHistoryForTrip(tripId);

  const analyzedOffers = [...offers]
    .sort(compareOffers)
    .map((offer) => {
      const analysis = analyzePriceSeries(offer.observations);

      return {
        offerId: offer.id,
        provider: offer.provider,
        dataClassification: offer.dataClassification,
        simulated: offer.dataClassification === 'SIMULATED',
        type: offer.type,
        route: offer.route,
        dates: offer.dates,
        flight: offer.flight,
        externalKey: offer.externalKey,
        analysis,
        explanation: explainClassification(analysis),
      };
    });

  const { summary, dataQuality } = summarizeOffers(analyzedOffers);

  const limitations = dataQuality.containsSimulatedData
    ? [...LIMITATION_NOTES, SIMULATED_DATA_NOTE]
    : [...LIMITATION_NOTES];

  return {
    trip: {
      id: trip.id,
      name: trip.name,
      destination: trip.destination,
      startDate: trip.startDate,
      endDate: trip.endDate,
    },
    summary,
    dataQuality,
    criteria: { ...ANALYSIS_DEFAULTS },
    offers: analyzedOffers,
    limitations,
  };
}
