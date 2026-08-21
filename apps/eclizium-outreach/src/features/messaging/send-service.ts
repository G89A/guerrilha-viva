import 'server-only';
import type { Message } from '@prisma/client';
import {
  ChannelProvider,
  Prisma,
  MessageDirection,
  MessageStatus,
  MessageType,
  TemplateAvailability,
} from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { AppError } from '@/lib/errors/app-error';
import { logger } from '@/lib/logging/logger';
import { writeAuditLog } from '@/lib/audit/audit-log';
import { isProviderError } from '@/providers/messaging/types';
import { sendFailureMessage } from '@/providers/messaging/messages';
import { createProviderForChannel } from '@/features/messaging/credentials';
import { requireChannel } from '@/features/messaging/channel-service';
import { evaluateContactEligibility, type EligibilityResult } from '@/features/messaging/eligibility';
import { renderTemplateText, type VariableMapping } from '@/features/messaging/template-render';

/**
 * Envio unitário e manual de mensagem de teste.
 *
 * Este serviço envia UMA mensagem para UM contato. Não há laço, lista nem
 * seleção múltipla — disparo em massa é motor de campanha, que não pertence
 * a esta sprint.
 */

export interface SendTestInput {
  workspaceId: string;
  actorUserId: string;
  contactId: string;
  templateId: string;
  mapping: VariableMapping;
  /** Injetável apenas em teste; produção usa o transporte real. */
  providerOverrides?: Parameters<typeof createProviderForChannel>[1];
}

export type SendTestOutcome =
  | { ok: true; message: Message; providerMessageId: string }
  | { ok: false; kind: 'BLOCKED'; eligibility: EligibilityResult }
  | { ok: false; kind: 'FAILED'; message: Message; error: string; retryable: boolean };

/**
 * Janela de idempotência do envio manual. Duas submissões do mesmo par
 * contato+template dentro dela são a mesma intenção, não duas.
 */
const IDEMPOTENCY_WINDOW_MS = 60_000;

/**
 * Chave determinística da tentativa. O balde de tempo faz a proteção expirar
 * sozinha: repetir o envio depois da janela é uma intenção nova e legítima.
 */
export function buildIdempotencyKey(parts: {
  channelId: string;
  templateId: string;
  contactId: string;
  now?: number;
}): string {
  const bucket = Math.floor((parts.now ?? Date.now()) / IDEMPOTENCY_WINDOW_MS);
  return `test:${parts.channelId}:${parts.templateId}:${parts.contactId}:${bucket}`;
}

export async function sendTestMessage(input: SendTestInput): Promise<SendTestOutcome> {
  const channel = await requireChannel(input.workspaceId);

  const template = await prisma.messageTemplate.findFirst({
    where: { id: input.templateId, workspaceId: input.workspaceId },
  });

  const eligibility = await evaluateContactEligibility({
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    channel,
    template,
    mapping: input.mapping,
  });

  await writeAuditLog({
    action: 'messaging.test_message_attempted',
    resourceType: 'Contact',
    resourceId: input.contactId,
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    metadata: {
      templateId: input.templateId,
      eligible: eligibility.eligible,
      reasons: eligibility.reasons.map((reason) => reason.code),
    },
  });

  // Inelegível: a Meta NÃO é chamada. Nenhuma exceção a esta regra.
  if (!eligibility.eligible || !template || !eligibility.resolved) {
    return { ok: false, kind: 'BLOCKED', eligibility };
  }

  const contact = await prisma.contact.findFirstOrThrow({
    where: { id: input.contactId, workspaceId: input.workspaceId },
  });

  const renderedContent = renderTemplateText(template.body, eligibility.resolved.bodyParameters);

  // Persistir ANTES da chamada: se o processo morrer no meio, a tentativa fica
  // visível como SENDING em vez de desaparecer.
  //
  // A criação também é o ponto de idempotência: a unique em
  // (workspaceId, idempotencyKey) faz o banco recusar a segunda submissão
  // concorrente da mesma intenção, sem depender de uma leitura prévia.
  let attempt: Message;
  try {
    attempt = await prisma.message.create({
    data: {
      idempotencyKey: buildIdempotencyKey({
        channelId: channel.id,
        templateId: template.id,
        contactId: contact.id,
      }),
      workspaceId: input.workspaceId,
      channelId: channel.id,
      contactId: contact.id,
      templateId: template.id,
      createdById: input.actorUserId,
      direction: MessageDirection.OUTBOUND,
      type: MessageType.TEMPLATE,
      status: MessageStatus.SENDING,
      body: template.body,
      renderedContent,
      payload: {
        templateName: template.name,
        language: template.language,
        bodyParameters: eligibility.resolved.bodyParameters,
        headerParameters: eligibility.resolved.headerParameters,
      },
    },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw AppError.conflict(
        'Já existe um envio deste template para este contato agora há pouco. Aguarde antes de repetir.',
      );
    }
    throw error;
  }

  try {
    const provider = createProviderForChannel(channel, input.providerOverrides ?? {});
    const result = await provider.sendTemplate({
      toPhoneE164: contact.phoneE164,
      templateName: template.name,
      languageCode: template.language,
      bodyParameters: eligibility.resolved.bodyParameters,
      ...(eligibility.resolved.headerParameters.length > 0
        ? { headerParameters: eligibility.resolved.headerParameters }
        : {}),
    });

    const sent = await prisma.message.update({
      where: { id: attempt.id },
      data: {
        status: MessageStatus.SENT,
        providerMessageId: result.providerMessageId,
        sentAt: new Date(),
      },
    });

    await writeAuditLog({
      action: 'messaging.test_message_sent',
      resourceType: 'Message',
      resourceId: sent.id,
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      metadata: {
        templateId: template.id,
        contactId: contact.id,
        providerMessageId: result.providerMessageId,
      },
    });

    logger.info('messaging.test_message_sent', {
      workspaceId: input.workspaceId,
      channelId: channel.id,
      messageId: sent.id,
      provider: ChannelProvider.META,
    });

    return { ok: true, message: sent, providerMessageId: result.providerMessageId };
  } catch (error) {
    const description = describeSendFailure(error);

    const failed = await prisma.message.update({
      where: { id: attempt.id },
      data: {
        status: MessageStatus.FAILED,
        failedAt: new Date(),
        errorCode: description.code,
        errorMessage: description.message,
      },
    });

    await writeAuditLog({
      action: 'messaging.test_message_failed',
      resourceType: 'Message',
      resourceId: failed.id,
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      metadata: {
        templateId: template.id,
        contactId: contact.id,
        errorCode: description.code,
        retryable: description.retryable,
      },
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

/** Traduz a falha para algo acionável, sem stack trace e sem credencial. */
function describeSendFailure(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
} {
  if (isProviderError(error)) {
    return {
      code: error.detail?.code ? String(error.detail.code) : error.kind,
      // A mensagem da Meta é informativa, mas nunca substitui a nossa: ela é
      // texto de terceiro e vai para a UI já dentro da nossa frase.
      message: sendFailureMessage(error.kind),
      retryable: error.retryable,
    };
  }

  return { code: 'UNKNOWN', message: 'Falha inesperada ao enviar.', retryable: false };
}

/** Templates aptos a envio: aprovados e ainda existentes na Meta. */
export async function listSendableTemplates(workspaceId: string) {
  return prisma.messageTemplate.findMany({
    where: {
      workspaceId,
      status: 'APPROVED',
      availability: TemplateAvailability.AVAILABLE,
    },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, language: true, body: true, variables: true },
  });
}
