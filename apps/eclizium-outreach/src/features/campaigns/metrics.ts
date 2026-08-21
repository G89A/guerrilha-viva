import 'server-only';
import { RecipientEligibility, RecipientStatus } from '@prisma/client';
import { prisma } from '@/lib/db/client';

/**
 * Métricas de campanha.
 *
 * FONTE DA VERDADE: a agregação sobre `campaign_recipients`. Os contadores
 * gravados em `Campaign` são um CACHE para a listagem — nunca são incrementados
 * de forma avulsa, porque contador incrementado em vários lugares diverge sob
 * concorrência. Eles são sempre recalculados por `reconcileCampaignMetrics`,
 * a partir da mesma agregação.
 *
 * Ver ADR 0016.
 */

export interface CampaignMetrics {
  total: number;
  eligible: number;
  suppressed: number;
  invalid: number;
  ineligible: number;
  queued: number;
  sending: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  failed: number;
  cancelled: number;
  pending: number;
}

export interface CampaignRates {
  sendRate: number;
  deliveryRate: number;
  readRate: number;
  replyRate: number;
  failureRate: number;
}

function emptyMetrics(): CampaignMetrics {
  return {
    total: 0,
    eligible: 0,
    suppressed: 0,
    invalid: 0,
    ineligible: 0,
    queued: 0,
    sending: 0,
    sent: 0,
    delivered: 0,
    read: 0,
    replied: 0,
    failed: 0,
    cancelled: 0,
    pending: 0,
  };
}

const STATUS_FIELD: Record<RecipientStatus, keyof CampaignMetrics> = {
  [RecipientStatus.PENDING]: 'pending',
  [RecipientStatus.ELIGIBLE]: 'eligible',
  [RecipientStatus.SUPPRESSED]: 'suppressed',
  [RecipientStatus.INVALID]: 'invalid',
  [RecipientStatus.INELIGIBLE]: 'ineligible',
  [RecipientStatus.QUEUED]: 'queued',
  [RecipientStatus.SENDING]: 'sending',
  [RecipientStatus.SENT]: 'sent',
  [RecipientStatus.DELIVERED]: 'delivered',
  [RecipientStatus.READ]: 'read',
  [RecipientStatus.REPLIED]: 'replied',
  [RecipientStatus.FAILED]: 'failed',
  [RecipientStatus.CANCELLED]: 'cancelled',
};

/**
 * Calcula as métricas por agregação. Uma consulta, independente do tamanho da
 * campanha — não há laço percorrendo destinatários.
 */
export async function computeCampaignMetrics(
  workspaceId: string,
  campaignId: string,
): Promise<CampaignMetrics> {
  const grouped = await prisma.campaignRecipient.groupBy({
    by: ['status'],
    where: { campaignId, workspaceId },
    _count: { _all: true },
  });

  const metrics = emptyMetrics();
  for (const row of grouped) {
    metrics[STATUS_FIELD[row.status]] = row._count._all;
    metrics.total += row._count._all;
  }

  return metrics;
}

/**
 * Taxas derivadas.
 *
 * O denominador de entrega/leitura é o que realmente saiu — não o total da
 * audiência. Divisão por zero devolve 0, nunca NaN nem Infinity.
 */
export function computeRates(metrics: CampaignMetrics): CampaignRates {
  const attempted =
    metrics.sent + metrics.delivered + metrics.read + metrics.replied + metrics.failed;
  const reached = metrics.delivered + metrics.read + metrics.replied;

  return {
    sendRate: ratio(attempted - metrics.failed, metrics.eligible + attempted - metrics.failed),
    deliveryRate: ratio(reached, attempted),
    readRate: ratio(metrics.read + metrics.replied, attempted),
    replyRate: ratio(metrics.replied, attempted),
    failureRate: ratio(metrics.failed, attempted),
  };
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.min(1, Math.max(0, numerator / denominator));
}

/**
 * Recalcula os contadores da campanha a partir da agregação.
 *
 * Idempotente e seguro sob concorrência: cada execução escreve o valor
 * calculado agora, não um incremento. Duas execuções simultâneas convergem para
 * o mesmo resultado em vez de somar duas vezes.
 */
export async function reconcileCampaignMetrics(
  workspaceId: string,
  campaignId: string,
): Promise<CampaignMetrics> {
  const metrics = await computeCampaignMetrics(workspaceId, campaignId);

  await prisma.campaign.updateMany({
    where: { id: campaignId, workspaceId },
    data: {
      totalRecipients: metrics.total,
      eligibleRecipients: metrics.eligible,
      suppressedRecipients: metrics.suppressed,
      invalidRecipients: metrics.invalid,
    },
  });

  return metrics;
}

/** Motivos de bloqueio agregados, para o relatório de elegibilidade. */
export async function blockedReasonBreakdown(
  workspaceId: string,
  campaignId: string,
): Promise<Record<string, number>> {
  const rows = await prisma.campaignRecipient.findMany({
    where: { campaignId, workspaceId, eligibility: RecipientEligibility.BLOCKED },
    select: { eligibilityReasons: true },
  });

  const counts: Record<string, number> = {};
  for (const row of rows) {
    for (const reason of row.eligibilityReasons) {
      counts[reason] = (counts[reason] ?? 0) + 1;
    }
  }
  return counts;
}
