// Execução MANUAL do ciclo de monitoramento — orquestração real (banco OK).
//
// O núcleo puro do Dia 11.1 decide TUDO (seleção, isolamento de falhas,
// contagens); este service só fornece as dependências reais, o gatilho e o
// lock in-process. Nenhuma regra de análise ou elegibilidade é duplicada:
//   - pesquisa  → searchFlightsForTrip (Dia 4/5: escreve observações);
//   - oportunidades → listTripOpportunities (Dia 10: leitura pura);
//   - listagem de viagens → listTrips (Dia 3).
//
// LOCK IN-PROCESS: um único ciclo por vez dentro do processo. Justificativa
// técnica: cada pesquisa CRIA observações em PriceHistory — dois ciclos
// simultâneos criariam observações quase idênticas (trend UNCHANGED
// artificial) e distorceriam tendências. O flag é setado SINCRONICAMENTE
// antes de qualquer await: entre o check e o set do lock, o único código que
// roda é o deste bloco (single-threaded), logo não há corrida in-process.
// Persistência (Dia 11.3) e múltiplos processos/workers futuros exigirão
// árbitro do banco (índice parcial único em status='RUNNING'), decidido no
// dia da persistência — não inventado aqui.
//
// SEM PERSISTÊNCIA nesta etapa (Dia 11.2): o relatório do ciclo é resposta
// HTTP direta; nenhum registro de execução é gravado. O histórico fica para
// a migration do Dia 11.3 — POST responde sem histórico fictício.

import { runMonitoringCycle } from './monitoring-core.js';
import { searchFlightsForTrip } from '../flights/flights.service.js';
import { listTripOpportunities } from '../opportunities/opportunities.service.js';
import { listTrips } from '../trips/trips.service.js';
import { HttpError } from '../../shared/errors.js';

export const MONITORING_CONCURRENCY_ERROR = Object.freeze(
  'Já existe uma execução de monitoramento em andamento.'
);

// true enquanto o ciclo estiver rodando neste processo (não é Promise: o
// estado é booleano e o finally é a única rotina de liberação).
let cycleInFlight = false;

/**
 * Inicia a execução manual do ciclo de monitoramento.
 *
 * Dependências injetáveis (usadas em produção pelos defaults; testes e o
 * agendador futuro podem sobrescrever):
 * @param {object} [options]
 * @param {Date} [options.now] referência UTC injetável (tests)
 * @param {Array<object>} [options.trips] sobrescreve a listagem do banco
 * @param {(tripId) => Promise<object>} [options.search] sobrescreve a pesquisa
 * @param {(tripId) => Promise<object>} [options.opportunities] sobrescreve as oportunidades
 * @returns {Promise<object>} relatório do núcleo (contrato do Dia 11.1)
 * @throws {HttpError} 409 quando já há um ciclo em curso no processo
 */
export async function startMonitoringRun({
  now = new Date(),
  trips = undefined,
  search = searchFlightsForTrip,
  opportunities = listTripOpportunities,
} = {}) {
  // Corrida in-process impossível: set síncrono, antes do primeiro await.
  if (cycleInFlight) {
    throw new HttpError(409, MONITORING_CONCURRENCY_ERROR);
  }

  cycleInFlight = true;

  try {
    const resolvedTrips = trips === undefined ? await listTrips() : trips;

    return await runMonitoringCycle({
      trips: resolvedTrips,
      search,
      opportunities,
      now,
    });
  } finally {
    cycleInFlight = false;
  }
}
