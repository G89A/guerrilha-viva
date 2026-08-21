import 'server-only';
import { CampaignStatus, JobType, RecipientEligibility, RecipientStatus } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { AppError } from '@/lib/errors/app-error';
import { logger } from '@/lib/logging/logger';
import { cancelPendingJobs, deletePendingJobs, enqueueMany, queueDepth } from '@/features/queue/job-store';

/**
 * Execução de campanha.
 *
 * O motor NÃO envia nada aqui: ele coloca um job por destinatário elegível na
 * fila. Quem envia é o worker, que relê tudo e reavalia a elegibilidade antes
 * de cada chamada ao provider.
 *
 * A separação é o que impede uma Route Handler de disparar milhares de
 * requisições dentro de uma requisição HTTP.
 */

export interface EnqueueResult {
  campaignId: string;
  /** Jobs criados agora. Zero numa reenfileirada idêntica. */
  queued: number;
  /** Destinatários elegíveis considerados. */
  eligible: number;
}

export interface CampaignExecutionService {
  enqueueCampaign(workspaceId: string, campaignId: string): Promise<EnqueueResult>;
  pauseCampaignJobs(workspaceId: string, campaignId: string): Promise<number>;
  cancelCampaignJobs(workspaceId: string, campaignId: string): Promise<number>;
}

/** Prefixo das chaves de idempotência dos jobs de uma campanha. */
export function campaignJobPrefix(campaignId: string): string {
  return `campaign-send:${campaignId}:`;
}

/** Chave determinística: reenfileirar o mesmo destinatário não cria job novo. */
export function sendJobKey(campaignId: string, recipientId: string): string {
  return `${campaignJobPrefix(campaignId)}${recipientId}`;
}

/** Quantos destinatários carregar por vez ao enfileirar. */
const ENQUEUE_CHUNK = 500;

export const queueExecutionService: CampaignExecutionService = {
  /**
   * Enfileira os destinatários elegíveis, em blocos e por cursor.
   *
   * Idempotente: a unique de `Job.idempotencyKey` faz reenfileirar não duplicar,
   * então chamar duas vezes — ou retomar uma campanha pausada — é seguro.
   */
  async enqueueCampaign(workspaceId: string, campaignId: string): Promise<EnqueueResult> {
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, workspaceId },
      select: { id: true, status: true },
    });
    if (!campaign) throw AppError.notFound('Campanha não encontrada.');

    if (campaign.status !== CampaignStatus.RUNNING) {
      throw AppError.conflict(
        'Só uma campanha em execução pode ser enfileirada.',
        { currentStatus: campaign.status },
      );
    }

    let cursor: string | null = null;
    let queued = 0;
    let eligible = 0;

    for (;;) {
      const recipients: Array<{ id: string }> = await prisma.campaignRecipient.findMany({
        where: {
          campaignId,
          workspaceId,
          eligibility: RecipientEligibility.ELIGIBLE,
          // Quem já saiu, falhou ou foi cancelado não volta para a fila.
          status: { in: [RecipientStatus.ELIGIBLE, RecipientStatus.QUEUED] },
        },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: ENQUEUE_CHUNK,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (recipients.length === 0) break;
      eligible += recipients.length;

      queued += await enqueueMany(
        recipients.map((recipient) => ({
          workspaceId,
          type: JobType.CAMPAIGN_SEND,
          // Só identificadores: o worker relê tudo do banco.
          payload: { campaignId, recipientId: recipient.id },
          idempotencyKey: sendJobKey(campaignId, recipient.id),
        })),
      );

      await prisma.campaignRecipient.updateMany({
        where: {
          id: { in: recipients.map((recipient) => recipient.id) },
          workspaceId,
          status: RecipientStatus.ELIGIBLE,
        },
        data: { status: RecipientStatus.QUEUED, queuedAt: new Date() },
      });

      cursor = recipients[recipients.length - 1]?.id ?? null;
      if (recipients.length < ENQUEUE_CHUNK) break;
    }

    logger.info('campaign.enqueued', { workspaceId, campaignId, queued, eligible });
    return { campaignId, queued, eligible };
  },

  /**
   * Pausar remove os jobs pendentes da fila.
   *
   * O worker já checa o status da campanha antes de cada envio, então isto é
   * defesa em profundidade — e evita que a fila carregue trabalho morto.
   */
  async pauseCampaignJobs(workspaceId: string, campaignId: string): Promise<number> {
    // APAGA em vez de marcar como morto: um job morto mantém a chave de
    // idempotência ocupada, e o reenfileiramento do resume o pularia para
    // sempre — o destinatário nunca mais sairia. O trabalho é integralmente
    // recriável a partir das linhas de CampaignRecipient.
    const cancelled = await deletePendingJobs(workspaceId, campaignJobPrefix(campaignId));

    // Destinatários voltam a ELIGIBLE para poderem ser reenfileirados no resume.
    await prisma.campaignRecipient.updateMany({
      where: { campaignId, workspaceId, status: RecipientStatus.QUEUED },
      data: { status: RecipientStatus.ELIGIBLE, queuedAt: null },
    });

    return cancelled;
  },

  async cancelCampaignJobs(workspaceId: string, campaignId: string): Promise<number> {
    return cancelPendingJobs(workspaceId, campaignJobPrefix(campaignId));
  },
};

export interface CampaignQueueStatus {
  pending: number;
  leased: number;
  done: number;
  failed: number;
  dead: number;
}

export async function campaignQueueStatus(
  workspaceId: string,
  campaignId: string,
): Promise<CampaignQueueStatus> {
  return queueDepth(workspaceId, campaignJobPrefix(campaignId));
}

/** A execução existe a partir da Sprint 5. */
export const EXECUTION_AVAILABLE = true;
