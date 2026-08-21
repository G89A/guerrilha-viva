-- SPRINT 4 — motor de campanhas.
--
-- As três remoções de coluna que o Prisma gerou foram convertidas em operações
-- que PRESERVAM dados:
--   campaign_recipients.failure_message    -> RENAME failure_reason
--   campaign_recipients.ineligible_reasons -> RENAME eligibility_reasons
--   campaigns.list_id                      -> copiado para audience_filters
--                                             antes de ser removido
-- `audience_filters` passa a ser a única fonte da seleção da audiência, para
-- que não existam dois lugares divergentes dizendo quem entra na campanha.

-- CreateEnum
CREATE TYPE "RecipientEligibility" AS ENUM ('NOT_EVALUATED', 'ELIGIBLE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "MissingVariablePolicy" AS ENUM ('BLOCK_RECIPIENT', 'FALLBACK_VALUE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CampaignStatus" ADD VALUE 'PREPARING';
ALTER TYPE "CampaignStatus" ADD VALUE 'READY';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RecipientStatus" ADD VALUE 'SUPPRESSED';
ALTER TYPE "RecipientStatus" ADD VALUE 'INVALID';

-- DropForeignKey
ALTER TABLE "campaigns" DROP CONSTRAINT "campaigns_list_id_fkey";

-- AlterTable
ALTER TABLE "campaign_recipients" RENAME COLUMN "failure_message" TO "failure_reason";
ALTER TABLE "campaign_recipients" RENAME COLUMN "ineligible_reasons" TO "eligibility_reasons";
ALTER TABLE "campaign_recipients"
ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "eligibility" "RecipientEligibility" NOT NULL DEFAULT 'NOT_EVALUATED',
ADD COLUMN     "provider_message_id" TEXT,
ADD COLUMN     "rendered_preview" TEXT,
ADD COLUMN     "scheduled_at" TIMESTAMP(3),
ADD COLUMN     "sending_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "campaigns"
ADD COLUMN     "audience_filters" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "channel" "ChannelKind" NOT NULL DEFAULT 'WHATSAPP',
ADD COLUMN     "description" TEXT,
ADD COLUMN     "eligible_recipients" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "invalid_recipients" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "last_dry_run_at" TIMESTAMP(3),
ADD COLUMN     "paused_at" TIMESTAMP(3),
ADD COLUMN     "prepared_at" TIMESTAMP(3),
ADD COLUMN     "suppressed_recipients" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC',
ADD COLUMN     "total_recipients" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "variable_fallbacks" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "variable_policy" "MissingVariablePolicy" NOT NULL DEFAULT 'BLOCK_RECIPIENT';

-- CreateIndex
CREATE INDEX "campaign_recipients_campaign_id_eligibility_idx" ON "campaign_recipients"("campaign_id", "eligibility");

-- CreateIndex
CREATE INDEX "campaign_recipients_contact_id_idx" ON "campaign_recipients"("contact_id");

-- CreateIndex
CREATE INDEX "campaigns_workspace_id_created_at_idx" ON "campaigns"("workspace_id", "created_at");

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Preserva a seleção por lista das campanhas existentes antes de remover a
-- coluna: `list_id` vira `{"listIds": ["…"]}` dentro de audience_filters.
UPDATE "campaigns"
   SET "audience_filters" = jsonb_build_object('listIds', jsonb_build_array("list_id"))
 WHERE "list_id" IS NOT NULL;

ALTER TABLE "campaigns" DROP COLUMN "list_id";
