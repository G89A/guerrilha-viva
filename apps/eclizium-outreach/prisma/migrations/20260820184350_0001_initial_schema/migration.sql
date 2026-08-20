-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ConsentChannel" AS ENUM ('WHATSAPP', 'SMS', 'EMAIL');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('UNKNOWN', 'PENDING', 'GRANTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ConsentSource" AS ENUM ('MANUAL', 'CSV_IMPORT', 'WEB_FORM', 'API', 'INBOUND_MESSAGE', 'PROVIDER_EVENT', 'OTHER');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('OPT_OUT', 'MANUAL', 'COMPLAINT', 'HARD_BOUNCE', 'INVALID_NUMBER', 'PROVIDER_BLOCK');

-- CreateEnum
CREATE TYPE "ChannelProvider" AS ENUM ('META_WHATSAPP');

-- CreateEnum
CREATE TYPE "ChannelStatus" AS ENUM ('NOT_CONFIGURED', 'CONNECTED', 'DISABLED', 'ERROR');

-- CreateEnum
CREATE TYPE "TemplateStatus" AS ENUM ('UNKNOWN', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED');

-- CreateEnum
CREATE TYPE "TemplateCategory" AS ENUM ('UNKNOWN', 'MARKETING', 'UTILITY', 'AUTHENTICATION');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "RecipientStatus" AS ENUM ('PENDING', 'ELIGIBLE', 'INELIGIBLE', 'QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'REPLIED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'PENDING', 'CLOSED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'TEMPLATE', 'IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT', 'STICKER', 'LOCATION', 'CONTACTS', 'INTERACTIVE', 'UNSUPPORTED');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "active_workspace_id" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "email" TEXT,
    "locale" TEXT,
    "timezone" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "status" "ContactStatus" NOT NULL DEFAULT 'ACTIVE',
    "source" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_consents" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "channel" "ConsentChannel" NOT NULL,
    "status" "ConsentStatus" NOT NULL DEFAULT 'UNKNOWN',
    "source" "ConsentSource" NOT NULL DEFAULT 'MANUAL',
    "evidence" TEXT,
    "granted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_lists" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_list_members" (
    "id" TEXT NOT NULL,
    "list_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_list_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_tags" (
    "id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppression_entries" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppression_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messaging_channels" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "provider" "ChannelProvider" NOT NULL DEFAULT 'META_WHATSAPP',
    "status" "ChannelStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "display_name" TEXT NOT NULL,
    "phone_number_id" TEXT,
    "waba_id" TEXT,
    "phone_e164" TEXT,
    "last_error" TEXT,
    "last_verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messaging_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "provider_template_id" TEXT,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" "TemplateCategory" NOT NULL DEFAULT 'UNKNOWN',
    "status" "TemplateStatus" NOT NULL DEFAULT 'UNKNOWN',
    "body" TEXT NOT NULL,
    "components" JSONB NOT NULL DEFAULT '[]',
    "variable_count" INTEGER NOT NULL DEFAULT 0,
    "rejected_reason" TEXT,
    "synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "channel_id" TEXT,
    "template_id" TEXT,
    "list_id" TEXT,
    "variable_map" JSONB NOT NULL DEFAULT '{}',
    "scheduled_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_recipients" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "status" "RecipientStatus" NOT NULL DEFAULT 'PENDING',
    "idempotency_key" TEXT NOT NULL,
    "ineligible_reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "variables" JSONB NOT NULL DEFAULT '{}',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "queued_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "replied_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "failure_code" TEXT,
    "failure_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "assignee_id" TEXT,
    "unread_count" INTEGER NOT NULL DEFAULT 0,
    "last_message_at" TIMESTAMP(3),
    "last_inbound_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "contact_id" TEXT NOT NULL,
    "campaign_id" TEXT,
    "recipient_id" TEXT,
    "template_id" TEXT,
    "direction" "MessageDirection" NOT NULL,
    "type" "MessageType" NOT NULL DEFAULT 'TEXT',
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "body" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "provider_message_id" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "provider" "ChannelProvider" NOT NULL DEFAULT 'META_WHATSAPP',
    "provider_event_id" TEXT NOT NULL,
    "event_type" TEXT,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "payload" JSONB NOT NULL,
    "signature_valid" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "actor_user_id" TEXT,
    "actor_type" TEXT NOT NULL DEFAULT 'USER',
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");

-- CreateIndex
CREATE INDEX "workspace_members_user_id_idx" ON "workspace_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_workspace_id_user_id_key" ON "workspace_members"("workspace_id", "user_id");

-- CreateIndex
CREATE INDEX "contacts_workspace_id_status_idx" ON "contacts"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "contacts_workspace_id_created_at_idx" ON "contacts"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "contacts_phone_e164_idx" ON "contacts"("phone_e164");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_workspace_id_phone_e164_key" ON "contacts"("workspace_id", "phone_e164");

-- CreateIndex
CREATE INDEX "contact_consents_workspace_id_channel_status_idx" ON "contact_consents"("workspace_id", "channel", "status");

-- CreateIndex
CREATE UNIQUE INDEX "contact_consents_contact_id_channel_key" ON "contact_consents"("contact_id", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "contact_lists_workspace_id_name_key" ON "contact_lists"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "contact_list_members_contact_id_idx" ON "contact_list_members"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_list_members_list_id_contact_id_key" ON "contact_list_members"("list_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "tags_workspace_id_name_key" ON "tags"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "contact_tags_contact_id_idx" ON "contact_tags"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_tags_tag_id_contact_id_key" ON "contact_tags"("tag_id", "contact_id");

-- CreateIndex
CREATE INDEX "suppression_entries_workspace_id_created_at_idx" ON "suppression_entries"("workspace_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "suppression_entries_workspace_id_phone_e164_key" ON "suppression_entries"("workspace_id", "phone_e164");

-- CreateIndex
CREATE INDEX "messaging_channels_workspace_id_status_idx" ON "messaging_channels"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "messaging_channels_workspace_id_provider_phone_number_id_key" ON "messaging_channels"("workspace_id", "provider", "phone_number_id");

-- CreateIndex
CREATE INDEX "message_templates_workspace_id_status_idx" ON "message_templates"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_channel_id_name_language_key" ON "message_templates"("channel_id", "name", "language");

-- CreateIndex
CREATE INDEX "campaigns_workspace_id_status_idx" ON "campaigns"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "campaigns_workspace_id_scheduled_at_idx" ON "campaigns"("workspace_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "campaign_recipients_campaign_id_status_idx" ON "campaign_recipients"("campaign_id", "status");

-- CreateIndex
CREATE INDEX "campaign_recipients_workspace_id_status_idx" ON "campaign_recipients"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recipients_campaign_id_contact_id_key" ON "campaign_recipients"("campaign_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recipients_idempotency_key_key" ON "campaign_recipients"("idempotency_key");

-- CreateIndex
CREATE INDEX "conversations_workspace_id_status_last_message_at_idx" ON "conversations"("workspace_id", "status", "last_message_at");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_channel_id_contact_id_key" ON "conversations"("channel_id", "contact_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_workspace_id_status_idx" ON "messages"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "messages_campaign_id_status_idx" ON "messages"("campaign_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "messages_workspace_id_provider_message_id_key" ON "messages"("workspace_id", "provider_message_id");

-- CreateIndex
CREATE INDEX "webhook_events_status_created_at_idx" ON "webhook_events"("status", "created_at");

-- CreateIndex
CREATE INDEX "webhook_events_workspace_id_created_at_idx" ON "webhook_events"("workspace_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_provider_event_id_key" ON "webhook_events"("provider", "provider_event_id");

-- CreateIndex
CREATE INDEX "audit_logs_workspace_id_created_at_idx" ON "audit_logs"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_workspace_id_resource_type_resource_id_idx" ON "audit_logs"("workspace_id", "resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_workspace_id_fkey" FOREIGN KEY ("active_workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_consents" ADD CONSTRAINT "contact_consents_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_consents" ADD CONSTRAINT "contact_consents_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_lists" ADD CONSTRAINT "contact_lists_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_list_members" ADD CONSTRAINT "contact_list_members_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "contact_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_list_members" ADD CONSTRAINT "contact_list_members_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppression_entries" ADD CONSTRAINT "suppression_entries_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messaging_channels" ADD CONSTRAINT "messaging_channels_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "messaging_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "messaging_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "message_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "contact_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "messaging_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "messaging_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "campaign_recipients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "message_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
