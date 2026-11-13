// Testes puros do resolvedor de TEST_DATABASE_URL (fechamento do Dia 11.9).
// Sem banco: a validação precisa acontecer ANTES de qualquer conexão.

import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveTestDatabaseUrl } from './helpers/test-database-url.js';

const APP_URL = 'postgresql://trippulse:trippulse@127.0.0.1:5433/trippulse?schema=public';
const TEST_URL = 'postgresql://trippulse:trippulse@127.0.0.1:5544/trippulse_test_migration?schema=public';

test('TEST_DATABASE_URL ausente falha antes de qualquer conexão', () => {
  assert.throws(
    () => resolveTestDatabaseUrl({ DATABASE_URL: APP_URL }),
    /TEST_DATABASE_URL não está definida/
  );
});

test('TEST_DATABASE_URL vazia ou só espaços também falha', () => {
  for (const value of ['', '   ']) {
    assert.throws(
      () => resolveTestDatabaseUrl({ TEST_DATABASE_URL: value }),
      /TEST_DATABASE_URL não está definida/
    );
  }
});

test('URL malformada é rejeitada sem ecoar o valor (nem credenciais)', () => {
  assert.throws(
    () => resolveTestDatabaseUrl({ TEST_DATABASE_URL: 'nao-e-url-senha-secreta' }),
    (error) => {
      assert.match(error.message, /não é uma URL válida/);
      assert.equal(error.message.includes('senha-secreta'), false);
      return true;
    }
  );
});

test('protocolo não suportado é rejeitado', () => {
  assert.throws(
    () => resolveTestDatabaseUrl({ TEST_DATABASE_URL: 'mysql://u:p@127.0.0.1:3306/trippulse_test' }),
    /precisa usar postgresql/
  );
});

test('URL sem nome de banco é rejeitada', () => {
  assert.throws(
    () => resolveTestDatabaseUrl({ TEST_DATABASE_URL: 'postgresql://u:p@127.0.0.1:5544/' }),
    /sem nome de banco/
  );
});

test('destino não identificado como teste é rejeitado (banco de desenvolvimento)', () => {
  assert.throws(
    () => resolveTestDatabaseUrl({ TEST_DATABASE_URL: 'postgresql://trippulse:trippulse@127.0.0.1:5433/trippulse' }),
    /não é identificado como teste/
  );
});

test('URL igual à DATABASE_URL da aplicação é rejeitada mesmo com nome de teste', () => {
  const sameTarget = 'postgresql://outro:segredo@127.0.0.1:5433/trippulse_test?schema=public';

  assert.throws(
    () =>
      resolveTestDatabaseUrl({
        DATABASE_URL: 'postgresql://trippulse:trippulse@127.0.0.1:5433/trippulse_test?schema=public',
        TEST_DATABASE_URL: sameTarget,
      }),
    (error) => {
      assert.match(error.message, /mesmo banco da aplicação/);
      assert.equal(error.message.includes('segredo'), false);
      return true;
    }
  );
});

test('banco de teste distinto e explicitamente nomeado é aceito', () => {
  assert.equal(
    resolveTestDatabaseUrl({ DATABASE_URL: APP_URL, TEST_DATABASE_URL: ` ${TEST_URL} ` }),
    TEST_URL
  );
});
