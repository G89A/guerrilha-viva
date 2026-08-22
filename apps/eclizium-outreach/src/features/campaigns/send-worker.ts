import 'server-only';
import type { Job } from '@prisma/client';
import {
  CampaignStatus,
  ConsentChannel,
  MessageDirection,
  MessageStatus,
  MessageType,
  type Prisma,
  RecipientEligibility,
  RecipientStatus,
} from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging/logger';
import { isProviderError } from '@/providers/messaging/types';
import { sendFailureMessage } from '@/providers/messaging/messages';
import { createProviderForChannel } from '@/features/messaging/credentials';
import type { VariableMapping } from '@/features/messaging/template-render';
import {
  buildEligibilityContext,
  evaluateCampaignRecipientEligibility,
} from '@/features/campaigns/eligibility';
import type { AudienceContact } from '@/features/campaigns/audience-service';
import { channelBucketKey, consumeToken } from '@/features/queue/rate-limiter';
import { getSendingPolicy } from '@/features/protection/policy-service';
import { evaluateGuardrails } from '@/features/protection/guardrails';

/**
 * Envio de UM destinatário de campanha.
 *
 * REGRA CENTRAL DESTA SPRINT: a elegibilidade gravada na preparação é um
 * RETRATO DO PASSADO e não decide nada aqui. Entre preparar e disparar, o
 * contato pode ter revogado consentimento, pedido opt-out, sido arquivado ou
 * ter o telefone corrigido — e a campanha pode ter sido pausada.
 *
 * Por isso o worker relê tudo do banco e reavalia antes de cada chamada. O
 * payload do job carrega apenas identificadores.
 */

export interface SendJobPayload {
  campaignId: string;
  recipientId: string;
}

export type SendOutcome =
  | { result: 'SENT'; providerMessageId: string }
  /**
   * `permanent: false` significa que o motivo é temporário — tipicamente a
   * campanha ter sido pausada. Nesse caso o job é DESCARTADO em vez de
   * concluído, para que retomar possa recriá-lo: concluir queimaria a chave de
   * idempotência e aquele destinatário nunca mais sairia.
   */
  | { result: 'SKIPPED'; reason: string; permanent: boolean }
  | { result: 'RATE_LIMITED'; retryAfterMs: number }
  | { result: 'FAILED'; error: string; errorCode: string; retryable: boolean };

export function parseSendPayload(payload: unknown): SendJobPayload | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  const campaignId = record.campaignId;
  const recipientId = record.recipientId;

  if (typeof campaignId !== 'string' || typeof recipientId !== 'string') return null;
  return { campaignId, recipientId };
}

export interface ProcessOptions {
  /** Injetável só em teste; produção usa o transporte real. */
  providerOverrides?: Parameters<typeof createProviderForChannel>[1];
  now?: Date;
}

