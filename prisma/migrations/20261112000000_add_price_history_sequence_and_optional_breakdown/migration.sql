-- Dia 11.9: ordem canônica do histórico (observed_at ASC, sequence ASC) e
-- decomposição opcional de preço. A migration é atômica: todas as etapas,
-- incluindo o backfill e a troca de índices, commitam ou roll back juntas.
BEGIN;

-- Impede inserções concorrentes durante o backfill/estruturação. O ALTER TABLE
-- abaixo também adquiriria o lock, mas o pedido explícito documenta a intenção.
LOCK TABLE "price_history" IN ACCESS EXCLUSIVE MODE;

-- 1. Coluna nullable inicialmente: os registros existentes ainda não têm valor.
ALTER TABLE "price_history" ADD COLUMN "sequence" BIGINT;

-- 2. Sequência global (não um contador por oferta). O default será aplicado
-- somente depois do backfill, quando o contador já estiver posicionado.
CREATE SEQUENCE "price_history_sequence_seq"
  AS BIGINT
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

ALTER TABLE "price_history"
  ALTER COLUMN "sequence" SET DEFAULT nextval('"price_history_sequence_seq"'::regclass);

-- 3. Backfill determinístico dos registros históricos. A ordenação usa a
-- chave física da tabela como desempate final; a sequência resultante é única.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      ORDER BY "offer_id" ASC, "observed_at" ASC, "id" ASC
    ) AS "sequence"
  FROM "price_history"
)
UPDATE "price_history" AS history
SET "sequence" = ranked."sequence"
FROM ranked
WHERE history."id" = ranked."id";

-- 4. Inicializa o contador conforme o conteúdo real da tabela:
--    - vazia: próxima inserção recebe 1 (is_called = false);
--    - populada: próxima inserção recebe MAX(sequence) + 1 (is_called = true).
SELECT setval(
  '"price_history_sequence_seq"',
  COALESCE((SELECT MAX("sequence") FROM "price_history"), 1),
  EXISTS (SELECT 1 FROM "price_history")
);

-- 5. Garante o contrato: toda observação tem sequência e ela é única.
ALTER TABLE "price_history" ALTER COLUMN "sequence" SET NOT NULL;

-- 6. A sequência pertence à coluna (como em BIGSERIAL), evitando órfãos.
ALTER SEQUENCE "price_history_sequence_seq"
  OWNED BY "price_history"."sequence";

CREATE UNIQUE INDEX "price_history_sequence_key"
  ON "price_history"("sequence");

-- 7. Base e impostos podem não existir; total continua obrigatório.
ALTER TABLE "price_history" ALTER COLUMN "base" DROP NOT NULL;
ALTER TABLE "price_history" ALTER COLUMN "taxes" DROP NOT NULL;

-- 8. Índice canônico para leitura/ordenação por oferta e data, com sequence
-- como desempate. O índice antigo deixa de ser necessário.
CREATE INDEX "price_history_offer_id_observed_at_sequence_idx"
  ON "price_history"("offer_id", "observed_at", "sequence");

DROP INDEX "price_history_offer_id_observed_at_idx";

COMMIT;
