import 'server-only';
import type { MessagingChannel } from '@prisma/client';
import {
  ChannelKind,
  ChannelProvider,
  JobType,
  MessageDirection,
  Prisma,
  WebhookEventStatus,
} from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging/logger';
import { writeAuditLog, type AuditAction } from '@/lib/audit/audit-log';
import {
  evaluateTransition,
  timestampFieldFor,
  toInternalStatus,
} from '@/features/messaging/message-status';
import { processInboundMessage } from '@/features/messaging/inbound-service';
import { handlePossibleOptOut } from '@/features/protection/opt-out-service';
import { registerOutbound } from '@/features/messaging/conversation-service';
import type { ParsedEvent, StatusEvent } from '@/features/webhooks/parser';
import {
  claimEvent,
  markFailed,
  markIgnored,
  markProcessed,
  storeEvent,
} from '@/features/webhooks/event-store';
import { deserializeEvent } from '@/features/webhooks/event-codec';
import { enqueueJob, resetJobForRetry } from '@/features/queue/job-store';

/**
 * Processamento de um evento de webhook.
 *
 * Estrutura: RECEIVE → VALIDATE → PERSIST → ENQUEUE, e o PROCESS acontece no
 * worker (Sprint 6). A rota devolve 200 assim que o evento está durável e
 * enfileirado; uma rajada da Meta não ocupa mais o handler, e um erro de
 * processamento vira retentativa com backoff em vez de evento perdido.
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

export type IngestOutcome =
  | { result: 'QUEUED'; eventId: string }
  | { result: 'DUPLICATE'; eventId: string }
  | { result: 'IGNORED'; eventId: string; detail: string };

/** Chave determinística do job: um evento gera no máximo um job. */
export function webhookJobKey(eventId: string): string {
  return `webhook-event:${eventId}`;
}

/**
 * Prioridade acima do disparo de campanha.
 *
 * Uma mensagem recebida é alguém esperando resposta; uma campanha de dez mil
 * envios pode esperar alguns segundos. Sem isso, um disparo grande empurraria
 * toda a Inbox para o fim da fila.
 */
export const WEBHOOK_JOB_PRIORITY = 10;

/**
 * Recebe o evento: resolve o tenant, persiste e enfileira. Não aplica efeito.
 *
 * O que decide o workspace é o `phone_number_id` da metadata, resolvido contra
 * os canais cadastrados. Nenhum identificador vindo do payload é aceito.
 */
export async function ingestEvent(
  parsed: ParsedEvent,
  context: { signatureValid: boolean },
): Promise<IngestOutcome> {
  const channel = await resolveChannel(parsed.metadata.phoneNumberId);

  const stored = await storeEvent(parsed, {
    workspaceId: channel?.workspaceId ?? null,
    signatureValid: context.signatureValid,
  });

  // Entrega repetida: o evento já existe. Nenhum efeito é reaplicado e nenhum
  // job novo é criado.
  if (!stored.isNew) {
    logger.info('webhook.duplicate_ignored', {
      provider: 'META',
      eventType: parsed.kind,
      eventId: stored.event.id,
    });
    return { result: 'DUPLICATE', eventId: stored.event.id };
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
    return { result: 'IGNORED', eventId: stored.event.id, detail: 'Canal desconhecido.' };
  }

  await enqueueJob({
    workspaceId: channel.workspaceId,
    type: JobType.WEBHOOK_EVENT,
    idempotencyKey: webhookJobKey(stored.event.id),
    payload: { eventId: stored.event.id },
    priority: WEBHOOK_JOB_PRIORITY,
  });

  return { result: 'QUEUED', eventId: stored.event.id };
}

/**
 * Reenfileira um evento para processamento.
 *
 * Usado pelo reprocessamento manual. Deliberadamente NÃO processa em linha: há
 * um caminho de processamento só — o worker — e mantê-lo único é o que garante
 * que reprocessar pela tela se comporte igual ao processamento normal.
 */