export async function processSendJob(
  job: Job,
  options: ProcessOptions = {},
): Promise<SendOutcome> {
  const payload = parseSendPayload(job.payload);
  if (!payload) {
    return {
      result: 'FAILED',
      error: 'Payload do job inválido.',
      errorCode: 'INVALID_PAYLOAD',
      // Payload quebrado não melhora com repetição.
      retryable: false,
    };
  }

  const now = options.now ?? new Date();

  // Tudo relido do banco, escopado ao workspace do job.
  const recipient = await prisma.campaignRecipient.findFirst({
    where: {
      id: payload.recipientId,
      campaignId: payload.campaignId,
      workspaceId: job.workspaceId,
    },
    include: { campaign: { include: { template: true, channelRef: true } } },
  });

  if (!recipient) {
    return { result: 'SKIPPED', reason: 'Destinatário não encontrado.', permanent: true };
  }

  const campaign = recipient.campaign;

  // A campanha pode ter sido pausada ou cancelada depois do enfileiramento.
  if (campaign.status !== CampaignStatus.RUNNING) {
    // Pausa é reversível: o job sai da fila sem queimar a chave, para que
    // retomar consiga recriá-lo.
    const reversible = campaign.status === CampaignStatus.PAUSED;
    return {
      result: 'SKIPPED',
      reason: `Campanha está ${campaign.status}, não em execução.`,
      permanent: !reversible,
    };
  }

  // Já enviado: um retry não pode gerar segunda mensagem.
  if (
    (
      [
        RecipientStatus.SENT,
        RecipientStatus.DELIVERED,
        RecipientStatus.READ,
        RecipientStatus.REPLIED,
      ] as RecipientStatus[]
    ).includes(recipient.status)
  ) {
    return { result: 'SKIPPED', reason: 'Destinatário já recebeu a mensagem.', permanent: true };
  }

  if (recipient.status === RecipientStatus.CANCELLED) {
    return { result: 'SKIPPED', reason: 'Destinatário cancelado.', permanent: true };
  }

  // --- Reverificação de elegibilidade com dados FRESCOS ---------------------
  const contact = await prisma.contact.findFirst({
    where: { id: recipient.contactId, workspaceId: job.workspaceId },
    select: {
      id: true,
      phoneE164: true,
      firstName: true,
      lastName: true,
      company: true,
      city: true,
      segment: true,
      status: true,
      consents: {
        where: { channel: ConsentChannel.WHATSAPP },
        select: { channel: true, status: true },
      },
      suppressions: { select: { id: true }, take: 1 },
    },
  });

  if (!contact) {
    await blockRecipient(recipient.id, ['CONTACT_NOT_FOUND'], RecipientStatus.INELIGIBLE);
    return {
      result: 'SKIPPED',
      reason: 'Contato removido depois da preparação.',
      permanent: true,
    };
  }

  const context = buildEligibilityContext({
    channel: campaign.channelRef,
    template: campaign.template,
    mapping: campaign.variableMap as unknown as VariableMapping,
    variablePolicy: campaign.variablePolicy,
    variableFallbacks: campaign.variableFallbacks as unknown as Record<string, string>,
  });

  const evaluation = evaluateCampaignRecipientEligibility(contact as AudienceContact, context);

  if (!evaluation.eligible || !evaluation.resolved) {
    // O estado mudou desde a preparação. Registrar o motivo atual é o que
    // permite explicar depois por que aquela pessoa não recebeu.
    await blockRecipient(recipient.id, evaluation.reasons, evaluation.status);

    logger.info('campaign.recipient_blocked_at_send', {
      workspaceId: job.workspaceId,
      campaignId: campaign.id,
      recipientId: recipient.id,
      reasons: evaluation.reasons,
    });

    return {
      result: 'SKIPPED',
      reason: `Bloqueado na reverificação: ${evaluation.reasons.join(', ')}.`,
      permanent: true,
    };
  }

  const channel = campaign.channelRef;
  const template = campaign.template;
  if (!channel || !template) {
    return { result: 'SKIPPED', reason: 'Canal ou template indisponível.', permanent: true };
  }

  // --- Freios de proteção ---------------------------------------------------
  //
  // Rodam DEPOIS da reverificação de elegibilidade e ANTES de gastar token de
  // vazão: adiar um envio por horário silencioso não pode consumir cota, e
  // bloquear por frequência não pode aparecer como problema de vazão.
  const policy = await getSendingPolicy(job.workspaceId);
  const guardrail = await evaluateGuardrails({
    workspaceId: job.workspaceId,
    contactId: contact.id,
    policy,
    quality: channel.qualityRating,
    now,
  });

  if (!guardrail.allow) {
    if (guardrail.kind === 'DEFER') {
      // Reaproveita o caminho de vazão: volta para a fila sem gastar tentativa
      // e sem tocar no destinatário — não é falha dele nem nossa.
      logger.info('campaign.send_deferred', {
        workspaceId: job.workspaceId,
        campaignId: campaign.id,
        reason: guardrail.reason,
      });
      return { result: 'RATE_LIMITED', retryAfterMs: guardrail.retryAtMs };
    }

    await blockRecipient(recipient.id, [guardrail.reason], RecipientStatus.INELIGIBLE);

    logger.info('campaign.send_blocked_by_policy', {
      workspaceId: job.workspaceId,
      campaignId: campaign.id,
      recipientId: recipient.id,
      reason: guardrail.reason,
    });

    return { result: 'SKIPPED', reason: guardrail.reason, permanent: true };
  }

  // --- Vazão ----------------------------------------------------------------
  const token = await consumeToken({
    key: channelBucketKey(channel.id),
    workspaceId: job.workspaceId,
    ratePerSecond: channel.messagesPerSecond,
    burst: channel.sendBurst,
    now,
  });

  if (!token.allowed) {
    // Não é falha: o job volta para a fila quando houver vazão.
    return { result: 'RATE_LIMITED', retryAfterMs: token.retryAfterMs };
  }

  // --- Envio ----------------------------------------------------------------
  await prisma.campaignRecipient.updateMany({
    where: { id: recipient.id, workspaceId: job.workspaceId },
    data: { status: RecipientStatus.SENDING, sendingAt: now, attemptCount: { increment: 1 } },
  });

  try {
    const provider = createProviderForChannel(channel, options.providerOverrides ?? {});
    const result = await provider.sendTemplate({
      toPhoneE164: contact.phoneE164,
      templateName: template.name,
      languageCode: template.language,
      bodyParameters: evaluation.resolved.bodyParameters,
      ...(evaluation.resolved.headerParameters.length > 0
        ? { headerParameters: evaluation.resolved.headerParameters }
        : {}),
    });

    await recordSentMessage({
      workspaceId: job.workspaceId,
      campaign,
      recipient,
      contactId: contact.id,
      channelId: channel.id,
      templateId: template.id,
      body: template.body,
      rendered: evaluation.preview,
      providerMessageId: result.providerMessageId,
      bodyParameters: evaluation.resolved.bodyParameters,
      now,
    });

    return { result: 'SENT', providerMessageId: result.providerMessageId };
  } catch (error) {
    const described = describeFailure(error);

    await prisma.campaignRecipient.updateMany({
      where: { id: recipient.id, workspaceId: job.workspaceId },
      data: {
        // Retentável volta para ELIGIBLE: ainda pode sair na próxima tentativa.
        status: described.retryable ? RecipientStatus.ELIGIBLE : RecipientStatus.FAILED,
        ...(described.retryable ? {} : { failedAt: now }),
        failureCode: described.errorCode,
        failureReason: described.error,
      },
    });

    return {
      result: 'FAILED',
      error: described.error,
      errorCode: described.errorCode,
      retryable: described.retryable,
    };
  }
}

