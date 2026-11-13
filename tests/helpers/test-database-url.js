// Resolve a URL do PostgreSQL DESCARTÁVEL usado pelos testes da migration.
//
// Regras (fechamento do Dia 11.9):
// - variável EXCLUSIVA `TEST_DATABASE_URL`; não existe fallback para
//   `DATABASE_URL` nem para o banco de desenvolvimento;
// - a validação roda antes de qualquer `new Client(...)`/conexão;
// - URL igual (mesmo host + mesmo banco) à `DATABASE_URL` da aplicação é
//   rejeitada;
// - o nome do banco precisa ser identificado como teste (conter "test");
// - mensagens de erro nunca incluem usuário, senha ou a URL completa. Apenas
//   o nome do banco/protocolo é citado, para diagnóstico.

const TEST_DATABASE_NAME_PATTERN = /test/i;

function databaseNameOf(url) {
  return decodeURIComponent(url.pathname.replace(/^\//, ''));
}

function parseOrNull(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function sameTarget(appUrl, testUrl) {
  return (
    appUrl.host === testUrl.host &&
    databaseNameOf(appUrl) === databaseNameOf(testUrl)
  );
}

export function resolveTestDatabaseUrl(env = process.env) {
  const raw = env.TEST_DATABASE_URL;

  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error(
      'TEST_DATABASE_URL não está definida: o teste de migration exige um ' +
        'PostgreSQL descartável explícito (ex.: ' +
        'postgresql://usuario:senha@127.0.0.1:5544/trippulse_test_migration). ' +
        'DATABASE_URL nunca é usada como fallback.'
    );
  }

  const value = raw.trim();
  const parsed = parseOrNull(value);

  if (!parsed) {
    throw new Error(
      'TEST_DATABASE_URL inválida: o valor não é uma URL válida (conteúdo omitido por segurança).'
    );
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error(
      `TEST_DATABASE_URL precisa usar postgresql://; protocolo recebido: "${parsed.protocol}" (URL omitida).`
    );
  }

  const databaseName = databaseNameOf(parsed);

  if (!databaseName) {
    throw new Error(
      'TEST_DATABASE_URL sem nome de banco: informe um banco explicitamente identificado como teste.'
    );
  }

  if (!TEST_DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error(
      `Banco "${databaseName}" não é identificado como teste: o nome precisa conter "test" ` +
        '(ex.: trippulse_test_migration). O banco de desenvolvimento nunca é aceito.'
    );
  }

  const applicationUrl = typeof env.DATABASE_URL === 'string' ? parseOrNull(env.DATABASE_URL.trim()) : null;

  if (applicationUrl && sameTarget(applicationUrl, parsed)) {
    throw new Error(
      `TEST_DATABASE_URL aponta para o mesmo banco da aplicação ("${databaseName}"). ` +
        'Use um banco descartável separado — DATABASE_URL não é aceita como destino do teste.'
    );
  }

  return value;
}
