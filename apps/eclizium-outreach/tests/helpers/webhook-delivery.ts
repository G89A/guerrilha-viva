import { WebhookEventStatus } from '@prisma/client';
import { parseWebhookPayload } from '@/features/webhooks/parser';
import { ingestEvent } from '@/features/webhooks/processor';
import { drainQueue } from '@/features/queue/worker';
import { testPrisma } from './db';

/**
 * Entrega um payload como a rota faria e roda o worker até drenar.
 *
 * Desde a Sprint 6 a rota só persiste e enfileira; quem aplica o efeito é o
 * worker. O teste passa pelos DOIS passos de propósito — testar só a ingestão
 * deixaria de fora exatamente o caminho que roda em produção.
 */

export type DeliveredOutcome = 'PROCESSED' | 'DUPLICATE' | 'IGNORED' | 'FAILED' | 'PENDING';

export interface DeliveryResult {
  /** Motivo da recusa no parse, quando o payload nem chega a virar evento. */
  rejected: string | null;
  outcomes: DeliveredOutcome[];
  eventIds: string[];
}

export async function deliverPayload(payload: unknown): Promise<DeliveryResult> {
  const rawBody = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const parsed = parseWebhookPayload(rawBody);
  if (!parsed.ok) return { rejected: parsed.reason, outcomes: [], eventIds: [] };

  const ingested: Array<{ eventId: string; duplicate: boolean }> = [];
  for (const event of parsed.events) {
    const outcome = await ingestEvent(event, { signatureValid: true });
    ingested.push({ eventId: outcome.eventId, duplicate: outcome.result === 'DUPLICATE' });
  }

  await drainQueue({ workerId: 'test-webhook-worker' });

  const events = await testPrisma().webhookEvent.findMany({
    where: { id: { in: ingested.map((entry) => entry.eventId) } },
    select: { id: true, status: true },
  });
  const statusById = new Map(events.map((event) => [event.id, event.status]));

  return {
    rejected: null,
    eventIds: ingested.map((entry) => entry.eventId),
    outcomes: ingested.map((entry) => {
      if (entry.duplicate) return 'DUPLICATE';
      const status = statusById.get(entry.eventId);
      if (status === WebhookEventStatus.PROCESSED) return 'PROCESSED';
      if (status === WebhookEventStatus.IGNORED) return 'IGNORED';
      if (status === WebhookEventStatus.FAILED) return 'FAILED';
      return 'PENDING';
    }),
  };
}