async function blockRecipient(
  recipientId: string,
  reasons: string[],
  status: RecipientStatus,
): Promise<void> {
  await prisma.campaignRecipient.updateMany({
    where: { id: recipientId },
    data: {
      status,
      eligibility: RecipientEligibility.BLOCKED,
      eligibilityReasons: reasons,
    },
  });
}

/**
 * Grava a mensagem enviada e marca o destinatário.
 *
 * A unique `(workspaceId, idempotencyKey)` em Message é a última barreira: se
 * dois workers chegarem aqui para o mesmo destinatário, o banco recusa a
 * segunda inserção e nenhuma mensagem duplicada é contabilizada.
 */
async function recordSentMessage(input: {
  workspaceId: string;
  campaign: { id: string };
  recipient: { id: string; idempotencyKey: string };
  contactId: string;
  channelId: string;
  templateId: string;
  body: string;
  rendered: string | null;
  providerMessageId: string;
  bodyParameters: string[];
  now: Date;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.message.createMany({
      skipDuplicates: true,
      data: [
        {
          workspaceId: input.workspaceId,
          channelId: input.channelId,
          contactId: input.contactId,
          campaignId: input.campaign.id,
          recipientId: input.recipient.id,
          templateId: input.templateId,
          direction: MessageDirection.OUTBOUND,
          type: MessageType.TEMPLATE,
          status: MessageStatus.SENT,
          body: input.body,
          renderedContent: input.rendered,
          providerMessageId: input.providerMessageId,
          sentAt: input.now,
          idempotencyKey: input.recipient.idempotencyKey,
          payload: {
            bodyParameters: input.bodyParameters,
          } as unknown as Prisma.InputJsonValue,
        },
      ],
    });

    await tx.campaignRecipient.updateMany({
      where: { id: input.recipient.id, workspaceId: input.workspaceId },
      data: {
        status: RecipientStatus.SENT,
        sentAt: input.now,
        providerMessageId: input.providerMessageId,
        failureCode: null,
        failureReason: null,
      },
    });
  });
}

function describeFailure(error: unknown): {
  error: string;
  errorCode: string;
  retryable: boolean;
} {
  if (isProviderError(error)) {
    return {
      error: sendFailureMessage(error.kind),
      errorCode: error.detail?.code ? String(error.detail.code) : error.kind,
      // A classificação vem do provider (Sprint 2), não de adivinhação aqui.
      retryable: error.retryable,
    };
  }

  return {
    error: 'Falha inesperada ao enviar.',
    errorCode: 'UNKNOWN',
    retryable: false,
  };
}
