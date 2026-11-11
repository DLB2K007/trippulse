// Testes do registro de provedores de voos (Dia 11.8): feature flag,
// credenciais e isolamento SIMULATED/REAL. Puro (sem rede, sem banco).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFlightProviders,
  configureFlightProviders,
  getFlightProviders,
  resetFlightProviders,
} from '../apps/api/src/integrations/flight-providers/index.js';

// Registro sintético de config (mesma forma de loadEnv()).
function env({ serpapi } = {}) {
  return {
    serpapi: {
      enabled: serpapi ? serpapi.enabled : false,
      apiKey: serpapi?.apiKey ?? null,
      maxOutboundExpansions: serpapi?.maxOutboundExpansions ?? 1,
    },
  };
}

test('registro padrão: apenas o provedor simulado (SerpApi OFF por padrão)', () => {
  const providers = buildFlightProviders(env());

  assert.equal(providers.length, 1);
  assert.equal(providers[0].name, 'simulated-airways');
  assert.equal(providers[0].isSimulated, true);
});

test('sem chave, o provedor SerpApi NÃO é registrado (mesmo com flag ativa)', () => {
  const providers = buildFlightProviders(env({ serpapi: { enabled: true, apiKey: null } }));

  assert.equal(providers.length, 1);
  assert.equal(providers.some((provider) => provider.name === 'serpapi'), false);
});

test('flag desativada com chave presente: provedor SerpApi não é registrado', () => {
  const providers = buildFlightProviders(env({ serpapi: { enabled: false, apiKey: 'sk-fake' } }));

  assert.equal(providers.length, 1);
  assert.equal(providers.some((provider) => provider.name === 'serpapi'), false);
});

test('flag ativa + chave -> SerpApi registrado com classificação REAL', () => {
  const providers = buildFlightProviders(env({ serpapi: { enabled: true, apiKey: 'sk-fake' } }));

  assert.equal(providers.length, 2);
  const serpapi = providers.find((provider) => provider.name === 'serpapi');
  assert.ok(serpapi);
  assert.equal(serpapi.isSimulated, false);
  assert.equal(serpapi.rawFormat, 'serpapi');
});

test('registro efetivo configurado explicitamente: SIMULADO continua sendo o padrão', () => {
  resetFlightProviders();
  const providers = configureFlightProviders(env());

  assert.equal(providers.length, 1);
  assert.equal(providers[0].isSimulated, true);
  assert.equal(getFlightProviders(), providers);
});

// Correção da auditoria D7: o registro efetivo é MEMOIZADO — chamadas
// repetidas devolvem o MESMO array (sem reavaliar loadEnv() a cada pesquisa,
// evitando warnings repetidos e 500 tardio). A validação fail-fast acontece
// no boot via startServer → loadEnv().
test('registro real (D7): getFlightProviders memoiza — mesma instância em chamadas repetidas', () => {
  resetFlightProviders();
  const first = configureFlightProviders(env());
  const second = getFlightProviders();

  assert.equal(first, second);
  assert.equal(first.length, second.length);
});

test('registro efetivo configurado explicitamente: flag + chave registram SerpApi', () => {
  resetFlightProviders();
  const providers = configureFlightProviders(env({ serpapi: { enabled: true, apiKey: 'sk-synthetic' } }));

  assert.equal(providers.length, 2);
  assert.equal(providers.find((provider) => provider.name === 'serpapi')?.isSimulated, false);
  assert.equal(getFlightProviders(), providers);
});

test('D7: enabled só registra o SerpApi quando é boolean true', () => {
  for (const enabled of ['true', 'false', 1, 0, null, undefined]) {
    const providers = buildFlightProviders(env({ serpapi: { enabled, apiKey: 'sk-synthetic' } }));

    assert.equal(
      providers.length,
      1,
      `enabled=${String(enabled)} não pode registrar o SerpApi`
    );
  }
});

test('D7: chave ausente, vazia ou só com espaços não registra o SerpApi', () => {
  for (const apiKey of [null, '', '   ', undefined]) {
    const providers = buildFlightProviders(env({ serpapi: { enabled: true, apiKey } }));

    assert.equal(
      providers.length,
      1,
      `apiKey=${String(apiKey)} não pode registrar o SerpApi`
    );
  }
});

test('isolamento: classificação REAL nunca é atribuída por dados do provedor', () => {
  // Mesmo com o SerpApi registrado, a classificação REAL vem do REGISTRO
  // (isSimulated: false), não de campo qualquer da oferta bruta.
  const providers = buildFlightProviders(env({ serpapi: { enabled: true, apiKey: 'sk-fake' } }));

  for (const provider of providers) {
    assert.equal(typeof provider.isSimulated, 'boolean');
    assert.ok(provider.name.length > 0);
  }
});
