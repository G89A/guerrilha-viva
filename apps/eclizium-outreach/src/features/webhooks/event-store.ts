import 'server-only';
import type { WebhookEvent } from '@prisma/client';
import { ChannelProvider, Prisma, WebhookEventStatus } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import type { ParsedEvent } from '@/features/webhooks/parser';

/**
 * Persistência dos eventos de webhook.
 *
 * A unique `(provider, providerEventId)` É o mecanismo de idempotência: uma
 * entrega repetida da Meta colide no banco e é reconhecida como duplicada, em
 * vez de gerar efeito duas vezes. Não há checagem de leitura prévia — essa
 * seria sujeita a corrida entre duas entregas simultâneas.
 */

export interface StoredEvent {
  event: WebhookEvent;
  /** `false` quando este evento já havia sido recebido antes. */
  isNew: boolean;
}

export async function storeEvent(
  parsed: ParsedEvent,
  context: { workspaceId: string | null; signatureValid: boolean },
): Promise<StoredEvent> {
  const data = {
    workspaceId: context.workspaceId,
    provider: ChannelProvider.META,
    providerEventId: parsed.eventId,
    eventType: parsed.kind,
    signatureValid: context.signatureValid,
    // Guarda só o fragmento do evento e a metadata: o bastante para reprocessar
    // sozinho. Cabeçalhos, assinatura e credenciais nunca entram aqui.
    payload: {
      metadata: parsed.metadata,
      event: parsed.raw,
    } as unknown as Prisma.InputJsonValue,
    status: WebhookEventStatus.RECEIVED,
  };

  try {
    return { event: await prisma.webhookEvent.create({ data }), isNew: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await prisma.webhookEvent.findUniqueOrThrow({
        where: {
          provider_providerEventId: {
            provider: ChannelProvider.META,
            providerEventId: parsed.eventId,
          },
        },
      });
      return { event: existing, isNew: false };
    }
    throw error;
  }
}

export async function markProcessing(eventId: string): Promise<void> {
  await prisma.webhookEvent.update({
    where: { id: eventId },
    data: { status: WebhookEventStatus.PROCESSING },
  });
}

export async function markProcessed(eventId: string): Promise<void> {
  await prisma.webhookEvent.update({
    where: { id: eventId },
    data: { status: WebhookEventStatus.PROCESSED, processedAt: new Date(), errorMessage: null },
  });
}

export async function markIgnored(eventId: string, reason: string): Promise<void> {
  await prisma.webhookEvent.update({
    where: { id: eventId },
    data: {
      status: WebhookEventStatus.IGNORED,
      processedAt: new Date(),
      // O motivo do descarte é informação de diagnóstico, não erro.
      errorMessage: reason.slice(0, 500),
    },
  });
}

export async function markFailed(eventId: string, reason: string): Promise<void> {
  await prisma.webhookEvent.update({
    where: { id: eventId },
    data: {
      status: WebhookEventStatus.FAILED,
      failedAt: new Date(),
      errorMessage: reason.slice(0, 500),
    },
  });
}
