import 'server-only';
import { WebhookEventStatus } from '@prisma/client';
import { prisma } from '@/lib/db/client';

/**
 * Estado da recepção de webhooks, para a tela de integrações.
 *
 * Existe porque evento falho que ninguém vê é evento perdido: desde a Sprint 6
 * o processamento é assíncrono, então o operador precisa de um lugar onde
 * conste o que não foi aplicado — e de um botão para tentar de novo.
 */

export interface WebhookEventSummary {
  received: number;
  processing: number;
  processed: number;
  ignored: number;
  failed: number;
  lastReceivedAt: Date | null;
}

export async function webhookEventSummary(workspaceId: string): Promise<WebhookEventSummary> {
  const [grouped, last] = await Promise.all([
    prisma.webhookEvent.groupBy({
      by: ['status'],
      where: { workspaceId },
      _count: { _all: true },
    }),
    prisma.webhookEvent.findFirst({
      where: { workspaceId },
      orderBy: { receivedAt: 'desc' },
      select: { receivedAt: true },
    }),
  ]);

  const count = (status: WebhookEventStatus): number =>
    grouped.find((entry) => entry.status === status)?._count._all ?? 0;

  return {
    received: count(WebhookEventStatus.RECEIVED),
    processing: count(WebhookEventStatus.PROCESSING),
    processed: count(WebhookEventStatus.PROCESSED),
    ignored: count(WebhookEventStatus.IGNORED),
    failed: count(WebhookEventStatus.FAILED),
    lastReceivedAt: last?.receivedAt ?? null,
  };
}

export interface FailedWebhookEvent {
  id: string;
  eventType: string | null;
  errorMessage: string | null;
  receivedAt: Date;
  failedAt: Date | null;
}

/** Eventos que não puderam ser aplicados. Os mais recentes primeiro. */
export async function listFailedEvents(
  workspaceId: string,
  take = 20,
): Promise<FailedWebhookEvent[]> {
  return prisma.webhookEvent.findMany({
    where: { workspaceId, status: WebhookEventStatus.FAILED },
    orderBy: { failedAt: 'desc' },
    take,
    select: {
      id: true,
      eventType: true,
      errorMessage: true,
      receivedAt: true,
      failedAt: true,
    },
  });
}
