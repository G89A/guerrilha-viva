import 'server-only';
import type { Prisma } from '@prisma/client';
import { type ConversationStatus } from '@prisma/client';
import { prisma } from '@/lib/db/client';

/**
 * Consultas da Inbox.
 *
 * Todas escopadas ao workspace. As relações vêm por `include`, resolvidas pelo
 * Prisma em poucas queries fixas — nunca uma por linha.
 */

export const CONVERSATIONS_PAGE_SIZE = 30;

export interface ConversationListItem {
  id: string;
  contactId: string;
  contactName: string;
  phoneE164: string;
  status: ConversationStatus;
  unreadCount: number;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  lastMessageInbound: boolean;
}

export function contactDisplayName(contact: {
  firstName: string | null;
  lastName: string | null;
}): string {
  const full = [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
  return full.length > 0 ? full : 'Sem nome';
}

export async function listConversations(
  workspaceId: string,
  filters: { status?: ConversationStatus; search?: string; unreadOnly?: boolean } = {},
): Promise<ConversationListItem[]> {
  const where: Prisma.ConversationWhereInput = { workspaceId };
  if (filters.status) where.status = filters.status;
  if (filters.unreadOnly) where.unreadCount = { gt: 0 };

  if (filters.search) {
    const term = filters.search;
    const or: Prisma.ContactWhereInput[] = [
      { firstName: { contains: term, mode: 'insensitive' } },
      { lastName: { contains: term, mode: 'insensitive' } },
    ];

    // Só busca por telefone quando o termo tem dígitos suficientes: `contains`
    // com string vazia casaria com TODOS os contatos.
    const digits = term.replace(/\D/g, '');
    if (digits.length >= 3) or.push({ phoneE164: { contains: digits } });

    where.contact = { OR: or };
  }

  const conversations = await prisma.conversation.findMany({
    where,
    // Conversa com atividade mais recente primeiro; sem mensagem, pela criação.
    orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    take: CONVERSATIONS_PAGE_SIZE,
    select: {
      id: true,
      contactId: true,
      status: true,
      unreadCount: true,
      lastMessageAt: true,
      contact: { select: { firstName: true, lastName: true, phoneE164: true } },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { body: true, direction: true, type: true },
      },
    },
  });

  return conversations.map((conversation) => {
    const last = conversation.messages[0];
    return {
      id: conversation.id,
      contactId: conversation.contactId,
      contactName: contactDisplayName(conversation.contact),
      phoneE164: conversation.contact.phoneE164,
      status: conversation.status,
      unreadCount: conversation.unreadCount,
      lastMessageAt: conversation.lastMessageAt,
      lastMessagePreview: last?.body ?? (last ? `[${last.type.toLowerCase()}]` : null),
      lastMessageInbound: last?.direction === 'INBOUND',
    };
  });
}

/** Conversa com histórico e ficha do contato, em uma ida ao banco. */
export async function getConversationDetail(workspaceId: string, conversationId: string) {
  return prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId },
    include: {
      contact: {
        include: {
          tags: { include: { tag: true } },
          listMembers: { include: { list: true } },
          consents: true,
          suppressions: true,
        },
      },
      messages: {
        orderBy: { createdAt: 'asc' },
        take: 200,
        select: {
          id: true,
          direction: true,
          type: true,
          status: true,
          body: true,
          renderedContent: true,
          mediaMimeType: true,
          mediaFilename: true,
          mediaCaption: true,
          mediaStatus: true,
          errorTitle: true,
          errorMessage: true,
          providerTimestamp: true,
          createdAt: true,
        },
      },
    },
  });
}

export async function unreadTotal(workspaceId: string): Promise<number> {
  const result = await prisma.conversation.aggregate({
    where: { workspaceId },
    _sum: { unreadCount: true },
  });
  return result._sum.unreadCount ?? 0;
}
