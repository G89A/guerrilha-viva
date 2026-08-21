'use server';

import { revalidatePath } from 'next/cache';
import { ConversationStatus } from '@prisma/client';
import { z } from 'zod';
import { requireWorkspaceRole } from '@/lib/auth/guards';
import { WorkspaceRole } from '@/lib/auth/roles';
import { runAction, type ActionResult } from '@/lib/errors/result';
import { assertSameOriginRequest } from '@/lib/security/request-context';
import { formDataToObject, parseOrThrow } from '@/lib/validation/parse';
import { assertWithinLimit, InMemoryRateLimiter } from '@/lib/security/rate-limit';
import { writeAuditLog } from '@/lib/audit/audit-log';
import { cuidSchema } from '@/lib/validation/common';
import {
  markConversationRead,
  setConversationStatus,
} from '@/features/messaging/conversation-service';
import { sendReply } from '@/features/messaging/reply-service';
import { MAX_REPLY_LENGTH } from '@/features/messaging/reply-constants';

/** Teto de respostas manuais por workspace — proteção operacional. */
const replyLimiter = new InMemoryRateLimiter(60, 5 * 60 * 1000);

const replySchema = z.object({
  conversationId: cuidSchema,
  text: z.string().trim().min(1, 'Escreva uma mensagem.').max(MAX_REPLY_LENGTH),
});

const conversationSchema = z.object({ conversationId: cuidSchema });

const statusSchema = z.object({
  conversationId: cuidSchema,
  status: z.nativeEnum(ConversationStatus),
});

export type ReplyResult =
  | { status: 'SENT'; providerMessageId: string }
  | { status: 'BLOCKED'; reason: string }
  | { status: 'FAILED'; error: string; retryable: boolean };

export async function sendReplyAction(
  _previous: ActionResult<ReplyResult> | null,
  formData: FormData,
): Promise<ActionResult<ReplyResult>> {
  return runAction('inbox.reply', async () => {
    await assertSameOriginRequest();
    const context = await requireWorkspaceRole(WorkspaceRole.MEMBER);
    const input = parseOrThrow(replySchema, formDataToObject(formData));

    assertWithinLimit(replyLimiter.check(`reply:${context.workspace.id}`));

    const outcome = await sendReply({
      workspaceId: context.workspace.id,
      actorUserId: context.user.id,
      conversationId: input.conversationId,
      text: input.text,
    });

    revalidatePath('/inbox');
    revalidatePath(`/inbox/${input.conversationId}`);

    if (outcome.ok) {
      return { status: 'SENT' as const, providerMessageId: outcome.providerMessageId };
    }
    if (outcome.kind === 'BLOCKED') {
      return { status: 'BLOCKED' as const, reason: outcome.reason };
    }
    return { status: 'FAILED' as const, error: outcome.error, retryable: outcome.retryable };
  });
}

export async function markReadAction(formData: FormData): Promise<ActionResult<{ ok: true }>> {
  return runAction('inbox.mark_read', async () => {
    await assertSameOriginRequest();
    const context = await requireWorkspaceRole(WorkspaceRole.MEMBER);
    const input = parseOrThrow(conversationSchema, formDataToObject(formData));

    const result = await markConversationRead(context.workspace.id, input.conversationId);

    // Só audita quando algo mudou: abrir uma conversa já lida não é evento.
    if (result.changed) {
      await writeAuditLog({
        action: 'conversation.read',
        resourceType: 'Conversation',
        resourceId: input.conversationId,
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        metadata: {},
      });
    }

    revalidatePath('/inbox');
    return { ok: true as const };
  });
}

export async function setStatusAction(formData: FormData): Promise<ActionResult<{ ok: true }>> {
  return runAction('inbox.set_status', async () => {
    await assertSameOriginRequest();
    const context = await requireWorkspaceRole(WorkspaceRole.MEMBER);
    const input = parseOrThrow(statusSchema, formDataToObject(formData));

    await setConversationStatus(context.workspace.id, input.conversationId, input.status);

    await writeAuditLog({
      action: 'conversation.status_changed',
      resourceType: 'Conversation',
      resourceId: input.conversationId,
      workspaceId: context.workspace.id,
      actorUserId: context.user.id,
      metadata: { status: input.status },
    });

    revalidatePath('/inbox');
    revalidatePath(`/inbox/${input.conversationId}`);
    return { ok: true as const };
  });
}
