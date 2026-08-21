import 'server-only';
import type { MessagingChannel } from '@prisma/client';
import { ChannelKind, ChannelProvider, MessageDirection, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging/logger';
import { writeAuditLog, type AuditAction } from '@/lib/audit/audit-log';
import {
  evaluateTransition,
  timestampFieldFor,
  toInternalStatus,
} from '@/features/messaging/message-status';
import { processInboundMessage } from '@/features/messaging/inbound-service';
import { registerOutbound } from '@/features/messaging/conversation-service';
import type { ParsedEvent, StatusEvent } from '@/features/webhooks/parser';
import { markFailed, markIgnored, markProcessed, markProcessing, storeEvent } from '@/features/webhooks/event-store';

/**
 * Processamento de um evento de webhook.
 *
 * Estrutura deliberada: RECEIVE → VALIDATE → PERSIST → PROCESS. Hoje o PROCESS
 * roda dentro da requisição; a separação existe para que ele possa virar um
 * worker no Sprint 5 sem reescrever nada — o evento já está durável e tem
 * estado próprio.
 *
 * Cada evento é independente: uma falha em um não impede os outros da mesma
 * entrega.
 */

export type ProcessOutcome =
  | { result: 'PROCESSED'; detail: string }
  | { result: 'DUPLICATE'; detail: string }
  | { result: 'IGNORED'; detail: string }
  | { result: 'FAILED'; detail: string };

/**
 * Resolve o workspace pelo `phone_number_id` da metadata.
 *
 * Esta é a ÚNICA forma de determinar o tenant de um webhook. Nenhum
 * identificador de workspace vindo do payload é aceito — a Meta não conhece
 * nossos ids, e aceitar um seria entregar o tenant ao remetente.
 */
export async function resolveChannel(
  phoneNumberId: string | null,
): Promise<MessagingChannel | null> {
  if (!phoneNumberId) return null;

  return prisma.messagingChannel.findFirst({
    where: {
      phoneNumberId,
      provider: ChannelProvider.META,
      channel: ChannelKind.WHATSAPP,
    },
  });
}

export async function handleEvent(
  parsed: ParsedEvent,
  context: { signatureValid: boolean },
): Promise<ProcessOutcome> {
  const channel = await resolveChannel(parsed.metadata.phoneNumberId);

  const stored = await storeEvent(parsed, {
    workspaceId: channel?.workspaceId ?? null,
    signatureValid: context.signatureValid,
  });

  // Entrega repetida: o evento já existe. Nenhum efeito é reaplicado.
  if (!stored.isNew) {
    logger.info('webhook.duplicate_ignored', {
      provider: 'META',
      eventType: parsed.kind,
      eventId: stored.event.id,
    });
    return { result: 'DUPLICATE', detail: 'Evento já recebido anteriormente.' };
  }

  if (!channel) {
    // Número não pertence a nenhum workspace: registramos e seguimos. Não é
    // erro nosso, e devolver 500 faria a Meta reentregar para sempre.
    await markIgnored(stored.event.id, 'Nenhum canal corresponde ao phone_number_id.');
    logger.warn('webhook.unknown_channel', {
      provider: 'META',
      eventType: parsed.kind,
      phoneNumberSuffix: parsed.metadata.phoneNumberId?.slice(-4) ?? null,
    });
    return { result: 'IGNORED', detail: 'Canal desconhecido.' };
  }

  await markProcessing(stored.event.id);

  try {
    const outcome =
      parsed.kind === 'MESSAGE_STATUS_CHANGED'
        ? await applyStatusEvent(parsed, channel)
        : parsed.kind === 'INBOUND_MESSAGE'
          ? await applyInboundEvent(parsed, channel)
          : ({ result: 'IGNORED', detail: parsed.description } as const);

    if (outcome.result === 'IGNORED') {
      await markIgnored(stored.event.id, outcome.detail);
    } else {
      await markProcessed(stored.event.id);
    }

    return outcome;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Falha desconhecida';
    await markFailed(stored.event.id, detail);

    logger.error('webhook.processing_failed', {
      workspaceId: channel.workspaceId,
      eventType: parsed.kind,
      eventId: stored.event.id,
      error,
    });

    await writeAuditLog({
      action: 'webhook.failed',
      resourceType: 'WebhookEvent',
      resourceId: stored.event.id,
      workspaceId: channel.workspaceId,
      actorUserId: null,
      actorType: 'SYSTEM',
      metadata: { eventType: parsed.kind },
    });

    return { result: 'FAILED', detail };
  }
}

const STATUS_AUDIT_ACTION: Record<string, AuditAction> = {
  SENT: 'message.status_sent',
  DELIVERED: 'message.status_delivered',
  READ: 'message.status_read',
  FAILED: 'message.status_failed',
};

async function applyStatusEvent(
  event: StatusEvent,
  channel: MessagingChannel,
): Promise<ProcessOutcome> {
  const nextStatus = toInternalStatus(event.status);

  const message = await prisma.message.findFirst({
    where: {
      workspaceId: channel.workspaceId,
      providerMessageId: event.providerMessageId,
      direction: MessageDirection.OUTBOUND,
    },
  });

  // Status de uma mensagem que não conhecemos: pode ser envio feito fora do
  // produto, ou mensagem já removida. Registrado e ignorado, sem quebrar.
  if (!message) {
    logger.warn('webhook.status_for_unknown_message', {
      workspaceId: channel.workspaceId,
      status: event.status,
      providerMessageIdSuffix: event.providerMessageId.slice(-8),
    });
    return { result: 'IGNORED', detail: 'Status para mensagem desconhecida.' };
  }

  const decision = evaluateTransition(message.status, nextStatus);
  if (!decision.allowed) {
    // Webhook fora de ordem ou repetido: o estado local é preservado.
    return {
      result: 'IGNORED',
      detail: `Transição ${message.status}→${nextStatus} recusada (${decision.reason}).`,
    };
  }

  const timestampField = timestampFieldFor(nextStatus);
  const occurredAt = event.timestamp ?? new Date();
  const failure = event.errors[0];

  await prisma.message.update({
    where: { id: message.id },
    data: {
      status: nextStatus,
      ...(timestampField ? { [timestampField]: occurredAt } : {}),
      ...(failure
        ? {
            errorCode: failure.code !== null ? String(failure.code) : null,
            errorTitle: failure.title,
            errorMessage: failure.message,
            // Detalhe do provider, guardado sanitizado — sem cabeçalhos nem
            // credenciais, apenas o que descreve a falha.
            errorDetails: (failure.details
              ? { details: failure.details }
              : Prisma.JsonNull) as Prisma.InputJsonValue,
          }
        : {}),
    },
  });

  await writeAuditLog({
    action: STATUS_AUDIT_ACTION[nextStatus] ?? 'webhook.processed',
    resourceType: 'Message',
    resourceId: message.id,
    workspaceId: channel.workspaceId,
    actorUserId: null,
    actorType: 'SYSTEM',
    metadata: {
      from: message.status,
      to: nextStatus,
      ...(failure?.code ? { errorCode: failure.code } : {}),
    },
  });

  return { result: 'PROCESSED', detail: `${message.status} → ${nextStatus}` };
}

async function applyInboundEvent(
  event: Extract<ParsedEvent, { kind: 'INBOUND_MESSAGE' }>,
  channel: MessagingChannel,
): Promise<ProcessOutcome> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: channel.workspaceId },
    select: { defaultPhoneRegion: true },
  });

  const result = await processInboundMessage({
    workspaceId: channel.workspaceId,
    channelId: channel.id,
    phoneRegion: workspace.defaultPhoneRegion,
    event,
  });

  if (result.status === 'DUPLICATE') {
    return { result: 'DUPLICATE', detail: 'Mensagem já registrada.' };
  }

  if (result.conversationCreated) {
    await writeAuditLog({
      action: 'conversation.created',
      resourceType: 'Conversation',
      resourceId: result.conversationId,
      workspaceId: channel.workspaceId,
      actorUserId: null,
      actorType: 'SYSTEM',
      metadata: { contactCreated: result.contactCreated },
    });
  }

  await writeAuditLog({
    action: 'message.inbound_received',
    resourceType: 'Message',
    resourceId: result.messageId,
    workspaceId: channel.workspaceId,
    actorUserId: null,
    actorType: 'SYSTEM',
    // Nunca o conteúdo da mensagem: audit log não é arquivo de conversa.
    metadata: { conversationId: result.conversationId, type: event.messageType },
  });

  return { result: 'PROCESSED', detail: 'Mensagem recebida registrada.' };
}

export { registerOutbound };
