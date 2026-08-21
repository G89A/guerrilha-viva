-- SPRINT 5 — fila de trabalho durável e vazão compartilhada.
--
-- Totalmente aditiva: duas tabelas novas, dois enums e colunas com valor
-- padrão. Nenhuma coluna ou tabela existente é removida ou alterada.

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'LEASED', 'DONE', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('CAMPAIGN_SEND');

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "failed_recipients" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sent_recipients" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "leased_by" TEXT,
    "leased_until" TIMESTAMP(3),
    "last_error" TEXT,
    "last_error_code" TEXT,
    "completed_at" TIMESTAMP(3),
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "key" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "tokens" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "refilled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rate_per_second" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "burst" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "jobs_idempotency_key_key" ON "jobs"("idempotency_key");

-- CreateIndex
CREATE INDEX "jobs_status_run_at_priority_idx" ON "jobs"("status", "run_at", "priority");

-- CreateIndex
CREATE INDEX "jobs_workspace_id_status_idx" ON "jobs"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "jobs_leased_until_idx" ON "jobs"("leased_until");

-- CreateIndex
CREATE INDEX "rate_limit_buckets_workspace_id_idx" ON "rate_limit_buckets"("workspace_id");

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_limit_buckets" ADD CONSTRAINT "rate_limit_buckets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

