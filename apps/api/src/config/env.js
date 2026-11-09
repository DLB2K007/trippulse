// Centraliza o acesso às variáveis de ambiente da API.
// Valores padrão permitem rodar o servidor sem arquivo .env.

// Agendador do monitoramento (Dia 11.4) — DESATIVADO por padrão.
// Decisões aprovadas: D2 (fail-fast na config usada), D4 (boolean estrito).
const SCHEDULER_MIN_INTERVAL_MS = 60000; // 1 minuto
const SCHEDULER_MAX_INTERVAL_MS = 86400000; // 24 horas
const SCHEDULER_DEFAULT_INTERVAL_MS = 900000; // 15 minutos

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

export function loadEnv() {
  const port = Number.parseInt(process.env.PORT ?? '', 10);

  return {
    host: process.env.HOST ?? '0.0.0.0',
    port: Number.isNaN(port) ? 3000 : port,
    monitoringScheduler: loadMonitoringSchedulerEnv(),
  };
}
