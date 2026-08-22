import 'server-only';
import { NumberQuality } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging/logger';
import { isProviderError } from '@/providers/messaging/types';
import { connectionFailureMessage } from '@/providers/messaging/messages';
import { createProviderForChannel } from '@/features/messaging/credentials';
import { writeAuditLog } from '@/lib/audit/audit-log';

/**
 * Saúde do número: qualidade e limite informados pela Meta.
 *
 * Este é o termômetro que antecede a restrição. A Meta rebaixa a qualidade a
 * partir do comportamento de quem recebe — bloqueios e denúncias — e só depois
 * restringe o envio. Consultar antes de disparar é o que dá tempo de parar.
 *
 * O que NÃO se faz com esse dado: trocar de número quando ele fica vermelho.
 * Isso é rotação de identidade após bloqueio, é proibido pelas regras deste
 * produto e é o comportamento que a Meta pune com banimento de conta inteira.
 * O dado serve para PARAR e corrigir a causa.
 */

/**
 * Mapeia o texto da Meta para o nosso enum.
 *
 * Valor desconhecido vira UNKNOWN, nunca GREEN: presumir saúde a partir de uma
 * resposta que não entendemos é o tipo de otimismo que custa um número.
 */
export function toNumberQuality(value: string | null): NumberQuality {
  switch (value?.toUpperCase()) {
    case 'GREEN':
      return NumberQuality.GREEN;
    case 'YELLOW':
      return NumberQuality.YELLOW;
    case 'RED':
      return NumberQuality.RED;
    default:
      return NumberQuality.UNKNOWN;
  }
}

export type HealthOutcome =
  | { ok: true; quality: NumberQuality; tier: string | null }
  | { ok: false; reason: string };

export async function syncNumberHealth(input: {
  workspaceId: string;
  actorUserId?: string | null;
  providerOverrides?: Parameters<typeof createProviderForChannel>[1];
  now?: Date;
}): Promise<HealthOutcome> {
  const channel = await prisma.messagingChannel.findFirst({
    where: { workspaceId: input.workspaceId },
  });
  if (!channel) return { ok: false, reason: 'Nenhum canal cadastrado neste workspace.' };

  let provider;
  try {
    provider = createProviderForChannel(channel, input.providerOverrides ?? {});
  } catch {
    return { ok: false, reason: 'Canal não configurado para falar com a Meta.' };
  }

  if (!provider.readNumberHealth) {
    return { ok: false, reason: 'Este provedor não informa qualidade de número.' };
  }

  let health;
  try {
    health = await provider.readNumberHealth();
  } catch (error) {
    const reason = isProviderError(error)
      ? connectionFailureMessage(error.kind)
      : 'Falha ao consultar a saúde do número.';
    logger.warn('protection.health_sync_failed', { workspaceId: input.workspaceId });
    return { ok: false, reason };
  }

  const quality = toNumberQuality(health.qualityRating);
  const previous = channel.qualityRating;

  await prisma.messagingChannel.update({
    where: { id: channel.id },
    data: {
      qualityRating: quality,
      messagingLimitTier: health.messagingLimitTier,
      qualityCheckedAt: input.now ?? new Date(),
    },
  });

  // Só audita quando muda: consultar de hora em hora não pode virar ruído no
  // registro, mas uma queda de qualidade precisa deixar rastro.
  if (previous !== quality) {
    await writeAuditLog({
      action: 'channel.quality_changed',
      resourceType: 'MessagingChannel',
      resourceId: channel.id,
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId ?? null,
      actorType: input.actorUserId ? 'USER' : 'SYSTEM',
      metadata: { from: previous, to: quality, tier: health.messagingLimitTier },
    });

    logger.info('protection.quality_changed', {
      workspaceId: input.workspaceId,
      from: previous,
      to: quality,
    });
  }

  return { ok: true, quality, tier: health.messagingLimitTier };
}

export interface NumberHealthView {
  quality: NumberQuality;
  tier: string | null;
  checkedAt: Date | null;
  /** `true` quando a política manda parar com a qualidade atual. */
  blocksSending: boolean;
  /** Consulta antiga demais para valer como leitura do estado de agora. */
  stale: boolean;
}

/** Idade a partir da qual a leitura de qualidade deixa de valer. */
export const HEALTH_TTL_MS = 24 * 60 * 60 * 1000;

export async function numberHealth(
  workspaceId: string,
  policy: { pauseOnRedQuality: boolean; pauseOnYellowQuality: boolean },
  now: Date = new Date(),
): Promise<NumberHealthView | null> {
  const channel = await prisma.messagingChannel.findFirst({
    where: { workspaceId },
    select: { qualityRating: true, messagingLimitTier: true, qualityCheckedAt: true },
  });
  if (!channel) return null;

  const blocksSending =
    (channel.qualityRating === NumberQuality.RED && policy.pauseOnRedQuality) ||
    (channel.qualityRating === NumberQuality.YELLOW && policy.pauseOnYellowQuality);

  return {
    quality: channel.qualityRating,
    tier: channel.messagingLimitTier,
    checkedAt: channel.qualityCheckedAt,
    blocksSending,
    stale:
      channel.qualityCheckedAt === null ||
      now.getTime() - channel.qualityCheckedAt.getTime() > HEALTH_TTL_MS,
  };
}
