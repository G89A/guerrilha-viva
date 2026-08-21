import 'server-only';
import type { Prisma } from '@prisma/client';
import { type ConversationStatus } from '@prisma/client';
import { prisma } from '@/lib/db/client';

/**
 * Consultas da Inbox.
 *
 * Todas escopadas ao workspace. As relações vêm por `include`, resolvidas pelo
 * Prisma em poucas queries fixas — nunca uma por linha.
 *
 * Paginação por CURSOR, não por offset: a Inbox é ordenada por atividade, e
 * chega mensagem nova o tempo todo. Com `skip`, uma conversa que sobe de
 * posição entre duas páginas faria a página seguinte repetir ou pular linhas.
 */

export const CONVERSATIONS_PAGE_SIZE = 30;
export const MESSAGES_PAGE_SIZE = 50;

export interface ConversationFilters {
  status?: ConversationStatus;
  search?: string;
  unreadOnly?: boolean;
  /** Id do responsável, ou `UNASSIGNED` para as conversas sem dono. */
  assigneeId?: string | 'UNASSIGNED';
}

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
  assigneeId: string | null;
  assigneeName: string | null;
}

export interface ConversationPage {
  items: ConversationListItem[];
  /** Cursor da próxima página; `null` quando acabou. */
  nextCursor: string | null;
}

export function contactDisplayName(contact: {
  firstName: string | null;
  lastName: string | null;
}): string {
  const full = [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
  return full.length > 0 ? full : 'Sem nome';
}

export function conversationWhere(
  workspaceId: string,
  filters: ConversationFilters,
): Prisma.ConversationWhereInput {
  const where: Prisma.ConversationWhereInput = { workspaceId };
  if (filters.status) where.status = filters.status;
  if (filters.unreadOnly) where.unreadCount = { gt: 0 };

  if (filters.assigneeId === 'UNASSIGNED') where.assigneeId = null;
  else if (filters.assigneeId) where.assigneeId = filters.assigneeId;

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

  return where;
}

export async function listConversations(
  workspaceId: string,
  filters: ConversationFilters = {},
  page: { cursor?: string; take?: number } = {},
): Promise<ConversationPage> {
  const take = Math.min(page.take ?? CONVERSATIONS_PAGE_SIZE, 100);

  const conversations = await prisma.conversation.findMany({
    where: conversationWhere(workspaceId, filters),
    // Conversa com atividade mais recente primeiro; `id` desempata para que a
    // ordenação seja total e o cursor nunca fique ambíguo.
    orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
    // Pede um a mais do que cabe na página: se vier, há próxima.
    take: take + 1,
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      contactId: true,
      status: true,
      unreadCount: true,
      lastMessageAt: true,
      assigneeId: true,
      assignee: { select: { name: true } },
      contact: { select: { firstName: true, lastName: true, phoneE164: true } },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { body: true, direction: true, type: true },
      },
    },
  });

  const hasMore = conversations.length > take;
  const visible = hasMore ? conversations.slice(0, take) : conversations;

  return {
    items: visible.map((conversation) => {
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
        assigneeId: conversation.assigneeId,
        assigneeName: conversation.assignee?.name ?? null,
      };
    }),
    nextCursor: hasMore ? (visible[visible.length - 1]?.id ?? null) : null,
  };
}

/** Contagens por aba da Inbox, em uma ida ao banco por agregação. */
export interface InboxCounters {
  open: number;
  pending: number;
  closed: number;
  unread: number;
  mine: number;
  unassigned: number;
}

export async function inboxCounters(
  workspaceId: string,
  userId: string,
): Promise<InboxCounters> {
  const [byStatus, unread, mine, unassigned] = await Promise.all([
    prisma.conversation.groupBy({
      by: ['status'],
      where: { workspaceId },
      _count: { _all: true },
    }),
    prisma.conversation.count({ where: { workspaceId, unreadCount: { gt: 0 } } }),
    prisma.conversation.count({ where: { workspaceId, assigneeId: userId } }),
    prisma.conversation.count({ where: { workspaceId, assigneeId: null } }),
  ]);

  const count = (status: ConversationStatus): number =>
    byStatus.find((entry) => entry.status === status)?._count._all ?? 0;

  return {
    open: count('OPEN'),
    pending: count('PENDING'),
    closed: count('CLOSED'),
    unread,
    mine,
    unassigned,
  };
}

const MESSAGE_FIELDS = {
  id: true,
  direction: true,
  type: true,
  status: true,
  body: true,
  renderedContent: true,
  mediaId: true,
  mediaMimeType: true,
  mediaFilename: true,
  mediaCaption: true,
  mediaStatus: true,
  errorTitle: true,
  errorMessage: true,
  providerTimestamp: true,
  createdAt: true,
} as const;

/**
 * Conversa com o trecho mais recente do histórico e a ficha do contato.
 *
 * O histórico vem do fim para o começo (as últimas N), e é devolvido em ordem
 * cronológica para a tela. Mensagens mais antigas saem por `listOlderMessages`.
 */
export async function getConversationDetail(workspaceId: string, conversationId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId },
    include: {
      assignee: { select: { id: true, name: true } },
      contact: {
        include: {
          tags: { include: { tag: true } },
          listMembers: { include: { list: true } },
          consents: true,
          suppressions: true,
        },
      },
      notes: {
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { author: { select: { id: true, name: true } } },
      },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: MESSAGES_PAGE_SIZE + 1,
        select: MESSAGE_FIELDS,
      },
    },
  });

  if (!conversation) return null;

  const hasOlder = conversation.messages.length > MESSAGES_PAGE_SIZE;
  const visible = hasOlder
    ? conversation.messages.slice(0, MESSAGES_PAGE_SIZE)
    : conversation.messages;

  return {
    ...conversation,
    messages: [...visible].reverse(),
    olderCursor: hasOlder ? (visible[visible.length - 1]?.id ?? null) : null,
  };
}

export interface OlderMessagesPage {
  messages: Array<Prisma.MessageGetPayload<{ select: typeof MESSAGE_FIELDS }>>;
  olderCursor: string | null;
}

/** Página anterior do histórico. Escopada ao workspace, sempre. */
export async function listOlderMessages(
  workspaceId: string,
  conversationId: string,
  cursor: string,
): Promise<OlderMessagesPage> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId },
    select: { id: true },
  });
  if (!conversation) return { messages: [], olderCursor: null };

  const rows = await prisma.message.findMany({
    where: { conversationId, workspaceId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: MESSAGES_PAGE_SIZE + 1,
    cursor: { id: cursor },
    skip: 1,
    select: MESSAGE_FIELDS,
  });

  const hasOlder = rows.length > MESSAGES_PAGE_SIZE;
  const visible = hasOlder ? rows.slice(0, MESSAGES_PAGE_SIZE) : rows;

  return {
    messages: [...visible].reverse(),
    olderCursor: hasOlder ? (visible[visible.length - 1]?.id ?? null) : null,
  };
}

export async function unreadTotal(workspaceId: string): Promise<number> {
  const result = await prisma.conversation.aggregate({
    where: { workspaceId },
    _sum: { unreadCount: true },
  });
  return result._sum.unreadCount ?? 0;
}

/** Membros do workspace que podem receber uma conversa. */
export async function assignableMembers(
  workspaceId: string,
): Promise<Array<{ id: string; name: string }>> {
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId, user: { isActive: true } },
    orderBy: { user: { name: 'asc' } },
    select: { user: { select: { id: true, name: true } } },
  });
  return members.map((member) => member.user);
}
