// Agendador automático do ciclo de monitoramento (Dia 11.4 — Fase A).
//
// Responsabilidade ÚNICA: decidir QUANDO disparar. Nenhuma regra de negócio
// mora aqui — cada tick reutiliza integralmente o service do Dia 11.3
// (startMonitoringRun), que por sua vez delega ao núcleo puro do 11.1 e à
// persistência com árbitro do banco. O scheduler não acessa Prisma: reutiliza
// o service (que concentra a persistência) sem consultar o banco diretamente.
//
// FORMA DE AGENDAMENTO — after-complete loop (jamais setInterval):
//   agenda tick no intervalo → tick executa run() → SÓ DEPOIS do desfecho
//   agenda o próximo. Por construção, um ciclo lento nunca é sobreposto pelo
//   próprio scheduler: o tempo real entre ciclos = duração do ciclo +
//   intervalo. Sobreposição cruzada (outro processo) segue sendo barreira do
//   árbitro do banco (409 → skip, abaixo).
//
// CICLO DE VIDA (decisões aprovadas):
//   - D1: o 1º ciclo acontece só após o intervalo completo — deploy não deve
//     disparar ciclo no boot;
//   - desativado por padrão: quem decide ligar é loadEnv() (env.js), e o
//     wiring ao bootstrap pertence à Fase B (server.js) — AQUI não existe
//     efeito colateral no import além do factory;
//   - start()/stop() idempotentes: no máximo um timer e uma cadeia por
//     instância (prevenção de timers duplicados e de ciclos sobrepostos);
//   - stop() durante ciclo em voo: NÃO aborta o run (o finally do service
//     finaliza a linha no banco); apenas impede o reagendamento;
//   - start() DURANTE ciclo em voo (stop → start): a cadeia que já existe é a
//     única e reagenda sozinha no finally; nenhum timer novo nasce aqui
//     (Fase B.1 — antes, isso duplicava a cadeia e o stop() passava a
//     conhecer apenas o último handle).

import { startMonitoringRun, MONITORING_RUN_TRIGGER } from './monitoring.service.js';
import { HttpError } from '../../shared/errors.js';

const MIN_INTERVAL_MS = 60000; // 1 minuto (espelha env.js — barreira defensiva)
const MAX_INTERVAL_MS = 86400000; // 24 horas

/**
 * Tick padrão: reutiliza o service existente com trigger SCHEDULED.
 * Exportado para testes de integração (o trigger é decisão do agendador).
 *
 * @returns {Promise<object>} registro persistido (contrato do Dia 11.3)
 */
export function defaultScheduledRun() {
  return startMonitoringRun({ trigger: MONITORING_RUN_TRIGGER.SCHEDULED });
}

/**
 * Cria o agendador. Nada roda no import e nada roda no create — só start().
 *
 * @param {object} options
 * @param {number} options.intervalMs intervalo entre tentativas (1 min–24 h).
 *   A fonte oficial é loadEnv() (fail-fast lá); aqui há a mesma validação
 *   como barreira defensiva contra uso direto do factory com valor ruim.
 * @param {() => Promise<object>} [options.run] execução do ciclo (default:
 *   `defaultScheduledRun`). Injetável para testes determinísticos e para um
 *   futuro executor distribuído.
 * @param {{ schedule: (fn, delay) => object, clear: (handle) => void }} [options.timers]
 *   relógio injetável (default: setTimeout/clearTimeout globais).
 * @param {{ info: Function, warn: Function, error: Function }} [options.log]
 *   logger injetável (default: console).
 * @returns {{ start: () => void, stop: () => void, isRunning: () => boolean, idle: () => Promise<void> }}
 */
