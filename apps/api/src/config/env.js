// Centraliza o acesso às variáveis de ambiente da API.
// Valores padrão permitem rodar o servidor sem arquivo .env.

// Agendador do monitoramento (Dia 11.4) — DESATIVADO por padrão.
// Decisões aprovadas: D2 (fail-fast na config usada), D4 (boolean estrito).
const SCHEDULER_MIN_INTERVAL_MS = 60000; // 1 minuto
const SCHEDULER_MAX_INTERVAL_MS = 86400000; // 24 horas
const SCHEDULER_DEFAULT_INTERVAL_MS = 900000; // 15 minutos

// Timeout do encerramento gracioso para aguardar o ciclo do scheduler em voo.
// Se expirar, o processo continua o shutdown sem abortar o ciclo; a
// recuperação por heartbeat cobre a linha que eventualmente ficar RUNNING.
const SHUTDOWN_TIMEOUT_MIN_MS = 1000;
const SHUTDOWN_TIMEOUT_MAX_MS = 60000;
export const SHUTDOWN_TIMEOUT_DEFAULT_MS = 10000;

// Estrito: apenas 'true'/'1' ativa (qualquer outro valor desativa).
const SCHEDULER_TRUTHY = new Set(['true', '1']);
// Valores que expressam desativação de propósito (não merecem warn).
const SCHEDULER_KNOWN_OFF = new Set(['', 'false', '0', 'off', 'no']);

function loadMonitoringSchedulerEnv() {
  const rawEnabled = process.env.MONITORING_SCHEDULER_ENABLED;
  const normalized = (rawEnabled ?? '').trim().toLowerCase();
  const enabled = SCHEDULER_TRUTHY.has(normalized);

  // D4: bool estrito. Valor NÃO reconhecido desativa E avisa — digitação
  // ('sim', 'yes', 'enabled') não deve virar silêncio de operação.
  if (
    rawEnabled !== undefined &&
    normalized !== '' &&
    !SCHEDULER_TRUTHY.has(normalized) &&
    !SCHEDULER_KNOWN_OFF.has(normalized)
  ) {
    console.warn(
      `MONITORING_SCHEDULER_ENABLED='${rawEnabled}' não reconhecido: scheduler DESATIVADO (aceitos apenas 'true' ou '1').`
    );
  }

  const rawIntervalText = process.env.MONITORING_SCHEDULER_INTERVAL_MS;
  const intervalProvided = rawIntervalText !== undefined;
  const intervalText = (rawIntervalText ?? '').trim();
  // Fase B.1 (M2): validação ESTRITA — só representação inteira decimal.
  // parseInt aceitava '60000abc', '60000.9' e '60000 0' como 60000, burlando
  // o fail-fast do D2 com a cadência errada em silêncio.
  const rawInterval = /^\d+$/.test(intervalText) ? Number(intervalText) : Number.NaN;
  const intervalIsValid = Number.isInteger(rawInterval) && rawInterval >= SCHEDULER_MIN_INTERVAL_MS && rawInterval <= SCHEDULER_MAX_INTERVAL_MS;

  // D2: valor PRESENTE e inválido só faila alto quando o operador realmente
  // pediu o scheduler — config errada não pode virar "scheduler
  // silenciosamente off" nem rodar ciclos a cada 1 ms. Intervalo AUSENTE não
  // é erro: usa o default. Com o scheduler OFF, qualquer invalidade é
  // ignorada (usa default) — o valor é irrelevante para a execução.
  if (enabled && intervalProvided && !intervalIsValid) {
    throw new TypeError(
      `MONITORING_SCHEDULER_INTERVAL_MS inválido: é obrigatório um inteiro entre ${SCHEDULER_MIN_INTERVAL_MS} e ${SCHEDULER_MAX_INTERVAL_MS} ms quando o agendador está ativo.`
    );
  }

  return {
    enabled,
    intervalMs: intervalIsValid ? rawInterval : SCHEDULER_DEFAULT_INTERVAL_MS,
  };
}

