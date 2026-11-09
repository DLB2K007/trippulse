-- CreateTable
CREATE TABLE "monitoring_runs" (
    "id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "trip_count" INTEGER NOT NULL DEFAULT 0,
    "monitorable_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "ok_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "opportunity_count" INTEGER NOT NULL DEFAULT 0,
    "items" JSONB NOT NULL,

    CONSTRAINT "monitoring_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "monitoring_runs_started_at_idx" ON "monitoring_runs"("started_at");

-- Árbitro de concorrência entre processos (Dia 11.3): no máximo UMA execução
-- aberta no banco inteiro — lock in-process cobre o mesmo processo; este
-- índice parcial único cobre workers/processos diferentes. O service converte
-- a violação (P2002 conferindo o NOME EXATO deste índice — no Prisma 7 +
-- adapter-pg: meta.driverAdapterError.cause.constraint.index) em HTTP 409.
CREATE UNIQUE INDEX "monitoring_runs_one_running_key" ON "monitoring_runs"("status") WHERE "status" = 'RUNNING';