export function createMonitoringScheduler({ intervalMs, run = defaultScheduledRun, timers, log } = {}) {
  if (
    !Number.isInteger(intervalMs) ||
    intervalMs < MIN_INTERVAL_MS ||
    intervalMs > MAX_INTERVAL_MS
  ) {
    throw new TypeError(
      `intervalMs de agendamento inválido: é obrigatório um inteiro entre ${MIN_INTERVAL_MS} e ${MAX_INTERVAL_MS} ms.`
    );
  }

  const schedule = timers?.schedule ?? ((fn, delay) => setTimeout(fn, delay));
  const clear = timers?.clear ?? ((handle) => clearTimeout(handle));
  const logger = log ?? console;

  if (typeof run !== 'function') {
    throw new TypeError('run precisa ser uma função que executa o ciclo.');
  }

  // `active` é a verdade sobre o agendador ligado; `handle` guarda o ÚNICO
  // timer pendente (null = nenhum tick agendado agora). `inFlight` existe do
  // início ao desfecho completo do tick corrente (inclusive o reagendamento do
  // finally) e é a base do `idle()` usado pelo encerramento gracioso da Fase B.
  let active = false;
  let handle = null;
  let inFlight = null;
  // Verdade sobre "existe ciclo em curso AGORA". Separada de `inFlight`
  // (promessa para o idle) porque um tick pode falhar ANTES do primeiro await
  // e terminar de forma síncrona, antes da atribuição de `inFlight`.
  let cycleRunning = false;
  let tickCount = 0;

  function scheduleNext() {
    handle = schedule(() => {
      // Tick disparou: o handle é consumido; o próximo só nasce no finally.
      handle = null;
      cycleRunning = true;
      const running = tick();
      // tick() captura os erros do ciclo; esta cadeia única cobre a falha
      // CATASTRÓFICA externa (logger/timers quebrados): `catch` impede
      // unhandledRejection e `idle()` nunca rejeita — o shutdown sempre
      // consegue prosseguir para o close. `inFlight` é limpo no finally do
      // PRÓPRIO tick (mesmo turno síncrono), para não existir janela entre o
      // fim da decisão de reagendar e a limpeza (ver start()).
      inFlight = running.catch(() => {});
    }, intervalMs);
  }

  async function tick() {
    tickCount += 1;

    try {
      // Requisito de log da Fase B: ciclo agendado INICIADO (um por ciclo;
      // junto com o "concluído" abaixo são as 2 únicas linhas de sucesso).
      // DENTRO do try: falha de logger não pode pular o finally e matar a
      // cadeia (Fase B.1 — L1).
      logger.info('execução agendada iniciada.');
      const outcome = await run();
      logger.info(
        `ciclo agendado concluído (status=${outcome?.status ?? 'n.d.'}, runId=${outcome?.runId ?? 'n.d.'})`
      );
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 409) {
        // Conflito esperado: ciclo manual (ou de outra instância) em curso.
        // SKIP secamente — log .info, sem stack, sem alarme.
        logger.info('execução agendada ignorada: já existe um ciclo em andamento (409).');
      } else {
        // Qualquer outro erro NÃO pode derrubar o agendador nem virar
        // unhandledRejection: registra e garante o reagendamento no finally.
        logger.error(`ciclo agendado falhou: ${error instanceof Error ? error.message : error}`);
      }
    } finally {
      // After-complete: reagenda SOMENTE se continuarmos ativos (stop() durante
      // um ciclo em voo encerra a cadeia sem interromper o run).
      if (active) {
        scheduleNext();
      }
      // A decisão acima e esta limpeza acontecem no MESMO turno síncrono: um
      // start() nunca observa um ciclo "meio resolvido" e a cadeia não morre
      // silenciosamente (Fase B.1 — M1).
      cycleRunning = false;
      inFlight = null;
    }
  }

  return {
    start() {
      if (active) {
        logger.warn('agendador já está ativo: start() ignorado (um único timer por instância).');
        return;
      }

      active = true;

      // Fase B.1 (M1): restart com ciclo em voo. Um timer novo aqui criaria
      // uma SEGUNDA cadeia (o finally do tick antigo também reagenda) e o
      // stop() passaria a cancelar só o handle mais recente. A cadeia em voo
      // é a única e reagenda uma vez no próprio finally.
      if (cycleRunning) {
        logger.info(
          'agendador reativado com ciclo em voo: o reagendamento acontece no desfecho do ciclo (um único timer).'
        );
        return;
      }

      scheduleNext(); // D1: primeiro ciclo após o intervalo completo.
      logger.info(`agendador de monitoramento ativo (intervalo: ${intervalMs} ms; 1º ciclo após o intervalo).`);
    },

    stop() {
      if (!active && handle === null) {
        return; // idempotente
      }

      if (handle !== null) {
        clear(handle);
        handle = null;
      }

      active = false;
      logger.info('agendador de monitoramento desativado (ciclo em voo, se houver, será concluído).');
    },

    isRunning() {
      return active;
    },

    /**
     * Resolve quando NÃO há mais ciclo em voo (Fase B — encerramento gracioso).
     * Sem tick corrente: já resolve. Com ciclo em andamento: resolve quando
     * ele TERMINA (o stop() não aborta o run — o shutdown aguarda aqui).
     *
     * @returns {Promise<void>}
     */
    idle() {
      return inFlight ?? Promise.resolve();
    },

    /** Para diagnóstico/testes: quantos ticks dispararam nesta instância. */
    ticks() {
      return tickCount;
    },
  };
}
