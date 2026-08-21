import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging/logger';

/**
 * Actions worth an immutable record. Keep this list explicit — a free-form
 * string would make the audit trail unqueryable within a release or two.
 */
export type AuditAction =
  | 'user.registered'
  | 'user.login_succeeded'
  | 'user.login_failed'
  | 'user.logged_out'
  | 'workspace.created'
  | 'workspace.updated'
  | 'workspace.switched'
  | 'workspace.member_added'
  | 'workspace.member_role_changed'
  | 'workspace.member_removed'
  | 'contact.created'
  | 'contact.updated'
  | 'contact.archived'
  | 'contact.restored'
  | 'contact.import_started'
  | 'contact.import_completed'
  | 'contact.tag_added'
  | 'contact.tag_removed'
  | 'contact.list_member_added'
  | 'contact.list_member_removed'
  | 'contact.consent_updated'
  | 'contact.suppressed'
  | 'contact.unsuppressed'
  | 'contact.batch_action'
  | 'messaging.integration_configured'
  | 'messaging.integration_disconnected'
  | 'messaging.connection_tested'
  | 'messaging.connection_failed'
  | 'messaging.templates_sync_started'
  | 'messaging.templates_sync_completed'
  | 'messaging.templates_sync_failed'
  | 'messaging.test_message_attempted'
  | 'messaging.test_message_sent'
  | 'messaging.test_message_failed'
  | 'webhook.received'
  | 'webhook.processed'
  | 'webhook.failed'
  | 'message.inbound_received'
  | 'message.status_sent'
  | 'message.status_delivered'
  | 'message.status_read'
  | 'message.status_failed'
  | 'message.reply_sent'
  | 'conversation.created'
  | 'conversation.read'
  | 'conversation.status_changed'
  | 'campaign.created'
  | 'campaign.updated'
  | 'campaign.prepared'
  | 'campaign.dry_run'
  | 'campaign.scheduled'
  | 'campaign.started'
  | 'campaign.paused'
  | 'campaign.resumed'
  | 'campaign.cancelled';

export interface WriteAuditLogInput {
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  workspaceId?: string | null;
  actorUserId?: string | null;
  actorType?: 'USER' | 'SYSTEM' | 'PROVIDER';
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Records a sensitive action. Audit writes must never break the operation they
 * describe, so failures are logged and swallowed — but they are logged at
 * `error` so a broken audit trail is visible in monitoring.
 */
export async function writeAuditLog(
  input: WriteAuditLogInput,
  client: Prisma.TransactionClient = prisma,
): Promise<void> {
  try {
    await client.auditLog.create({
      data: {
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        workspaceId: input.workspaceId ?? null,
        actorUserId: input.actorUserId ?? null,
        actorType: input.actorType ?? 'USER',
        metadata: input.metadata ?? {},
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  } catch (error) {
    logger.error('audit.write_failed', { action: input.action, error });
  }
}
