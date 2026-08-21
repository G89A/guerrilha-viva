-- SPRINT 5 — vazão de envio configurável por canal. Aditiva, com padrões.

-- AlterTable
ALTER TABLE "messaging_channels" ADD COLUMN     "messages_per_second" DOUBLE PRECISION NOT NULL DEFAULT 10,
ADD COLUMN     "send_burst" DOUBLE PRECISION NOT NULL DEFAULT 20;

