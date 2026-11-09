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
  };
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
} = {}) {
  // Validação ANTES do lock: erro de chamador não consume a vaga do ciclo.
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('now precisa ser um Date válido.');
  }
  if (!Object.values(MONITORING_RUN_TRIGGER).includes(trigger)) {
    throw new TypeError('trigger precisa ser MANUAL ou SCHEDULED.');
  }

  // Fast path: corrida in-process impossível (set síncrono, antes do 1º await).
  if (cycleInFlight) {
    throw new HttpError(409, MONITORING_CONCURRENCY_ERROR);
  }

  cycleInFlight = true;

  try {
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

    let report;
    try {
      report = await runMonitoringCycle({
        trips: resolvedTrips,
        search,
        opportunities,
        now,
      });
    } catch (cycleError) {
      // Falha GLOBAL: finaliza a linha como FAILED e nada mas nunca RUNNING
      // órfão. Falha de UPDATE aqui (banco já em problema) é engolida para
      // preservar o erro original do ciclo — risco documentado na entrega.
      try {
        await prisma.monitoringRun.update({
          where: { id: run.id },
          data: {
            status: MONITORING_RUN_STATUS.FAILED,
            finishedAt: new Date(),
            durationMs: Date.now() - startWall,
          },
        });
      } catch {
        // engolido de propósito: erro original tem prioridade
      }
      throw cycleError;
    }

    const persisted = await prisma.monitoringRun.update({
      where: { id: run.id },
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

    return toRunView(persisted);
  } finally {
    cycleInFlight = false;
  }
}
