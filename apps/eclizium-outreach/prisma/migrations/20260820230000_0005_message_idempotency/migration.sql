-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "idempotency_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "messages_workspace_id_idempotency_key_key" ON "messages"("workspace_id", "idempotency_key");

