-- 0010 — Colaboração na Inbox
--
-- Aditiva: nenhuma coluna, tabela, índice ou restrição é removida, e nenhum
-- dado existente é reescrito. Adiciona notas internas, respostas rápidas, o
-- responsável pela conversa (com a FK que faltava), o momento da confirmação
-- de leitura à Meta e o tipo de job de webhook.
--
-- `ALTER TYPE ... ADD VALUE` é seguro dentro da transação da migration no
-- PostgreSQL 12+ porque o valor novo não é USADO aqui — só declarado.

-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'WEBHOOK_EVENT';

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "assigned_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "read_receipt_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "conversation_notes" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "author_id" TEXT,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quick_replies" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quick_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversation_notes_conversation_id_created_at_idx" ON "conversation_notes"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "conversation_notes_workspace_id_created_at_idx" ON "conversation_notes"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "quick_replies_workspace_id_title_idx" ON "quick_replies"("workspace_id", "title");

-- CreateIndex
CREATE UNIQUE INDEX "quick_replies_workspace_id_title_key" ON "quick_replies"("workspace_id", "title");

-- CreateIndex
CREATE INDEX "conversations_workspace_id_assignee_id_status_idx" ON "conversations"("workspace_id", "assignee_id", "status");

-- Antes de criar a FK, limpa referências penduradas: a coluna existia desde a
-- Sprint 3 sem restrição, então um id de usuário inexistente impediria a
-- criação da chave. Hoje a coluna nunca é preenchida, mas a migration não pode
-- depender disso.
UPDATE "conversations" SET "assignee_id" = NULL
 WHERE "assignee_id" IS NOT NULL
   AND "assignee_id" NOT IN (SELECT "id" FROM "users");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_notes" ADD CONSTRAINT "conversation_notes_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_notes" ADD CONSTRAINT "conversation_notes_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_notes" ADD CONSTRAINT "conversation_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quick_replies" ADD CONSTRAINT "quick_replies_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quick_replies" ADD CONSTRAINT "quick_replies_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

