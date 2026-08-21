import 'server-only';
import type { Conversation, Prisma } from '@prisma/client';
import { ConversationStatus } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { SERVICE_WINDOW_MS } from '@/features/messaging/reply-constants';

/**
 * Ciclo de vida das conversas.
 *
 * Uma conversa por (canal, contato) — a unique no banco garante que duas
 * mensagens recebidas simultaneamente não criem duas conversas.
 */

/**
 * Encontra ou cria a conversa de forma ATÔMICA.
 *
 * Dentro de uma transação PostgreSQL, um `create` que estoure a unique aborta a
 * transação inteira (25P02) — nem dá para reler o vencedor no `catch`. O
 * `upsert` é uma instrução só (INSERT … ON CONFLICT) e nunca aborta.
 */
/**
 * Encontra ou cria a conversa de forma ATÔMICA.
 *
 * `createMany` com `skipDuplicates` emite INSERT … ON CONFLICT DO NOTHING, que
 * nunca aborta a transação. Um `create` que estoure a unique dentro de uma
 * transação PostgreSQL aborta tudo (25P02), e o `upsert` do Prisma também
 * levanta P2002 sob concorrência.
 */
export async function findOrCreateConversation(
  input: { workspaceId: string; channelId: string; contactId: string },
  client: Prisma.TransactionClient = prisma,
): Promise<{ conversation: Conversation; created: boolean }> {
  const inserted = await client.conversation.createMany({
    skipDuplicates: true,
    data: [
      {
        workspaceId: input.workspaceId,
        channelId: input.channelId,
        contactId: input.contactId,
        status: ConversationStatus.OPEN,
      },
    ],
  });

  const conversation = await client.conversation.findUniqueOrThrow({
    where: { channelId_contactId: { channelId: input.channelId, contactId: input.contactId } },
  });

  return { conversation, created: inserted.count > 0 };
}

/**
 * Registra a chegada de uma mensagem recebida.
 *
 * `unreadCount` é o contador do CRM — quantas mensagens a equipe ainda não
 * abriu. Não tem relação com o status READ do WhatsApp, que diz se o
 * DESTINATÁRIO leu o que nós enviamos. São coisas diferentes e nunca devem ser
 * confundidas.
 */
export async function registerInbound(
  conversationId: string,
  receivedAt: Date,
  client: Prisma.TransactionClient = prisma,
): Promise<void> {
  await client.conversation.update({
    where: { id: conversationId },
    data: {
      unreadCount: { increment: 1 },
      lastMessageAt: receivedAt,
      lastInboundAt: receivedAt,
      // Uma resposta do contato reabre a conversa: quem escreveu espera retorno.
      status: ConversationStatus.OPEN,
      closedAt: null,
    },
  });
}

export async function registerOutbound(
  conversationId: string,
  sentAt: Date,
  client: Prisma.TransactionClient = prisma,
): Promise<void> {
  await client.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: sentAt },
  });
}

/** Zera o contador de não lidas do CRM. Escopado ao workspace. */
export async function markConversationRead(
  workspaceId: string,
  conversationId: string,
): Promise<{ changed: boolean }> {
  const result = await prisma.conversation.updateMany({
    where: { id: conversationId, workspaceId, unreadCount: { gt: 0 } },
    data: { unreadCount: 0 },
  });
  return { changed: result.count > 0 };
}

export async function setConversationStatus(
  workspaceId: string,
  conversationId: string,
  status: ConversationStatus,
): Promise<{ changed: boolean }> {
  const result = await prisma.conversation.updateMany({
    where: { id: conversationId, workspaceId },
    data: {
      status,
      closedAt: status === ConversationStatus.CLOSED ? new Date() : null,
    },
  });
  return { changed: result.count > 0 };
}

/**
 * Janela de atendimento da Meta: fora de 24h desde a última mensagem do
 * contato, só template é permitido. Calculada, nunca presumida aberta.
 */
export function serviceWindow(lastInboundAt: Date | null, now: Date = new Date()) {
  if (!lastInboundAt) return { open: false as const, expiresAt: null };

  const expiresAt = new Date(lastInboundAt.getTime() + SERVICE_WINDOW_MS);
  return { open: expiresAt.getTime() > now.getTime(), expiresAt };
}
