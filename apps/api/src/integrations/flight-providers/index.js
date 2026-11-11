// Registro de provedores de voos do TripPulse.
//
// Um provedor novo entra aqui e em nenhum outro lugar (services/rotas não
// conhecem provedores individuais): criar o diretório em flight-providers/ e
// registrar uma entrada abaixo, sem alterar services ou rotas.
//
// ISOLAMENTO SIMULATED/REAL (Dia 11.8):
// - O provedor SIMULADO é sempre registrado e é o padrão da plataforma.
// - O provedor SerpApi (EXPERIMENTAL, dados REAL) só é registrado com
//   SERPAPI_ENABLED ativo E SERPAPI_API_KEY presente — sem os dois, ele não
//   existe para a aplicação. Ofertas REAL continuam BLOQUEADAS de exposição/
//   persistência pela barreira em modules/flights/flights.service.js (503).

import { loadEnv } from '../../config/env.js';
import { simulatedFlightProvider } from './simulated/simulated-flight-provider.js';
import { createSerpApiFlightProvider } from './serpapi/serpapi-flight-provider.js';

// Constrói o registro a partir da config (injetável para testes).
export function buildFlightProviders(env = loadEnv()) {
  const providers = [simulatedFlightProvider];

  // Sem flag habilitada OU sem chave: o provedor real não participa do
  // registro ativo (regra do Dia 11.8).
  // A flag é estritamente booleana também na configuração injetada: string
  // 'false', 1, null ou ausente NUNCA habilitam o provedor real. A chave
  // precisa ser string não vazia após trim; qualquer outra forma mantém o
  // SerpApi desativado (o bootstrap já valida/warna o ambiente).
  const apiKey = env.serpapi?.apiKey;
  if (
    env.serpapi?.enabled === true &&
    typeof apiKey === 'string' &&
    apiKey.trim().length > 0
  ) {
    providers.push(
      createSerpApiFlightProvider({
        apiKey,
        maxOutboundExpansions: env.serpapi.maxOutboundExpansions,
      })
    );
  }

  return providers;
}

// Registro efetivo da aplicação (correção da auditoria D7): o registro é
// construído UMA VEZ e memoizado. Antes, cada pesquisa reexecutava
// buildFlightProviders() → loadEnv(), repetindo warnings de env inválido a
// cada requisição e deslocando erros de config para um HTTP 500 tardio.
// A validação fail-fast acontece no BOOT (startServer roda loadEnv() antes de
// servir); o cache evita reavaliações e mantém um único estado de registro.
// Nenhum estado global novo além deste memo; buildFlightProviders(env) segue
// injetável para os testes.
let cachedProviders = null;

/**
 * Configura o registro efetivo com um env já carregado/validado.
 *
 * O bootstrap usa esta função ANTES do `listen()` para evitar uma segunda
 * chamada a `loadEnv()` no primeiro uso (que duplicaria warnings) e impedir
 * que a porta seja aberta se a configuração falhar. Testes
 * também podem fornecer uma configuração explícita sem depender de
 * `process.env`.
 *
 * @param {object} env configuração no formato de `loadEnv()`
 * @returns {Array<object>} registro memoizado
 */
export function configureFlightProviders(env) {
  if (env === null || typeof env !== 'object') {
    throw new TypeError('configureFlightProviders exige um objeto de configuração.');
  }
  cachedProviders = buildFlightProviders(env);
  return cachedProviders;
}

/** Limpa o memo (isolamento de testes; não é usado em produção). */
export function resetFlightProviders() {
  cachedProviders = null;
}

export function getFlightProviders() {
  if (cachedProviders === null) {
    cachedProviders = buildFlightProviders();
  }
  return cachedProviders;
}
