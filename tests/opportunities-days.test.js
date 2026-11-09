// Testes unitários da redução de dias distintos do módulo de oportunidades.
// Sem banco: a função é pura e espelha a seleção do núcleo do Dia 9
// (linhas válidas, atual = última cronológica, histórico = tudo menos ela).

import test from 'node:test';
import assert from 'node:assert/strict';

import { distinctDaysBeforeCurrent } from '../apps/api/src/modules/opportunities/opportunities.service.js';

const D1 = '2027-05-02T12:00:00.000Z';
const D2 = '2027-05-03T12:00:00.000Z';
const D3 = '2027-05-04T12:00:00.000Z';

function observation(total, currency, observedAt) {
  return { total, currency, observedAt };
}

test('conta dias distintos das observacoes ANTERIORES a ultima valida', () => {
  // current = D3 (última válida); histórico = D1, D1, D2 -> 2 dias distintos.
  const days = distinctDaysBeforeCurrent([
    observation(1000, 'BRL', D2),
    observation(1000, 'BRL', D1),
    observation(1000, 'BRL', D1),
    observation(900, 'BRL', D3),
  ]);

  assert.equal(days, 2);
});

test('regressao: linha final invalida nao conta o dia do current como historico', () => {
  // Antes da correção, o service descartava "a última linha bruta" e as linhas
  // D1 e D2 (o current eleito pelo núcleo) entravam como histórico -> 2 dias
  // distintos com histórico real de apenas 1 dia (D1).
  const days = distinctDaysBeforeCurrent([
    observation(1000, 'BRL', D1),
    observation(900, 'BRL', D2),
    observation(0, 'BRL', D3), // inválida: total non número utilizável
  ]);

  assert.equal(days, 1);
});

test('linhas inutilizaveis sao descartadas antes de eleger o current', () => {
  // total zero e moeda vazia não são válidas no núcleo: o current é a última
  // linha VÁLIDA (D2), e o histórico reduzido é só D1.
  const days = distinctDaysBeforeCurrent([
    observation(1000, 'BRL', D1),
    observation(0, 'BRL', D2),
    observation(900, '', D1),
    observation(900, 'BRL', D2),
  ]);

  assert.equal(days, 1);
});

test('entrada nula, vazia ou sem historico resulta em zero dias', () => {
  assert.equal(distinctDaysBeforeCurrent(null), 0);
  assert.equal(distinctDaysBeforeCurrent([]), 0);
  assert.equal(distinctDaysBeforeCurrent([observation(1000, 'BRL', D1)]), 0);
  assert.equal(distinctDaysBeforeCurrent([observation(null, 'BRL', D1)]), 0);
});

test('observedAt invalido em qualquer posicao nao gera dia e nem desloca o current', () => {
  // "nao-e-data" e "2027-13-45" são inválidas; a série válida é [D1, D2] ->
  // current = D2, histórico = D1 -> 1 dia.
  const days = distinctDaysBeforeCurrent([
    observation(1000, 'BRL', 'nao-e-data'),
    observation(1000, 'BRL', D1),
    observation(900, 'BRL', '2027-13-45T00:00:00.000Z'),
    observation(900, 'BRL', D2),
  ]);

  assert.equal(days, 1);
});
