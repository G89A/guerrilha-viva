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

/**
 * Define (ou remove) o responsável pela conversa.
 *
 * O id do responsável é validado contra os membros DO WORKSPACE. Aceitar o id
 * como veio permitiria atribuir uma conversa a alguém de outro tenant — que
 * passaria a vê-la em "minhas conversas".
 */
export async function assignConversation(input: {
  workspaceId: string;
  conversationId: string;
  assigneeId: string | null;
  now?: Date;
}): Promise<{ changed: boolean; reason?: string }> {
  if (input.assigneeId) {
    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId: input.workspaceId, userId: input.assigneeId },
      select: { id: true },
    });
    if (!member) return { changed: false, reason: 'Usuário não pertence a este workspace.' };
  }

  const result = await prisma.conversation.updateMany({
    where: { id: input.conversationId, workspaceId: input.workspaceId },
    data: {
      assigneeId: input.assigneeId,
      assignedAt: input.assigneeId ? (input.now ?? new Date()) : null,
    },
  });

  return { changed: result.count > 0 };
}

export const MAX_NOTE_LENGTH = 2_000;

/**
 * Registra uma nota interna.
 *
 * A conversa é resolvida DENTRO do workspace antes de gravar: sem isso, um id
 * de conversa alheia criaria uma nota no tenant errado.
 */
export async function addConversationNote(input: {
  workspaceId: string;
  conversationId: string;
  authorId: string;
  body: string;
}): Promise<{ created: boolean; noteId?: string; reason?: string }> {
  const body = input.body.trim();
  if (body.length === 0) return { created: false, reason: 'Nota vazia.' };
  if (body.length > MAX_NOTE_LENGTH) return { created: false, reason: 'Nota longa demais.' };

  const conversation = await prisma.conversation.findFirst({
    where: { id: input.conversationId, workspaceId: input.workspaceId },
    select: { id: true },
  });
  if (!conversation) return { created: false, reason: 'Conversa não encontrada.' };

  const note = await prisma.conversationNote.create({
    data: {
      workspaceId: input.workspaceId,
      conversationId: conversation.id,
      authorId: input.authorId,
      body,
    },
    select: { id: true },
  });

  return { created: true, noteId: note.id };
}
