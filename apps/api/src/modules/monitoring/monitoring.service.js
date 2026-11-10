// Execução MANUAL do ciclo de monitoramento — orquestração real (banco OK).
//
// O núcleo puro do Dia 11.1 decide TUDO (seleção, isolamento de falhas,
// contagens); este service fornece as dependências reais, o gatilho e DOIS
// níveis de exclusão mútua (Dia 11.3):
//   1. LOCK IN-PROCESS (Dia 11.2, preservado): fast path do mesmo processo —
//      flag booleana setada SINCRONICAMENTE antes de qualquer await, sem
//      janela entre check e set (single-threaded).
//   2. ÁRBITRO DO BANCO: a linha só entra como RUNNING e a migration cria
//      índice parcial único em status='RUNNING' — mesmo com múltiplos
//      processos/workers, o segundo INSERT recebe P2002 do Postgres. A
//      violação vira 409 SOMENTE quando comprovadamente relacionada a este
//      índice ( código P2002 + meta.target = monitoring_runs_one_running_key );
//      qualquer outro conflito de unicidade é bug e sobe como está.
//
// PERSISTÊNCIA (Dia 11.3): uma linha em monitoring_runs por execução —
// criada como RUNNING, finalizada SEMPRE no desfecho:
//   - COMPLETED: ciclo terminou; contagens e itens refletem o relatório;
//   - FAILED: ciclo ABORTOU (falha global; falha por viagem é dado do
//     relatório, não status). A finalização em falha engolide falha de UPDATE
//     (banco já em problema) para preservar o erro original e nunca mascarar.
// Nenhuma regra do ciclo é duplicada: a persistência apenas REFLETE o
// relatório; a derivação de status (decisão deferida no 11.1) acontece aqui.
//
// RESILIÊNCIA (Dia 11.5): cada RUNNING renova heartbeatAt enquanto o ciclo
// trabalha. Uma execução cujo processo morreu deixa de renovar e é convertida
// em FAILED por recoverStaleMonitoringRuns() antes da próxima execução,
// liberando o índice parcial único. Os UPDATEs finais são condicionados a
// status=RUNNING: uma execução recuperada nunca é "ressuscitada" para
// COMPLETED por um processo atrasado.

import { prisma } from '../../config/prisma.js';
import { Prisma } from '@prisma/client';
import { runMonitoringCycle } from './monitoring-core.js';
import { searchFlightsForTrip } from '../flights/flights.service.js';
import { listTripOpportunities } from '../opportunities/opportunities.service.js';
import { listTrips } from '../trips/trips.service.js';
import { HttpError } from '../../shared/errors.js';

export const MONITORING_RUN_STATUS = Object.freeze({
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
});

// Vocabulário fechado JÁ NESTA migration: o agendador do Dia 11.4 grava
// SCHEDULED sem nenhuma mudança de schema.
export const MONITORING_RUN_TRIGGER = Object.freeze({
  MANUAL: 'MANUAL',
  SCHEDULED: 'SCHEDULED',
});

const MONITORING_CONCURRENCY_ERROR = 'Já existe uma execução de monitoramento em andamento.';
export { MONITORING_CONCURRENCY_ERROR };

// Sem heartbeat novo por 30 min, a execução é considerada órfã. O limite é
// conservador: ciclos normais renovam o heartbeat antes/depois de cada
// pesquisa e de cada avaliação de oportunidades.
export const DEFAULT_STALE_RUN_AFTER_MS = 30 * 60 * 1000;

const LEASE_LOST_ERROR =
  'A execução de monitoramento perdeu a posse (heartbeat expirado ou execução recuperada).';

// Nome do índice parcial criado manualmente na migration (Prisma não modela
// índice parcial). É a referência exata do arbítrio P2002 → 409.
const RUNNING_UNIQUE_INDEX = 'monitoring_runs_one_running_key';

// true enquanto o ciclo estiver rodando neste processo (fast path do lock).
let cycleInFlight = false;

function isSingleRunningConflict(error) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }

  // Prisma 7 + adapter-pg: o índice violado chega em meta.driverAdapterError
  // (cause.constraint.index / originalMessage — verificado empiricamente no
  // Postgres via 23505); o meta.target clássico dos clients baked não vem.
  // TODOS os caminhos são conferidos contra o MESMO nome exato do índice
  // parcial: qualquer outro conflito de unicidade NUNCA vira 409.
  const legacyTarget = String(error.meta?.target ?? '');
  const cause = error.meta?.driverAdapterError?.cause;
  const adapterIndex = String(cause?.constraint?.index ?? '');

  return (
    legacyTarget.includes(RUNNING_UNIQUE_INDEX) ||
    adapterIndex === RUNNING_UNIQUE_INDEX ||
    String(cause?.originalMessage ?? '').includes(`unique constraint "${RUNNING_UNIQUE_INDEX}"`)
  );
}

