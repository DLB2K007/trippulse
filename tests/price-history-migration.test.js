// Testes de contrato da sexta migration (Dia 11.9), isolados em um schema
// temporário. Não tocam no schema public: cada cenário cria e remove seu próprio
// schema.
//
// ISOLAMENTO OBRIGATÓRIO (fechamento do Dia 11.9): a conexão usa EXCLUSIVAMENTE
// `TEST_DATABASE_URL` (banco descartável explicitamente nomeado como teste).
// Não há fallback para `DATABASE_URL`, a validação roda antes de qualquer
// conexão e o banco de desenvolvimento nunca é aceito — ver
// `tests/helpers/test-database-url.js`.
//
// O teste executa o SQL versionado da migration diretamente (via pg), o que
// valida o backfill, o setval, a nulabilidade e a atomicidade independentemente
// do runner do Prisma. A aplicação pelo runner é validada separadamente com
// `prisma migrate deploy` no banco vazio.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import pg from 'pg';

import { resolveTestDatabaseUrl } from './helpers/test-database-url.js';

const { Client } = pg;

// Resolvido no carregamento do módulo: sem TEST_DATABASE_URL (ou com destino
// inadequado) o arquivo falha ANTES de criar qualquer client.
const TEST_DATABASE_URL = resolveTestDatabaseUrl();

const MIGRATION_PATH = new URL(
  '../prisma/migrations/20261112000000_add_price_history_sequence_and_optional_breakdown/migration.sql',
  import.meta.url
);

const OLD_TABLE_SQL = `
  CREATE TABLE "price_history" (
    "id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "currency" TEXT NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "base" DOUBLE PRECISION NOT NULL,
    "taxes" DOUBLE PRECISION NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "price_history_pkey" PRIMARY KEY ("id")
  );
  CREATE INDEX "price_history_offer_id_observed_at_idx"
    ON "price_history"("offer_id", "observed_at");
`;

const OFFER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OFFER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function schemaName(prefix) {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

async function openSchema(prefix) {
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();

  const schema = schemaName(prefix);
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);

  return { client, schema };
}

async function closeSchema({ client, schema }) {
  try {
    await client.query('ROLLBACK');
  } catch {
    // A conexão pode já estar fora de transação; o cleanup abaixo é o que importa.
  }

  try {
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    await client.end();
  }
}

async function readColumn(client, schema, columnName) {
  const { rows } = await client.query(
    `SELECT is_nullable, data_type, column_default
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'price_history' AND column_name = $2`,
    [schema, columnName]
  );

  return rows[0];
}

async function readIndexes(client, schema) {
  const { rows } = await client.query(
    `SELECT indexname FROM pg_indexes
      WHERE schemaname = $1 AND tablename = 'price_history'
      ORDER BY indexname`,
    [schema]
  );

  return rows.map((row) => row.indexname);
}

async function readOwnedSequence(client, schema) {
  const { rows } = await client.query(
    'SELECT pg_get_serial_sequence($1, $2) AS owned_sequence',
    [`${schema}.price_history`, 'sequence']
  );

  return rows[0]?.owned_sequence ?? null;
}

