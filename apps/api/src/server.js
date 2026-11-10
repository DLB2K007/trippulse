// Bootstrap da API TripPulse — entrypoint real (`npm start` / `npm run dev`).
//
// Dia 11.4 — Fase B: wiring do agendador de monitoramento ao ciclo de vida do
// servidor. Regras aprovadas:
//   - OFF por padrão: quem decide ligar é loadEnv() (env.js); aqui só wiring;
//   - o agendador é criado com o LOGGER DO FASTIFY (logging consistente), mas
//     só fica ONLINE depois de `listen()` bem-sucedido — se a porta não abrir,
//     não há timers, nem handlers de sinal, nem scheduler em operação;
//   - D1: o primeiro ciclo acontece só após o intervalo completo (o factory
//     garante; o bootstrap apenas start() após o listen);
//   - SIGTERM/SIGINT executam encerramento gracioso IDEMPOTENTE:
//       scheduler.stop()  → timer pendente cancelado; nenhum ciclo NOVO;
//       scheduler.idle()  → ciclo EM VOO termina antes de fechar o servidor
//                           (nunca interrompido abruptamente), com timeout
//                           configurável para não reter o processo para sempre;
//       await app.close() → com tratamento de erro (falha no close não vira
//                           unhandledRejection e encerra com código 1);
//       terminate(0)      → saída limpa.
//     Sinais repetidos/simultâneos compartilham a MESMA promessa — nada roda
//     duas vezes, e os handlers são registrados EXATAMENTE UMA VEZ.
//
// `app.js`/buildApp permanecem intocados: os testes HTTP usam buildApp()
// diretamente e NUNCA ativam o scheduler. Todo o wiring é injetável via
// startServer(deps) para testes determinísticos; o bloco automático só roda
// quando server.js é o módulo principal do processo (nunca no import).

import { pathToFileURL } from 'node:url';
import { buildApp } from './app.js';
import { loadEnv, SHUTDOWN_TIMEOUT_DEFAULT_MS } from './config/env.js';
import { createMonitoringScheduler } from './modules/monitoring/scheduler.js';

/**
 * Aguarda o idle do scheduler com prazo. `false` significa que o ciclo em voo
 * não terminou a tempo; o chamador decide encerrar mesmo assim (o run NÃO é
 * abortado aqui). O timer é sempre limpo, inclusive quando o idle vence.
 *
 * @param {{ idle: () => Promise<void> }} scheduler
 * @param {number} timeoutMs
 * @returns {Promise<boolean>} true = idle concluído; false = timeout
 */
