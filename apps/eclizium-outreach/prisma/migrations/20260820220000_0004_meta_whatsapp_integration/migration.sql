-- SPRINT 2 — integração Meta WhatsApp Cloud API.
--
-- Aditiva, exceto por dois estreitamentos de enum. Ambos mapeiam os valores
-- antigos explicitamente durante o cast, então rodam com dados existentes:
--   ChannelProvider: META_WHATSAPP -> META
--   ChannelStatus:   DISABLED      -> DISCONNECTED

-- CreateEnum
CREATE TYPE "ChannelKind" AS ENUM ('WHATSAPP');

-- CreateEnum
CREATE TYPE "CredentialSource" AS ENUM ('ENVIRONMENT', 'ENCRYPTED');

-- CreateEnum
CREATE TYPE "ChannelEnvironment" AS ENUM ('TEST', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "TemplateAvailability" AS ENUM ('AVAILABLE', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "TemplateHeaderFormat" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'LOCATION', 'UNKNOWN');

-- AlterEnum
BEGIN;
CREATE TYPE "ChannelProvider_new" AS ENUM ('META');
ALTER TABLE "public"."messaging_channels" ALTER COLUMN "provider" DROP DEFAULT;
ALTER TABLE "public"."webhook_events" ALTER COLUMN "provider" DROP DEFAULT;
ALTER TABLE "messaging_channels" ALTER COLUMN "provider" TYPE "ChannelProvider_new"
  USING (CASE "provider"::text WHEN 'META_WHATSAPP' THEN 'META' ELSE "provider"::text END::"ChannelProvider_new");
-- (message_templates.provider é criada adiante, já com o enum novo)
ALTER TABLE "webhook_events" ALTER COLUMN "provider" TYPE "ChannelProvider_new"
  USING (CASE "provider"::text WHEN 'META_WHATSAPP' THEN 'META' ELSE "provider"::text END::"ChannelProvider_new");
ALTER TYPE "ChannelProvider" RENAME TO "ChannelProvider_old";
ALTER TYPE "ChannelProvider_new" RENAME TO "ChannelProvider";
DROP TYPE "public"."ChannelProvider_old";
ALTER TABLE "messaging_channels" ALTER COLUMN "provider" SET DEFAULT 'META';
ALTER TABLE "webhook_events" ALTER COLUMN "provider" SET DEFAULT 'META';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "ChannelStatus_new" AS ENUM ('NOT_CONFIGURED', 'CONNECTED', 'INVALID', 'DISCONNECTED', 'ERROR');
ALTER TABLE "public"."messaging_channels" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "messaging_channels" ALTER COLUMN "status" TYPE "ChannelStatus_new"
  USING (CASE "status"::text WHEN 'DISABLED' THEN 'DISCONNECTED' ELSE "status"::text END::"ChannelStatus_new");
ALTER TYPE "ChannelStatus" RENAME TO "ChannelStatus_old";
ALTER TYPE "ChannelStatus_new" RENAME TO "ChannelStatus";
DROP TYPE "public"."ChannelStatus_old";
ALTER TABLE "messaging_channels" ALTER COLUMN "status" SET DEFAULT 'NOT_CONFIGURED';
COMMIT;

-- AlterEnum
ALTER TYPE "MessageStatus" ADD VALUE 'SENDING';

-- DropForeignKey
ALTER TABLE "message_templates" DROP CONSTRAINT "message_templates_channel_id_fkey";

-- DropIndex
DROP INDEX "messaging_channels_workspace_id_provider_phone_number_id_key";

-- AlterTable
ALTER TABLE "message_templates" ADD COLUMN     "availability" "TemplateAvailability" NOT NULL DEFAULT 'AVAILABLE',
ADD COLUMN     "buttons" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "footer_text" TEXT,
ADD COLUMN     "header_format" "TemplateHeaderFormat",
ADD COLUMN     "header_text" TEXT,
ADD COLUMN     "provider" "ChannelProvider" NOT NULL DEFAULT 'META',
ADD COLUMN     "provider_category" TEXT,
ADD COLUMN     "provider_created_at" TIMESTAMP(3),
ADD COLUMN     "provider_status" TEXT,
ADD COLUMN     "quality_score" TEXT,
ADD COLUMN     "unavailable_since" TIMESTAMP(3),
ADD COLUMN     "variables" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "created_by_id" TEXT,
ADD COLUMN     "rendered_content" TEXT;

-- AlterTable
ALTER TABLE "messaging_channels" ADD COLUMN     "access_token_cipher" TEXT,
ADD COLUMN     "channel" "ChannelKind" NOT NULL DEFAULT 'WHATSAPP',
ADD COLUMN     "connected_at" TIMESTAMP(3),
ADD COLUMN     "credential_source" "CredentialSource" NOT NULL DEFAULT 'ENVIRONMENT',
ADD COLUMN     "display_phone_number" TEXT,
ADD COLUMN     "environment" "ChannelEnvironment" NOT NULL DEFAULT 'TEST',
ADD COLUMN     "graph_api_version" TEXT NOT NULL DEFAULT 'v21.0',
ADD COLUMN     "last_error_code" TEXT,
ADD COLUMN     "token_fingerprint" TEXT,
ADD COLUMN     "verified_name" TEXT,
ALTER COLUMN "provider" SET DEFAULT 'META';

-- AlterTable
ALTER TABLE "webhook_events" ALTER COLUMN "provider" SET DEFAULT 'META';

-- CreateIndex
CREATE INDEX "message_templates_workspace_id_availability_idx" ON "message_templates"("workspace_id", "availability");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_workspace_id_provider_provider_template_i_key" ON "message_templates"("workspace_id", "provider", "provider_template_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_workspace_id_id_key" ON "message_templates"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "messaging_channels_workspace_id_provider_channel_key" ON "messaging_channels"("workspace_id", "provider", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "messaging_channels_workspace_id_id_key" ON "messaging_channels"("workspace_id", "id");

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_workspace_id_channel_id_fkey" FOREIGN KEY ("workspace_id", "channel_id") REFERENCES "messaging_channels"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

