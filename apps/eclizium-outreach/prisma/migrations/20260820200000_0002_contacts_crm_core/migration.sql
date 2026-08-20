-- SPRINT 1 — núcleo de CRM: campos de contato, consentimento com prova,
-- supressão por canal e foreign keys compostas nas tabelas de junção.
--
-- Esta migration é aditiva onde possível. Os três pontos que estreitam o
-- schema (dois enums e duas colunas NOT NULL novas) fazem backfill explícito
-- antes de apertar a restrição, para que rodem com dados existentes.

-- AlterEnum
BEGIN;
CREATE TYPE "ConsentStatus_new" AS ENUM ('UNKNOWN', 'GRANTED', 'REVOKED');
ALTER TABLE "public"."contact_consents" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "contact_consents" ALTER COLUMN "status" TYPE "ConsentStatus_new"
  USING (CASE "status"::text WHEN 'PENDING' THEN 'UNKNOWN' ELSE "status"::text END::"ConsentStatus_new");
ALTER TYPE "ConsentStatus" RENAME TO "ConsentStatus_old";
ALTER TYPE "ConsentStatus_new" RENAME TO "ConsentStatus";
DROP TYPE "public"."ConsentStatus_old";
ALTER TABLE "contact_consents" ALTER COLUMN "status" SET DEFAULT 'UNKNOWN';
COMMIT;

-- AlterEnum
ALTER TYPE "ContactStatus" ADD VALUE 'INVALID';

-- AlterEnum
BEGIN;
CREATE TYPE "SuppressionReason_new" AS ENUM ('OPT_OUT', 'BLOCKED', 'COMPLAINT', 'INVALID', 'MANUAL');
ALTER TABLE "suppression_entries" ALTER COLUMN "reason" TYPE "SuppressionReason_new"
  USING (CASE "reason"::text
    WHEN 'HARD_BOUNCE' THEN 'BLOCKED'
    WHEN 'PROVIDER_BLOCK' THEN 'BLOCKED'
    WHEN 'INVALID_NUMBER' THEN 'INVALID'
    ELSE "reason"::text
  END::"SuppressionReason_new");
ALTER TYPE "SuppressionReason" RENAME TO "SuppressionReason_old";
ALTER TYPE "SuppressionReason_new" RENAME TO "SuppressionReason";
DROP TYPE "public"."SuppressionReason_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "contact_list_members" DROP CONSTRAINT "contact_list_members_contact_id_fkey";

-- DropForeignKey
ALTER TABLE "contact_list_members" DROP CONSTRAINT "contact_list_members_list_id_fkey";

-- DropForeignKey
ALTER TABLE "contact_tags" DROP CONSTRAINT "contact_tags_contact_id_fkey";

-- DropForeignKey
ALTER TABLE "contact_tags" DROP CONSTRAINT "contact_tags_tag_id_fkey";

-- DropIndex
DROP INDEX "suppression_entries_workspace_id_phone_e164_key";

-- AlterTable
ALTER TABLE "contact_consents" DROP COLUMN "evidence",
DROP COLUMN "granted_at",
ADD COLUMN     "captured_at" TIMESTAMP(3),
ADD COLUMN     "proof_reference" TEXT;

-- AlterTable
ALTER TABLE "contact_list_members" ADD COLUMN "workspace_id" TEXT;
UPDATE "contact_list_members" m
   SET "workspace_id" = c."workspace_id"
  FROM "contacts" c
 WHERE c."id" = m."contact_id" AND m."workspace_id" IS NULL;
-- Um vínculo órfão não pode receber tenant; removê-lo é a única saída correta.
DELETE FROM "contact_list_members" WHERE "workspace_id" IS NULL;
ALTER TABLE "contact_list_members" ALTER COLUMN "workspace_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "contact_tags" ADD COLUMN "workspace_id" TEXT;
UPDATE "contact_tags" t
   SET "workspace_id" = c."workspace_id"
  FROM "contacts" c
 WHERE c."id" = t."contact_id" AND t."workspace_id" IS NULL;
DELETE FROM "contact_tags" WHERE "workspace_id" IS NULL;
ALTER TABLE "contact_tags" ALTER COLUMN "workspace_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "city" TEXT,
ADD COLUMN     "company" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "segment" TEXT,
ADD COLUMN     "state" TEXT;

-- AlterTable
ALTER TABLE "suppression_entries" ADD COLUMN     "channel" "ConsentChannel" NOT NULL DEFAULT 'WHATSAPP',
ADD COLUMN     "contact_id" TEXT,
ADD COLUMN     "created_by_id" TEXT;

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "default_phone_region" TEXT NOT NULL DEFAULT 'BR';

-- CreateIndex
CREATE INDEX "contact_list_members_workspace_id_idx" ON "contact_list_members"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_lists_workspace_id_id_key" ON "contact_lists"("workspace_id", "id");

-- CreateIndex
CREATE INDEX "contact_tags_workspace_id_idx" ON "contact_tags"("workspace_id");

-- CreateIndex
CREATE INDEX "contacts_workspace_id_city_idx" ON "contacts"("workspace_id", "city");

-- CreateIndex
CREATE INDEX "contacts_workspace_id_source_idx" ON "contacts"("workspace_id", "source");

-- CreateIndex
CREATE INDEX "contacts_workspace_id_company_idx" ON "contacts"("workspace_id", "company");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_workspace_id_id_key" ON "contacts"("workspace_id", "id");

-- CreateIndex
CREATE INDEX "suppression_entries_contact_id_idx" ON "suppression_entries"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "suppression_entries_workspace_id_channel_phone_e164_key" ON "suppression_entries"("workspace_id", "channel", "phone_e164");

-- CreateIndex
CREATE UNIQUE INDEX "tags_workspace_id_id_key" ON "tags"("workspace_id", "id");

-- AddForeignKey
ALTER TABLE "contact_list_members" ADD CONSTRAINT "contact_list_members_workspace_id_list_id_fkey" FOREIGN KEY ("workspace_id", "list_id") REFERENCES "contact_lists"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_list_members" ADD CONSTRAINT "contact_list_members_workspace_id_contact_id_fkey" FOREIGN KEY ("workspace_id", "contact_id") REFERENCES "contacts"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_workspace_id_tag_id_fkey" FOREIGN KEY ("workspace_id", "tag_id") REFERENCES "tags"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_workspace_id_contact_id_fkey" FOREIGN KEY ("workspace_id", "contact_id") REFERENCES "contacts"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppression_entries" ADD CONSTRAINT "suppression_entries_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppression_entries" ADD CONSTRAINT "suppression_entries_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