function waitForSchedulerIdle(scheduler, timeoutMs) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });

  const idle = Promise.resolve()
    .then(() => scheduler.idle())
    .then(() => true);

  return Promise.race([idle, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Sobe a API completa: Fastify + (opcionalmente) agendador de monitoramento.
 * Nenhum efeito colateral no import — só quando a função é chamada.
 *
 * @param {object} [deps] dependências injetáveis (default = produção real).
 * @param {object} [deps.env] config (default: loadEnv()).
 * @param {() => object} [deps.createApplication] factory do app Fastify
 *   (default: buildApp — INTOCADO).
 * @param {(options: { intervalMs: number, log: object }) => object} [deps.createScheduler]
 *   factory do agendador (default: createMonitoringScheduler).
 * @param {{ on: Function }} [deps.signals] fonte de sinais
 *   (default: process; EventEmitter injetável nos testes).
 * @param {(code: number) => void|never} [deps.terminate] encerramento do
 *   processo (default: process.exit; spy nos testes).
 * @returns {Promise<{ app: object, scheduler: object|null, address: string,
 *   shutdown: (signal?: string) => Promise<boolean> } | null>}
 *   handles do servidor, ou `null` se o listen falhar (scheduler nunca entra
 *   em operação; terminate(1) já foi acionado).
 */
export async function startServer({
  env = loadEnv(),
  createApplication = buildApp,
  createScheduler = createMonitoringScheduler,
  signals = process,
  terminate = (code) => process.exit(code),
} = {}) {
  // Config da Fase A: { enabled: boolean estrito, intervalMs com default }.
  // Lida ANTES de criar o app (Fase B.1 — L4): env estruturalmente inválido
  // falha alto sem deixar uma instância de Fastify aberta.
  const { enabled, intervalMs } = env.monitoringScheduler;
  const shutdownTimeoutMs = env.shutdownTimeoutMs ?? SHUTDOWN_TIMEOUT_DEFAULT_MS;

  if (!Number.isInteger(shutdownTimeoutMs) || shutdownTimeoutMs <= 0) {
    throw new TypeError('shutdownTimeoutMs precisa ser um inteiro positivo.');
  }

  const app = createApplication();
  let scheduler = null;

  // Promessa do encerramento corrente — a base da idempotência: sinais
  // repetidos devolvem ESTA promessa em vez de iniciar um novo shutdown.
  let shutdownInFlight = null;

  /**
   * Encerramento gracioso (SIGTERM/SIGINT; testes podem invocar direto).
   * Nunca rejeita: devolve `true` se fechou limpo, `false` se falhou.
   *
   * @param {string} [signal] nome do sinal para o log.
   * @returns {Promise<boolean>}
   */
  function gracefulShutdown(signal = 'SIGTERM') {
    if (shutdownInFlight) {
      return shutdownInFlight; // déjà em curso: MESMA promessa, zero efeito extra
    }

    shutdownInFlight = (async () => {
      try {
        app.log.info(`sinal ${signal} recebido: encerramento gracioso iniciado.`);

        if (scheduler) {
          // 1) corta a cadeia: cancela o timer pendente; a partir daqui
          //    nenhum ciclo NOVO é agendado (o factory também re-checa).
          scheduler.stop();
          // 2) ciclo EM VOO: aguarda o desfecho completo (não aborta o run —
          //    o service finaliza a linha no banco) antes de fechar o app.
          //    O timeout evita que um ciclo travado retenha o processo; se
          //    expirar, seguimos para o close e o heartbeat permite a
          //    recuperação posterior da linha.
          const idleCompleted = await waitForSchedulerIdle(scheduler, shutdownTimeoutMs);
          if (!idleCompleted) {
            app.log.warn(
              `timeout de ${shutdownTimeoutMs} ms aguardando o ciclo em voo; encerrando sem aguardar o término.`
            );
          }
        }

        // 3) fecha Fastify (rotas/plugins/onClose inclusos). Erro aqui não
        //    pode mascarar o encerramento: log + código de saída 1.
        await app.close();
        app.log.info('shutdown concluído.');
        terminate(0);
        return true;
      } catch (error) {
        app.log.error(
          `falha durante o encerramento: ${error instanceof Error ? error.message : error}`
        );
        terminate(1);
        return false;
      }
    })();

    return shutdownInFlight;
  }

  let address;
  try {
    address = await app.listen({ host: env.host, port: env.port });
  } catch (error) {
    // Sem porta, sem servidor. Nenhum scheduler iniciado, nenhum handler
    // de sinal registrado; comportamento original preservado (exit 1).
    app.log.error(
      `listen() falhou: ${error instanceof Error ? error.message : error}`
    );
    terminate(1);
    return null;
  }

  // A partir daqui o servidor JÁ ESTÁ OUVINDO. Falha nesta fase (factory ou
  // start do agendador, registro de handlers) tem outro significado e outro
  // tratamento: fecha o app, cancela timer e sai 1 — nunca deixa porta ou
  // agendador abertos (Fase B.1 — L2).
  try {
    // SOMENTE aqui, com a porta confirmada, o agendador nasce e entra em
    // operação.
    if (enabled) {
      scheduler = createScheduler({ intervalMs, log: app.log });
      scheduler.start();
    }

    // Handlers de sinal registrados EXATAMENTE UMA VEZ por processo de
    // bootstrap — nunca em duplicidade, e só depois do listen bem-sucedido.
    signals.on('SIGTERM', () => {
      void gracefulShutdown('SIGTERM');
    });
    signals.on('SIGINT', () => {
      void gracefulShutdown('SIGINT');
    });

    return { app, scheduler, address, shutdown: gracefulShutdown };
  } catch (error) {
    app.log.error(
      `inicialização pós-listen falhou: ${error instanceof Error ? error.message : error}`
    );
    try {
      scheduler?.stop();
    } catch {
      // falha ao parar o agendador não pode impedir o fechamento do app
    }
    try {
      await app.close();
    } catch (closeError) {
      app.log.error(
        `falha ao fechar após erro de inicialização: ${
          closeError instanceof Error ? closeError.message : closeError
        }`
      );
    }
    terminate(1);
    return null;
  }
}

// Módulo principal: sobe a API de verdade (`node apps/api/src/server.js`).
// Importado por testes/módulos, este bloco NUNCA roda (o argv[1] não é este
// arquivo). Guarda extra: alguns contextos executam com argv[1] indefinido.
const isMainModule =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  startServer().catch((error) => {
    // Falha CATASTRÓFICA de bootstrap (ex.: fail-fast do loadEnv — D2):
    // loga no console (o app/logger pode nem existir) e sai com código 1.
    console.error('bootstrap da API falhou:', error);
    process.exit(1);
  });
}
