-- 0011 — Política de envio e saúde do número
--
-- Aditiva: nenhuma coluna, tabela ou restrição é removida, e nenhum dado
-- existente é reescrito. Canais existentes ficam com qualidade UNKNOWN, que é o
-- estado honesto — nunca perguntamos à Meta ainda.
--
-- A política não é criada aqui para nenhum workspace: a leitura devolve os
-- padrões quando a linha não existe, então não há backfill a fazer e workspace
-- novo já nasce protegido.

-- CreateEnum
CREATE TYPE "NumberQuality" AS ENUM ('UNKNOWN', 'GREEN', 'YELLOW', 'RED');

-- AlterTable
ALTER TABLE "messaging_channels" ADD COLUMN     "messaging_limit_tier" TEXT,
ADD COLUMN     "quality_checked_at" TIMESTAMP(3),
ADD COLUMN     "quality_rating" "NumberQuality" NOT NULL DEFAULT 'UNKNOWN';

-- CreateTable
CREATE TABLE "sending_policies" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "opt_out_enabled" BOOLEAN NOT NULL DEFAULT true,
    "opt_out_keywords" TEXT[] DEFAULT ARRAY['PARAR', 'SAIR', 'CANCELAR', 'DESCADASTRAR', 'STOP', 'REMOVER']::TEXT[],
    "frequency_cap_messages" INTEGER NOT NULL DEFAULT 4,
    "frequency_cap_window_days" INTEGER NOT NULL DEFAULT 7,
    "quiet_hours_enabled" BOOLEAN NOT NULL DEFAULT true,
    "quiet_hours_start" INTEGER NOT NULL DEFAULT 21,
    "quiet_hours_end" INTEGER NOT NULL DEFAULT 8,
    "time_zone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "pause_on_red_quality" BOOLEAN NOT NULL DEFAULT true,
    "pause_on_yellow_quality" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sending_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sending_policies_workspace_id_key" ON "sending_policies"("workspace_id");

-- AddForeignKey
ALTER TABLE "sending_policies" ADD CONSTRAINT "sending_policies_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