function toRunView(run) {
  return {
    runId: run.id,
    status: run.status,
    trigger: run.trigger,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt === null ? null : run.finishedAt.toISOString(),
    durationMs: run.durationMs,
    tripCount: run.tripCount,
    monitorableCount: run.monitorableCount,
    skippedCount: run.skippedCount,
    okCount: run.okCount,
    failedCount: run.failedCount,
    opportunityCount: run.opportunityCount,
    items: run.items,
    failureReason: run.failureReason ?? null,
  };
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Recupera execuções RUNNING cujo processo deixou de renovar o heartbeat.
 *
 * A operação é um UPDATE condicional (status=RUNNING + heartbeat antigo), então
 * é segura entre processos: duas instâncias podem chamar ao mesmo tempo e
 * apenas uma efetivamente converte a linha. Uma execução viva (heartbeat
 * recente) NUNCA é tocada.
 *
 * @param {object} [options]
 * @param {Date} [options.now] referência para o cálculo da idade (tests)
 * @param {number} [options.staleAfterMs] idade máxima sem heartbeat
 * @returns {Promise<{ recovered: number, threshold: Date }>}
 * @throws {TypeError} opções inválidas
 */
export async function recoverStaleMonitoringRuns({
  now = new Date(),
  staleAfterMs = DEFAULT_STALE_RUN_AFTER_MS,
} = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('now precisa ser um Date válido.');
  }
  if (!Number.isInteger(staleAfterMs) || staleAfterMs <= 0) {
    throw new TypeError('staleAfterMs precisa ser um inteiro positivo.');
  }

  const threshold = new Date(now.getTime() - staleAfterMs);

  const result = await prisma.monitoringRun.updateMany({
    where: {
      status: MONITORING_RUN_STATUS.RUNNING,
      heartbeatAt: { lt: threshold },
    },
    data: {
      status: MONITORING_RUN_STATUS.FAILED,
      finishedAt: now,
      failureReason: `Execução órfã recuperada automaticamente após ${staleAfterMs} ms sem heartbeat.`,
    },
  });

  return { recovered: result.count, threshold };
}

/**
 * Lista o histórico REAL de execuções persistidas (mais recentes primeiro).
 *
 * @param {object} [options]
 * @param {number} [options.limit] 1–100 (default 20)
 * @returns {Promise<Array<object>>} execuções em formato de visão (toRunView)
 * @throws {HttpError} 400 em limit fora da faixa
 */
export async function listMonitoringRuns({ limit = 20 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new HttpError(400, 'limit deve ser um inteiro entre 1 e 100.');
  }

  const runs = await prisma.monitoringRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: limit,
  });

  return runs.map(toRunView);
}

/**
 * Inicia a execução manual do ciclo de monitoramento com persistência.
 *
 * Dependências injetáveis (defaults de produção; testes e o agendador futuro
 * podem sobrescrever):
 * @param {object} [options]
 * @param {Date} [options.now] referência UTC injetável (tests)
 * @param {string} [options.trigger] MANUAL (default) | SCHEDULED (Dia 11.4)
 * @param {Array<object>} [options.trips] sobrescreve a listagem do banco
 * @param {(tripId) => Promise<object>} [options.search] sobrescreve a pesquisa
 * @param {(tripId) => Promise<object>} [options.opportunities] sobrescreve as oportunidades
 * @param {number} [options.staleAfterMs] idade máxima sem heartbeat antes de
 *   considerar uma execução anterior órfã (tests; default 30 min)
 * @returns {Promise<object>} registro persistido (contrato de toRunView)
 * @throws {HttpError} 409 quando já há execução em curso (lock OU árbitro)
 * @throws {TypeError} opções estruturalmente inválidas (falha antes de tocar banco)
 */
