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
  | 'workspace.member_removed';

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
