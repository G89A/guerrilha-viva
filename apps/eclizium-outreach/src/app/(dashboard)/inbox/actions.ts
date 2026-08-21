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
import { AppError } from '@/lib/errors/app-error';
import { cuidSchema } from '@/lib/validation/common';
import {
  addConversationNote,
  assignConversation,
  markConversationRead,
  MAX_NOTE_LENGTH,
  setConversationStatus,
} from '@/features/messaging/conversation-service';
import { sendReply } from '@/features/messaging/reply-service';
import { confirmReadOnProvider } from '@/features/messaging/read-receipt-service';
import { MAX_REPLY_LENGTH } from '@/features/messaging/reply-constants';
import {
  listConversations,
  listOlderMessages,
  type ConversationFilters,
  type ConversationPage,
  type OlderMessagesPage,
} from '@/features/messaging/inbox-query';

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

const assignSchema = z.object({
  conversationId: cuidSchema,
  // String vazia significa "remover responsável" — é o valor que o `select`
  // manda quando o operador escolhe "Sem responsável".
  assigneeId: z.union([cuidSchema, z.literal('')]),
});

export async function assignAction(
  formData: FormData,
): Promise<ActionResult<{ ok: true; changed: boolean }>> {
  return runAction('inbox.assign', async () => {
    await assertSameOriginRequest();
    const context = await requireWorkspaceRole(WorkspaceRole.MEMBER);
    const input = parseOrThrow(assignSchema, formDataToObject(formData));

    const assigneeId = input.assigneeId === '' ? null : input.assigneeId;
    const result = await assignConversation({
      workspaceId: context.workspace.id,
      conversationId: input.conversationId,
      assigneeId,
    });

    if (result.reason) {
      throw AppError.validation(result.reason, { assigneeId: [result.reason] });
    }

    if (result.changed) {
      await writeAuditLog({
        action: assigneeId ? 'conversation.assigned' : 'conversation.unassigned',
        resourceType: 'Conversation',
        resourceId: input.conversationId,
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        metadata: assigneeId ? { assigneeId } : {},
      });
    }

    revalidatePath('/inbox');
    revalidatePath(`/inbox/${input.conversationId}`);
    return { ok: true as const, changed: result.changed };
  });
}

const noteSchema = z.object({
  conversationId: cuidSchema,
  body: z.string().trim().min(1, 'Escreva a nota.').max(MAX_NOTE_LENGTH),
});

export async function addNoteAction(
  _previous: ActionResult<{ ok: true }> | null,
  formData: FormData,
): Promise<ActionResult<{ ok: true }>> {
  return runAction('inbox.add_note', async () => {
    await assertSameOriginRequest();
    const context = await requireWorkspaceRole(WorkspaceRole.MEMBER);
    const input = parseOrThrow(noteSchema, formDataToObject(formData));

    const result = await addConversationNote({
      workspaceId: context.workspace.id,
      conversationId: input.conversationId,
      authorId: context.user.id,
      body: input.body,
    });

    if (!result.created) {
      throw AppError.validation(result.reason ?? 'Nota não registrada.', {
        body: [result.reason ?? 'Nota não registrada.'],
      });
    }

    await writeAuditLog({
      action: 'conversation.note_added',
      resourceType: 'Conversation',
      resourceId: input.conversationId,
      workspaceId: context.workspace.id,
      actorUserId: context.user.id,
      // O texto da nota NÃO vai para o audit log: registro de auditoria não é
      // arquivo de conteúdo.
      metadata: { noteId: result.noteId ?? null },
    });

    revalidatePath(`/inbox/${input.conversationId}`);
    return { ok: true as const };
  });
}

export type ReadReceiptActionResult = { confirmed: number } | { blocked: string };

/**
 * Confirma leitura NO WHATSAPP. Ato explícito, separado de abrir a conversa:
 * é comunicação para fora, e o contato vê o tique azul.
 */
export async function confirmReadAction(
  formData: FormData,
): Promise<ActionResult<ReadReceiptActionResult>> {
  return runAction('inbox.confirm_read', async () => {
    await assertSameOriginRequest();
    const context = await requireWorkspaceRole(WorkspaceRole.MEMBER);
    const input = parseOrThrow(conversationSchema, formDataToObject(formData));

    assertWithinLimit(replyLimiter.check(`read:${context.workspace.id}`));

    const outcome = await confirmReadOnProvider({
      workspaceId: context.workspace.id,
      conversationId: input.conversationId,
    });

    if (!outcome.ok) return { blocked: outcome.reason };

    await writeAuditLog({
      action: 'conversation.read_confirmed',
      resourceType: 'Conversation',
      resourceId: input.conversationId,
      workspaceId: context.workspace.id,
      actorUserId: context.user.id,
      metadata: { confirmed: outcome.confirmed },
    });

    revalidatePath(`/inbox/${input.conversationId}`);
    return { confirmed: outcome.confirmed };
  });
}

const pageSchema = z.object({
  cursor: cuidSchema.optional(),
  status: z.string().optional(),
  search: z.string().max(120).optional(),
  unread: z.string().optional(),
  assignee: z.string().max(64).optional(),
});

/**
 * Uma página da lista de conversas.
 *
 * Serve tanto ao "carregar mais" (com cursor) quanto ao refiltrar (sem cursor).
 * O painel lateral vive no layout, que não recebe `searchParams` — então quem
 * aplica o filtro é o cliente, chamando esta ação. Os filtros são reavaliados
 * aqui no servidor, sobre o workspace da sessão.
 */
export async function queryConversationsAction(
  raw: unknown,
): Promise<ActionResult<ConversationPage>> {
  return runAction('inbox.query_conversations', async () => {
    const context = await requireWorkspaceRole(WorkspaceRole.MEMBER);
    const input = parseOrThrow(pageSchema, raw);

    const filters: ConversationFilters = {
      ...(input.status && input.status in ConversationStatus
        ? { status: input.status as ConversationStatus }
        : {}),
      ...(input.search ? { search: input.search } : {}),
      ...(input.unread === '1' ? { unreadOnly: true } : {}),
      ...(input.assignee ? { assigneeId: input.assignee as string } : {}),
    };

    return listConversations(
      context.workspace.id,
      filters,
      input.cursor ? { cursor: input.cursor } : {},
    );
  });
}

const olderSchema = z.object({
  conversationId: cuidSchema,
  cursor: cuidSchema,
});

/** Página anterior do histórico da conversa. */
export async function loadOlderMessagesAction(
  raw: unknown,
): Promise<ActionResult<OlderMessagesPage>> {
  return runAction('inbox.load_older', async () => {
    const context = await requireWorkspaceRole(WorkspaceRole.MEMBER);
    const input = parseOrThrow(olderSchema, raw);

    return listOlderMessages(context.workspace.id, input.conversationId, input.cursor);
  });
}
