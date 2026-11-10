-- Heartbeat da execução: renovado durante o ciclo. Um RUNNING cujo processo
-- morreu deixa de renovar; a próxima execução o recupera como FAILED quando o
-- heartbeat expira, liberando o índice parcial único para um novo ciclo.
ALTER TABLE "monitoring_runs"
    ADD COLUMN "heartbeat_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "failure_reason" TEXT;

-- Backfill: linhas antigas passam a ter o heartbeat igual ao início. Isso é
-- conservador para qualquer RUNNING legado: ele só será recuperado após o
-- limiar de staleness, nunca imediatamente na migration.
UPDATE "monitoring_runs" SET "heartbeat_at" = "started_at";