// Provedor experimental SerpApi (Dia 11.8) — DESATIVADO por padrão.
// Mesmo padrão de decisões do scheduler: D2 (fail-fast na config usada) e
// D4 (boolean estrito). Sem flag habilitada E sem chave, o provedor NÃO é
// registrado (a chave nunca entra no repositório).
const SERPAPI_MAX_EXPANSIONS_MIN = 1;
const SERPAPI_MAX_EXPANSIONS_MAX = 10;
const SERPAPI_MAX_EXPANSIONS_DEFAULT = 1;

function loadSerpApiEnv() {
  const rawEnabled = process.env.SERPAPI_ENABLED;
  const normalized = (rawEnabled ?? '').trim().toLowerCase();
  const enabled = SCHEDULER_TRUTHY.has(normalized);

  // D4: bool estrito com warn para valores não reconhecidos.
  if (
    rawEnabled !== undefined &&
    normalized !== '' &&
    !SCHEDULER_TRUTHY.has(normalized) &&
    !SCHEDULER_KNOWN_OFF.has(normalized)
  ) {
    console.warn(
      `SERPAPI_ENABLED='${rawEnabled}' não reconhecido: provedor SerpApi DESATIVADO (aceitos apenas 'true' ou '1').`
    );
  }

  const rawApiKey = process.env.SERPAPI_API_KEY ?? '';
  const apiKey = rawApiKey.trim();

  // Flag ligada sem chave: não é erro (a chave é opcional por desenho), mas
  // o provedor não será registrado — o operador precisa saber disso.
  if (enabled && apiKey === '') {
    console.warn(
      'SERPAPI_ENABLED ativo sem SERPAPI_API_KEY: o provedor SerpApi NÃO será registrado.'
    );
  }

  // Expansões: inteiro decimal estrito 1..10 (fórmula:
  // requisições/ciclo = 1 + tokens expandidos). Fail-fast só quando o
  // operador ligou o provedor E forneceu um valor inválido (D2).
  const rawMax = process.env.SERPAPI_MAX_OUTBOUND_EXPANSIONS;
  const maxProvided = rawMax !== undefined;
  const maxText = (rawMax ?? '').trim();
  const maxValue = /^\d+$/.test(maxText) ? Number(maxText) : Number.NaN;
  const maxIsValid =
    Number.isInteger(maxValue) && maxValue >= SERPAPI_MAX_EXPANSIONS_MIN && maxValue <= SERPAPI_MAX_EXPANSIONS_MAX;

  if (enabled && maxProvided && !maxIsValid) {
    throw new TypeError(
      `SERPAPI_MAX_OUTBOUND_EXPANSIONS inválido: é obrigatório um inteiro entre ${SERPAPI_MAX_EXPANSIONS_MIN} e ${SERPAPI_MAX_EXPANSIONS_MAX} quando o provedor SerpApi está ativo.`
    );
  }

  return {
    enabled,
    apiKey: apiKey === '' ? null : apiKey,
    maxOutboundExpansions: maxIsValid ? maxValue : SERPAPI_MAX_EXPANSIONS_DEFAULT,
  };
}

function loadShutdownTimeoutEnv() {
  const raw = process.env.SHUTDOWN_TIMEOUT_MS;
  const text = (raw ?? '').trim();

  if (text === '') {
    return SHUTDOWN_TIMEOUT_DEFAULT_MS;
  }

  const value = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isInteger(value) || value < SHUTDOWN_TIMEOUT_MIN_MS || value > SHUTDOWN_TIMEOUT_MAX_MS) {
    throw new TypeError(
      `SHUTDOWN_TIMEOUT_MS inválido: é obrigatório um inteiro entre ${SHUTDOWN_TIMEOUT_MIN_MS} e ${SHUTDOWN_TIMEOUT_MAX_MS} ms.`
    );
  }

  return value;
}

export function loadEnv() {
  const port = Number.parseInt(process.env.PORT ?? '', 10);

  return {
    host: process.env.HOST ?? '0.0.0.0',
    port: Number.isNaN(port) ? 3000 : port,
    shutdownTimeoutMs: loadShutdownTimeoutEnv(),
    monitoringScheduler: loadMonitoringSchedulerEnv(),
    serpapi: loadSerpApiEnv(),
  };
}