async function sequenceExists(client, schema) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS total
       FROM pg_sequences
      WHERE schemaname = $1 AND sequencename = 'price_history_sequence_seq'`,
    [schema]
  );

  return rows[0].total;
}

test('migration em banco vazio: sequence inicia em 1, base/taxes aceitam NULL e índices são trocados', async () => {
  const migrationSql = await readFile(MIGRATION_PATH, 'utf8');
  const context = await openSchema('migration_empty');

  try {
    const { client, schema } = context;
    await client.query(OLD_TABLE_SQL);
    await client.query(migrationSql);

    const sequence = await readColumn(client, schema, 'sequence');
    assert.equal(sequence.data_type, 'bigint');
    assert.equal(sequence.is_nullable, 'NO');
    assert.match(sequence.column_default, /nextval/);
    assert.match(sequence.column_default, /price_history_sequence_seq/);
    assert.equal(await readOwnedSequence(client, schema), `${schema}.price_history_sequence_seq`);
    assert.equal(await sequenceExists(client, schema), 1);

    assert.equal((await readColumn(client, schema, 'base')).is_nullable, 'YES');
    assert.equal((await readColumn(client, schema, 'taxes')).is_nullable, 'YES');
    assert.equal((await readColumn(client, schema, 'total')).is_nullable, 'NO');

    const inserted = await client.query(
      `INSERT INTO "price_history" ("id", "offer_id", "currency", "total", "base", "taxes", "observed_at")
       VALUES ('00000000-0000-4000-8000-000000000001', $1, 'BRL', 1000, NULL, NULL, '2027-01-01T10:00:00')
       RETURNING "sequence"::text, "base", "taxes"`,
      [OFFER_A]
    );

    assert.equal(inserted.rows[0].sequence, '1');
    assert.equal(inserted.rows[0].base, null);
    assert.equal(inserted.rows[0].taxes, null);

    const indexes = await readIndexes(client, schema);
    assert.ok(indexes.includes('price_history_offer_id_observed_at_sequence_idx'));
    assert.ok(indexes.includes('price_history_sequence_key'));
    assert.equal(indexes.includes('price_history_offer_id_observed_at_idx'), false);
  } finally {
    await closeSchema(context);
  }
});

test('migration em banco populado: backfill determinístico, unicidade e próxima inserção acima do máximo', async () => {
  const migrationSql = await readFile(MIGRATION_PATH, 'utf8');
  const context = await openSchema('migration_populated');

  try {
    const { client, schema } = context;
    await client.query(OLD_TABLE_SQL);

    const rows = [
      ['00000000-0000-4000-8000-000000000004', OFFER_B, 400, 300, 100, '2027-01-01T10:00:00'],
      ['00000000-0000-4000-8000-000000000002', OFFER_A, 200, 150, 50, '2027-01-02T10:00:00'],
      ['00000000-0000-4000-8000-000000000001', OFFER_A, 100, 80, 20, '2027-01-01T10:00:00'],
      ['00000000-0000-4000-8000-000000000003', OFFER_A, 300, 250, 50, '2027-01-01T10:00:00'],
    ];

    for (const row of rows) {
      await client.query(
        `INSERT INTO "price_history" ("id", "offer_id", "currency", "total", "base", "taxes", "observed_at")
         VALUES ($1, $2, 'BRL', $3, $4, $5, $6)`,
        row
      );
    }

    await client.query(migrationSql);

    const backfill = await client.query(
      `SELECT "id"::text, "sequence"::text, "total", "base", "taxes"
         FROM "price_history"
        ORDER BY "sequence"`
    );

    assert.deepEqual(
      backfill.rows.map((row) => ({
        id: row.id,
        sequence: row.sequence,
        total: row.total,
        base: row.base,
        taxes: row.taxes,
      })),
      [
        { id: '00000000-0000-4000-8000-000000000001', sequence: '1', total: 100, base: 80, taxes: 20 },
        { id: '00000000-0000-4000-8000-000000000003', sequence: '2', total: 300, base: 250, taxes: 50 },
        { id: '00000000-0000-4000-8000-000000000002', sequence: '3', total: 200, base: 150, taxes: 50 },
        { id: '00000000-0000-4000-8000-000000000004', sequence: '4', total: 400, base: 300, taxes: 100 },
      ]
    );

    const inserted = await client.query(
      `INSERT INTO "price_history" ("id", "offer_id", "currency", "total", "base", "taxes", "observed_at")
       VALUES ('00000000-0000-4000-8000-000000000005', $1, 'BRL', 500, NULL, NULL, '2027-01-03T10:00:00')
       RETURNING "sequence"::text, "base", "taxes"`,
      [OFFER_A]
    );

    assert.equal(inserted.rows[0].sequence, '5');
    assert.equal(inserted.rows[0].base, null);
    assert.equal(inserted.rows[0].taxes, null);

    const unique = await client.query(
      `SELECT COUNT(*)::int AS total, COUNT(DISTINCT "sequence")::int AS distinct_sequences
         FROM "price_history"`
    );
    assert.equal(unique.rows[0].total, 5);
    assert.equal(unique.rows[0].distinct_sequences, 5);

    assert.equal((await readColumn(client, schema, 'sequence')).is_nullable, 'NO');
    assert.match((await readColumn(client, schema, 'sequence')).column_default, /price_history_sequence_seq/);
    assert.equal(await readOwnedSequence(client, schema), `${schema}.price_history_sequence_seq`);
    assert.equal(await sequenceExists(client, schema), 1);
  } finally {
    await closeSchema(context);
  }
});

test('migration é atômica: falha antes do COMMIT desfaz backfill, coluna e troca de índices', async () => {
  const migrationSql = await readFile(MIGRATION_PATH, 'utf8');
  const brokenSql = migrationSql.replace('COMMIT;', 'SELECT 1 / 0;\n\nCOMMIT;');
  const context = await openSchema('migration_atomic');

  try {
    const { client, schema } = context;
    await client.query(OLD_TABLE_SQL);
    await client.query(
      `INSERT INTO "price_history" ("id", "offer_id", "currency", "total", "base", "taxes", "observed_at")
       VALUES
         ('00000000-0000-4000-8000-000000000001', $1, 'BRL', 1000, 800, 200, '2027-01-01T10:00:00'),
         ('00000000-0000-4000-8000-000000000002', $1, 'BRL', 1250.5, 1000.5, 250, '2027-01-02T10:00:00'),
         ('00000000-0000-4000-8000-000000000003', $2, 'USD', 999.99, 799.99, 200, '2027-01-03T10:00:00')`,
      [OFFER_A, OFFER_B]
    );

    // Estado de DADOS antes da falha: quantidade, IDs e valores monetários.
    const dataSnapshotSql = `SELECT "id"::text AS id, "total", "base", "taxes"
                               FROM "price_history" ORDER BY "id"`;
    const before = (await client.query(dataSnapshotSql)).rows;
    assert.equal(before.length, 3, 'pré-condição: três linhas antes da migration');

    await assert.rejects(() => client.query(brokenSql));
    await client.query('ROLLBACK');

    // Atomicidade de DADOS: mesmas linhas, mesmos IDs, mesmos valores e
    // nenhuma inserção/remoção parcial.
    const after = (await client.query(dataSnapshotSql)).rows;
    assert.equal(after.length, before.length, 'nenhuma linha inserida ou removida parcialmente');
    assert.deepEqual(after, before, 'IDs e valores de total/base/taxes idênticos após o rollback');

    const columns = await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'price_history' AND column_name = 'sequence'`,
      [schema]
    );
    assert.equal(columns.rowCount, 0);
    assert.equal((await readColumn(client, schema, 'base')).is_nullable, 'NO');
    assert.equal((await readColumn(client, schema, 'taxes')).is_nullable, 'NO');
    assert.equal((await readColumn(client, schema, 'total')).is_nullable, 'NO');
    assert.equal(await sequenceExists(client, schema), 0);

    const indexes = await readIndexes(client, schema);
    assert.ok(indexes.includes('price_history_offer_id_observed_at_idx'));
    assert.equal(indexes.includes('price_history_offer_id_observed_at_sequence_idx'), false);
    assert.equal(indexes.includes('price_history_sequence_key'), false);
  } finally {
    await closeSchema(context);
  }
});
