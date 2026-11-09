// Núcleo PURO do ciclo de monitoramento — sem banco, sem HTTP, sem relógio interno.
//
// A mesma entrada (`trips` + dependências + `now`) produz sempre o mesmo
// resultado. As dependências são FUNÇÕES injetadas: na composição real (Dia
// 11.2) serão wrappers de `searchFlightsForTrip` e `listTripOpportunities`;
// nos testes são stubs — por isso este arquivo não toca prisma/Fastify.
//
// CICLO (contrato aprovado no planejamento do Dia 11):
//   1. seleção: viagem monitorável = `evaluateTripActive` (Dia 10) — startDate
//      (calendário UTC, inclusivo) ainda não passou. A regra é UMA só no
//      sistema: importada, não duplicada;
//   2. por viagem monitorável: pesquisa (escreve observações no histórico) e,
//      em sequência, identificação de oportunidades;
//   3. isolamento de falhas: o erro de uma viagem NUNCA derruba o ciclo — o
//      item registra o estágio em que falhou (SEARCH ou OPPORTUNITIES) e o
//      ciclo continua com as demais;
//   4. contabilização fechada: monitorable = ok + failed e
//      tripCount = monitorable + skipped (nenhum trip é contado duas vezes).
//
// DECISÃO DEFERIDA COM RAZÃO DOCUMENTADA: sem "status de ciclo"
// (COMPLETED/PARTIAL/FAILED) neste núcleo — é derivável de ok/failed e o
// registro persistido do Dia 11.3 quem deve carregá-lo; aqui não há estado.
//
// NOTA DE HONESTIDADE: com o único provedor atual (simulado), toda pesquisa
// produz ofertas SIMULATED — as oportunidades listadas serão zero por
// construção. O ciclo registra esse dado por viagem, não o esconde.
//
// IMPORTANTE: cada execução REAL adiciona uma linha em `PriceHistory` por
// oferta. Dois ciclos simultâneos criariam duas observações quase idênticas
// (trend UNCHANGED artificial) — o ciclo conta com UM lock do executor (Dia
// 11.2), não com reexecução concorrente válida.

import { evaluateTripActive } from '../opportunities/opportunity-policy.js';

// Vocabulário fechado de itens de execução.
export const MONITORING_ITEM_STATUS = Object.freeze({
  OK: 'OK',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
});

// Estágios em que uma viagem monitorável pode reprovar o ciclo.
export const MONITORING_FAILURE_STAGE = Object.freeze({
  SEARCH: 'SEARCH',
  OPPORTUNITIES: 'OPPORTUNITIES',
});

// Motivos de exclusão de seleção (sem aprovação acidental por omissão).
export const MONITORING_SKIP_REASON = Object.freeze({
  TRIP_NOT_ACTIVE: 'TRIP_NOT_ACTIVE',
  MALFORMED_TRIP: 'MALFORMED_TRIP',
});

function failCore(message) {
  throw new TypeError(`entrada de monitoramento inválida: ${message}`);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function treatedResult(rawResult) {
  const opportunityCount = Array.isArray(rawResult?.opportunities)
    ? rawResult.opportunities.length
    : 0;
  const evaluatedOfferCount = Number.isInteger(rawResult?.summary?.evaluatedOfferCount)
    ? rawResult.summary.evaluatedOfferCount
    : 0;

  return {
    opportunityCount,
    evaluatedOfferCount,
    containsSimulatedData: rawResult?.summary?.containsSimulatedData === true,
  };
}

function skippedItem(tripId, reason, detail) {
  return {
    tripId,
    status: MONITORING_ITEM_STATUS.SKIPPED,
    reason,
    detail,
    opportunityCount: 0,
    evaluatedOfferCount: 0,
    containsSimulatedData: false,
  };
}

function failedItem(tripId, stage, message) {
  return {
    tripId,
    status: MONITORING_ITEM_STATUS.FAILED,
    stage,
    error: message,
    opportunityCount: 0,
    evaluatedOfferCount: 0,
    containsSimulatedData: false,
  };
}

/**
 * Executa UM ciclo determinístico de monitoramento.
 *
 * @param {object} input
 * @param {Array<object>} input.trips viagens (objetos como o Prisma entrega;
 *   ordem de entrada é preservada e nenhuma é mutada)
 * @param {(tripId: string) => Promise<object>} input.search pesquisa + snapshot
 *   da viagem (em produção: `searchFlightsForTrip`)
 * @param {(tripId: string) => Promise<object>} input.opportunities identificação
 *   de oportunidades da viagem (em produção: `listTripOpportunities`)
 * @param {Date} input.now referência UTC de seleção e recência (injetável)
 * @returns {Promise<object>} relatório do ciclo com contagens fechadas e itens
 *   por viagem
 * @throws {TypeError} entrada ou dependências inválidas
 */
export async function runMonitoringCycle({ trips, search, opportunities, now } = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    failCore('now precisa ser um Date válido.');
  }

  if (!Array.isArray(trips)) {
    failCore('trips precisa ser um array (possivelmente vazio).');
  }

  if (typeof search !== 'function') {
    failCore('search precisa ser uma função de pesquisa por viagem.');
  }

  if (typeof opportunities !== 'function') {
    failCore('opportunities precisa ser uma função de oportunidades por viagem.');
  }

  const items = [];
  let monitorableCount = 0;
  let skippedCount = 0;
  let okCount = 0;
  let failedCount = 0;
  let opportunityCount = 0;

  for (const trip of trips) {
    const tripId = trip?.id ?? null;

    if (trip === null || typeof trip !== 'object' || Array.isArray(trip)) {
      skippedCount += 1;
      items.push(
        skippedItem(tripId, MONITORING_SKIP_REASON.MALFORMED_TRIP, 'viagem em formato inválido; não executada.')
      );
      continue;
    }

    const tripState = evaluateTripActive(trip, now);

    if (!tripState.active) {
      skippedCount += 1;
      items.push(skippedItem(tripId, MONITORING_SKIP_REASON.TRIP_NOT_ACTIVE, tripState.detail));
      continue;
    }

    monitorableCount += 1;

    try {
      await search(tripId);
    } catch (error) {
      failedCount += 1;
      items.push(failedItem(tripId, MONITORING_FAILURE_STAGE.SEARCH, messageOf(error)));
      continue;
    }

    try {
      const result = treatedResult(await opportunities(tripId));

      okCount += 1;
      opportunityCount += result.opportunityCount;
      items.push({
        tripId,
        status: MONITORING_ITEM_STATUS.OK,
        opportunityCount: result.opportunityCount,
        evaluatedOfferCount: result.evaluatedOfferCount,
        containsSimulatedData: result.containsSimulatedData,
      });
    } catch (error) {
      // A pesquisa já produziu observações: o item marca o estágio exato para
      // auditoria — o histórico não é refeito aqui, o próximo ciclo cobre.
      failedCount += 1;
      items.push(failedItem(tripId, MONITORING_FAILURE_STAGE.OPPORTUNITIES, messageOf(error)));
    }
  }

  return {
    now: now.toISOString(),
    tripCount: trips.length,
    monitorableCount,
    skippedCount,
    okCount,
    failedCount,
    opportunityCount,
    items: Object.freeze(items.map((item) => Object.freeze({ ...item }))),
  };
}