export async function requeueEvent(
  workspaceId: string,
  eventId: string,
): Promise<{ requeued: boolean; reason?: string }> {
  const event = await prisma.webhookEvent.findFirst({
    where: { id: eventId, workspaceId },
    select: { id: true, status: true },
  });
  if (!event) return { requeued: false, reason: 'Evento não encontrado neste workspace.' };

  if (
    event.status === WebhookEventStatus.PROCESSED ||
    event.status === WebhookEventStatus.IGNORED
  ) {
    return { requeued: false, reason: 'Evento já concluído; reprocessar não teria efeito.' };
  }

  // O job anterior pode ter morrido na carta morta. Reativá-lo em uma instrução
  // é o caminho seguro: apagar para recriar abre corrida entre dois pedidos de
  // reprocessamento simultâneos.
  const revived = await resetJobForRetry({
    idempotencyKey: webhookJobKey(eventId),
    priority: WEBHOOK_JOB_PRIORITY,
  });

  if (!revived) {
    await enqueueJob({
      workspaceId,
      type: JobType.WEBHOOK_EVENT,
      idempotencyKey: webhookJobKey(eventId),
      payload: { eventId },
      priority: WEBHOOK_JOB_PRIORITY,
    });
  }

  return { requeued: true };
}

/**
 * Aplica o efeito de um evento já persistido. É o ÚNICO caminho de
 * processamento — worker e reprocessamento manual passam por aqui.
 */
export async function processStoredEvent(eventId: string): Promise<ProcessOutcome> {
  const event = await prisma.webhookEvent.findUnique({ where: { id: eventId } });
  if (!event) return { result: 'IGNORED', detail: 'Evento não existe mais.' };

  // Compare-and-set: PROCESSED e IGNORED são terminais. Um job reentregue
  // depois do evento já concluído não reaplica nada.
  const claimed = await claimEvent(event.id);
  if (!claimed) {
    return { result: 'DUPLICATE', detail: `Evento já em estado ${event.status}.` };
  }

  const parsed = deserializeEvent(event.eventType, event.payload);
  if (!parsed) {
    // Payload que não sabemos reconstruir não melhora com retentativa.
    await markIgnored(event.id, 'Payload gravado não pôde ser reconstruído.');
    return { result: 'IGNORED', detail: 'Payload irreconstruível.' };
  }

  const channel = await resolveChannel(parsed.metadata.phoneNumberId);

  if (!channel) {
    await markIgnored(event.id, 'Nenhum canal corresponde ao phone_number_id.');
    return { result: 'IGNORED', detail: 'Canal desconhecido.' };
  }

  // O canal pode ter sido movido de workspace entre a recepção e o
  // processamento. Aplicar o efeito no tenant errado seria pior que ignorar.
  if (event.workspaceId && event.workspaceId !== channel.workspaceId) {
    await markIgnored(event.id, 'Canal pertence a outro workspace agora.');
    logger.warn('webhook.workspace_mismatch', { eventId: event.id });
    return { result: 'IGNORED', detail: 'Canal mudou de workspace.' };
  }

  try {
    const outcome =
      parsed.kind === 'MESSAGE_STATUS_CHANGED'
        ? await applyStatusEvent(parsed, channel)
        : parsed.kind === 'INBOUND_MESSAGE'
          ? await applyInboundEvent(parsed, channel)
          : ({ result: 'IGNORED', detail: parsed.description } as const);

    if (outcome.result === 'IGNORED') {
      await markIgnored(event.id, outcome.detail);
    } else {
      await markProcessed(event.id);
    }

    return outcome;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Falha desconhecida';
    await markFailed(event.id, detail);

    logger.error('webhook.processing_failed', {
      workspaceId: channel.workspaceId,
      eventType: parsed.kind,
      eventId: event.id,
      error,
    });

    await writeAuditLog({
      action: 'webhook.failed',
      resourceType: 'WebhookEvent',
      resourceId: event.id,
      workspaceId: channel.workspaceId,
      actorUserId: null,
      actorType: 'SYSTEM',
      metadata: { eventType: parsed.kind },
    });

    // Relança para o worker classificar e reagendar: engolir aqui faria o job
    // ser dado como concluído e o evento nunca mais seria tentado.
    throw error;
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

  /*
   * Descadastro pedido pelo contato.
   *
   * Roda depois da mensagem já estar gravada, e fora da transação de recepção:
   * é efeito adicional, e uma falha aqui não pode desfazer o registro do que a
   * pessoa escreveu. Se falhar, o evento vira retentativa — e reaplicar é
   * inofensivo, porque a supressão é idempotente.
   */
  const optOut = await handlePossibleOptOut({
    workspaceId: channel.workspaceId,
    contactId: result.contactId,
    phoneE164: result.phoneE164,
    body: event.text,
  });

  if (optOut.applied) {
    logger.info('webhook.opt_out_from_inbound', {
      workspaceId: channel.workspaceId,
      conversationId: result.conversationId,
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
