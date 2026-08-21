import 'server-only';
import { MessageDirection } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging/logger';
import { isProviderError } from '@/providers/messaging/types';
import { sendFailureMessage } from '@/providers/messaging/messages';
import { createProviderForChannel } from '@/features/messaging/credentials';

/**
 * Confirmação de leitura para o WhatsApp.
 *
 * Duas coisas diferentes e deliberadamente separadas:
 *
 *   `Conversation.unreadCount` — contador do CRM. Quantas mensagens a equipe
 *   ainda não abriu aqui dentro. Zerar isso não conta nada a ninguém.
 *
 *   confirmação de leitura — dizemos À META que lemos a mensagem do contato,
 *   e o contato vê o tique azul. É comunicação para fora, então é ato
 *   explícito: nunca acontece só porque alguém abriu a tela.
 *
 * Sem credencial configurada isto não acontece e a tela diz por quê. Nada é
 * marcado como confirmado sem a Meta ter aceitado.
 */

export type ReadReceiptOutcome =
  | { ok: true; confirmed: number }
  | { ok: false; reason: string };

export async function confirmReadOnProvider(input: {
  workspaceId: string;
  conversationId: string;
  providerOverrides?: Parameters<typeof createProviderForChannel>[1];
}): Promise<ReadReceiptOutcome> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: input.conversationId, workspaceId: input.workspaceId },
    include: { channel: true },
  });
  if (!conversation) return { ok: false, reason: 'Conversa não encontrada.' };

  // Só a última recebida: a Meta marca como lidas todas as anteriores da mesma
  // conversa, então repetir por mensagem seria gasto de cota sem efeito extra.
  const latestInbound = await prisma.message.findFirst({
    where: {
      workspaceId: input.workspaceId,
      conversationId: conversation.id,
      direction: MessageDirection.INBOUND,
      providerMessageId: { not: null },
      readReceiptAt: null,
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, providerMessageId: true, createdAt: true },
  });

  if (!latestInbound?.providerMessageId) {
    return { ok: false, reason: 'Nada novo para confirmar nesta conversa.' };
  }

  let provider;
  try {
    provider = createProviderForChannel(conversation.channel, input.providerOverrides ?? {});
  } catch {
    return { ok: false, reason: 'Canal não configurado para falar com a Meta.' };
  }

  if (!provider.markRead) {
    return { ok: false, reason: 'Este provedor não suporta confirmação de leitura.' };
  }

  try {
    await provider.markRead(latestInbound.providerMessageId);
  } catch (error) {
    const reason = isProviderError(error)
      ? sendFailureMessage(error.kind)
      : 'Falha ao confirmar leitura no WhatsApp.';
    logger.warn('inbox.read_receipt_failed', {
      workspaceId: input.workspaceId,
      conversationId: conversation.id,
    });
    return { ok: false, reason };
  }

  // Só depois do aceite da Meta. Marcar antes seria registrar uma confirmação
  // que talvez nunca tenha acontecido.
  const confirmed = await prisma.message.updateMany({
    where: {
      workspaceId: input.workspaceId,
      conversationId: conversation.id,
      direction: MessageDirection.INBOUND,
      readReceiptAt: null,
      createdAt: { lte: latestInbound.createdAt },
    },
    data: { readReceiptAt: new Date() },
  });

  return { ok: true, confirmed: confirmed.count };
}
