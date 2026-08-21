-- SPRINT 3 — recepção de webhooks da Meta.
--
-- Totalmente aditiva. A única mudança de coluna existente é um RENAME
-- (webhook_events.error -> error_message), que preserva os dados em vez de
-- descartá-los como faria o DROP+ADD que o Prisma gerou.

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('NOT_APPLICABLE', 'NOT_YET_FETCHED', 'FETCHED', 'FAILED');

-- AlterEnum
ALTER TYPE "WebhookEventStatus" ADD VALUE 'PROCESSING';

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "error_details" JSONB,
ADD COLUMN     "error_title" TEXT,
ADD COLUMN     "media_caption" TEXT,
ADD COLUMN     "media_filename" TEXT,
ADD COLUMN     "media_id" TEXT,
ADD COLUMN     "media_mime_type" TEXT,
ADD COLUMN     "media_sha256" TEXT,
ADD COLUMN     "media_status" "MediaStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
ADD COLUMN     "provider_timestamp" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "webhook_events" RENAME COLUMN "error" TO "error_message";
ALTER TABLE "webhook_events" ADD COLUMN "failed_at" TIMESTAMP(3),
ADD COLUMN     "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

