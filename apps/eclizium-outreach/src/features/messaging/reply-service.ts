import 'server-only';
import type { Message } from '@prisma/client';
import {
  ContactStatus,
  MessageDirection,
  MessageStatus,
  MessageType,
  type Prisma,
} from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { AppError } from '@/lib/errors/app-error';
import { logger } from '@/lib/logging/logger';
import { writeAuditLog } from '@/lib/audit/audit-log';
import { isProviderError } from '@/providers/messaging/types';
import { sendFailureMessage } from '@/providers/messaging/messages';
import { createProviderForChannel } from '@/features/messaging/credentials';
import { registerOutbound, serviceWindow } from '@/features/messaging/conversation-service';
import { suppressedPhoneSet } from '@/features/suppression/service';
import { MAX_REPLY_LENGTH } from '@/features/messaging/reply-constants';

/**
 * Resposta manual dentro de uma conversa.
 *
 * Usa texto livre, o que a Meta só permite dentro da janela de atendimento de
 * 24 horas contadas da última mensagem do contato. Fora dela, a plataforma
 * exige template — e este serviço recusa em vez de tentar e falhar.
 *
 * A janela é CALCULADA a partir de `lastInboundAt`, nunca presumida aberta.
 */

export type ReplyOutcome =
  | { ok: true; message: Message; providerMessageId: string }
  | { ok: false; kind: 'BLOCKED'; reason: string }
  | { ok: false; kind: 'FAILED'; message: Message; error: string; retryable: boolean };


export async function sendReply(input: {
  workspaceId: string;
  actorUserId: string;
  conversationId: string;
  text: string;
  providerOverrides?: Parameters<typeof createProviderForChannel>[1];
}): Promise<ReplyOutcome> {
  const text = input.text.trim();
  if (text.length === 0) {
    throw AppError.validation('Escreva uma mensagem.', { text: ['Escreva uma mensagem.'] });
  }
  if (text.length > MAX_REPLY_LENGTH) {
    throw AppError.validation(`Mensagem acima de ${MAX_REPLY_LENGTH} caracteres.`, {
      text: ['Mensagem longa demais.'],
    });
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: input.conversationId, workspaceId: input.workspaceId },
    include: { contact: true, channel: true },
  });
  if (!conversation) throw AppError.notFound('Conversa não encontrada.');

  // As mesmas verificações de compliance do envio de campanha valem aqui.
  if (conversation.contact.status !== ContactStatus.ACTIVE) {
    return { ok: false, kind: 'BLOCKED', reason: 'O contato não está ativo.' };
  }

  const suppressed = await suppressedPhoneSet(input.workspaceId, [conversation.contact.phoneE164]);
  if (suppressed.has(conversation.contact.phoneE164)) {
    return {
      ok: false,
      kind: 'BLOCKED',
      reason: 'O contato está na lista de supressão e não pode receber mensagens.',
    };
  }

  if (conversation.channel.status !== 'CONNECTED') {
    return { ok: false, kind: 'BLOCKED', reason: 'O canal WhatsApp não está conectado.' };
  }

  const window = serviceWindow(conversation.lastInboundAt);
  if (!window.open) {
    return {
      ok: false,
      kind: 'BLOCKED',
      reason:
        'A janela de 24 horas desde a última mensagem do contato expirou. A Meta só permite ' +
        'template fora dessa janela.',
    };
  }

  const now = new Date();
  const attempt = await prisma.message.create({
    data: {
      workspaceId: input.workspaceId,
      channelId: conversation.channelId,
      conversationId: conversation.id,
      contactId: conversation.contactId,
      createdById: input.actorUserId,
      direction: MessageDirection.OUTBOUND,
      type: MessageType.TEXT,
      // Persistido antes da chamada: uma queda no meio deixa rastro.
      status: MessageStatus.SENDING,
      body: text,
      renderedContent: text,
      payload: { source: 'inbox_reply' } as unknown as Prisma.InputJsonValue,
    },
  });

  try {
    const provider = createProviderForChannel(conversation.channel, input.providerOverrides ?? {});
    if (!provider.sendText) {
      throw AppError.notConfigured('O provider não suporta mensagem de texto.');
    }

    const result = await provider.sendText({
      toPhoneE164: conversation.contact.phoneE164,
      text,
    });

    const sent = await prisma.message.update({
      where: { id: attempt.id },
      data: {
        status: MessageStatus.SENT,
        providerMessageId: result.providerMessageId,
        sentAt: now,
      },
    });

    await registerOutbound(conversation.id, now);

    await writeAuditLog({
      action: 'message.reply_sent',
      resourceType: 'Message',
      resourceId: sent.id,
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      // Nunca o conteúdo: o audit log não é arquivo de conversa.
      metadata: { conversationId: conversation.id, length: text.length },
    });

    return { ok: true, message: sent, providerMessageId: result.providerMessageId };
  } catch (error) {
    const description = isProviderError(error)
      ? {
          code: error.detail?.code ? String(error.detail.code) : error.kind,
          message: sendFailureMessage(error.kind),
          retryable: error.retryable,
        }
      : { code: 'UNKNOWN', message: 'Falha inesperada ao enviar.', retryable: false };

    const failed = await prisma.message.update({
      where: { id: attempt.id },
      data: {
        status: MessageStatus.FAILED,
        failedAt: new Date(),
        errorCode: description.code,
        errorMessage: description.message,
      },
    });

    logger.warn('inbox.reply_failed', {
      workspaceId: input.workspaceId,
      conversationId: conversation.id,
      errorCode: description.code,
    });

    return {
      ok: false,
      kind: 'FAILED',
      message: failed,
      error: description.message,
      retryable: description.retryable,
    };
  }
}