export async function startMonitoringRun({
  now = new Date(),
  trigger = MONITORING_RUN_TRIGGER.MANUAL,
  trips = undefined,
  search = searchFlightsForTrip,
  opportunities = listTripOpportunities,
  staleAfterMs = DEFAULT_STALE_RUN_AFTER_MS,
} = {}) {
  // Validação ANTES do lock: erro de chamador não consume a vaga do ciclo.
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('now precisa ser um Date válido.');
  }
  if (!Object.values(MONITORING_RUN_TRIGGER).includes(trigger)) {
    throw new TypeError('trigger precisa ser MANUAL ou SCHEDULED.');
  }
  if (!Number.isInteger(staleAfterMs) || staleAfterMs <= 0) {
    throw new TypeError('staleAfterMs precisa ser um inteiro positivo.');
  }

  // Fast path: corrida in-process impossível (set síncrono, antes do 1º await).
  if (cycleInFlight) {
    throw new HttpError(409, MONITORING_CONCURRENCY_ERROR);
  }

  cycleInFlight = true;

  try {
    // Resiliência: uma execução anterior cujo processo morreu não pode
    // bloquear o índice parcial para sempre. Heartbeat recente nunca é tocado.
    await recoverStaleMonitoringRuns({ staleAfterMs });

    const resolvedTrips = trips === undefined ? await listTrips() : trips;

    // Árbitro: a linha RUNNING é a posse. P2002 do índice parcial → 409.
    let run;
    try {
      run = await prisma.monitoringRun.create({
        data: { status: MONITORING_RUN_STATUS.RUNNING, trigger, items: [] },
      });
    } catch (error) {
      if (isSingleRunningConflict(error)) {
        throw new HttpError(409, MONITORING_CONCURRENCY_ERROR);
      }
      throw error;
    }

    const startWall = Date.now();

    // Renova o heartbeat antes e depois de cada trabalho externo. É
    // best-effort: uma falha isolada aqui não transforma o ciclo em falha;
    // o UPDATE final condicionado a RUNNING decide a posse.
    const touchHeartbeat = async () => {
      try {
        await prisma.monitoringRun.updateMany({
          where: { id: run.id, status: MONITORING_RUN_STATUS.RUNNING },
          data: { heartbeatAt: new Date() },
        });
      } catch {
        // melhor esforço: o desfecho protegido abaixo continua sendo a verdade
      }
    };

    const withHeartbeat = (operation) => async (tripId) => {
      await touchHeartbeat();
      const result = await operation(tripId);
      await touchHeartbeat();
      return result;
    };

    let report;
    try {
      report = await runMonitoringCycle({
        trips: resolvedTrips,
        search: withHeartbeat(search),
        opportunities: withHeartbeat(opportunities),
        now,
      });
    } catch (cycleError) {
      // Falha GLOBAL: finaliza a linha como FAILED. O UPDATE é condicional a
      // RUNNING: se a execução já foi recuperada como órfã, o FAILED original
      // não é reescrito. Falha de UPDATE (banco já em problema) é engolida
      // para preservar o erro original do ciclo.
      try {
        await prisma.monitoringRun.updateMany({
          where: { id: run.id, status: MONITORING_RUN_STATUS.RUNNING },
          data: {
            status: MONITORING_RUN_STATUS.FAILED,
            finishedAt: new Date(),
            durationMs: Date.now() - startWall,
            failureReason: messageOf(cycleError),
          },
        });
      } catch {
        // engolido de propósito: erro original tem prioridade
      }
      throw cycleError;
    }

    const finalized = await prisma.monitoringRun.updateMany({
      where: { id: run.id, status: MONITORING_RUN_STATUS.RUNNING },
      data: {
        status: MONITORING_RUN_STATUS.COMPLETED,
        finishedAt: new Date(),
        durationMs: Date.now() - startWall,
        tripCount: report.tripCount,
        monitorableCount: report.monitorableCount,
        skippedCount: report.skippedCount,
        okCount: report.okCount,
        failedCount: report.failedCount,
        opportunityCount: report.opportunityCount,
        items: report.items,
      },
    });

    if (finalized.count !== 1) {
      // Outro processo recuperou esta execução enquanto este ciclo atrasado
      // ainda trabalhava. NUNCA sobrescrever o FAILED de recuperação.
      throw new HttpError(409, LEASE_LOST_ERROR);
    }

    const persisted = await prisma.monitoringRun.findUnique({ where: { id: run.id } });
    if (!persisted) {
      throw new Error('execução de monitoramento desapareceu após a finalização.');
    }

    return toRunView(persisted);
  } finally {
    cycleInFlight = false;
  }
}
