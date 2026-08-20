import 'server-only';
import type { ContactList, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { AppError } from '@/lib/errors/app-error';
import { isUniqueConstraintError } from '@/lib/db/errors';

/** Mesmo contrato de `resolveTag`, para listas. */
export async function resolveList(
  workspaceId: string,
  input: { listId?: string | undefined; listName?: string | undefined },
  client: Prisma.TransactionClient = prisma,
): Promise<ContactList> {
  if (input.listId) {
    const list = await client.contactList.findFirst({ where: { id: input.listId, workspaceId } });
    if (!list) throw AppError.notFound('Lista não encontrada.');
    return list;
  }

  const name = input.listName?.trim();
  if (!name) throw AppError.validation('Informe uma lista.', { listName: ['Informe uma lista.'] });

  const existing = await client.contactList.findFirst({ where: { workspaceId, name } });
  if (existing) return existing;

  try {
    return await client.contactList.create({ data: { workspaceId, name } });
  } catch (error) {
    if (isUniqueConstraintError(error, 'name')) {
      return client.contactList.findFirstOrThrow({ where: { workspaceId, name } });
    }
    throw error;
  }
}

export async function addToList(
  workspaceId: string,
  contactId: string,
  listId: string,
  client: Prisma.TransactionClient = prisma,
): Promise<{ added: boolean }> {
  try {
    await client.contactListMember.create({ data: { workspaceId, contactId, listId } });
    return { added: true };
  } catch (error) {
    if (isUniqueConstraintError(error)) return { added: false };
    throw error;
  }
}

export async function removeFromList(
  workspaceId: string,
  contactId: string,
  listId: string,
): Promise<{ removed: boolean }> {
  const result = await prisma.contactListMember.deleteMany({
    where: { workspaceId, contactId, listId },
  });
  return { removed: result.count > 0 };
}

export interface ListSummary {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
}

export async function listContactLists(workspaceId: string): Promise<ListSummary[]> {
  const lists = await prisma.contactList.findMany({
    where: { workspaceId },
    orderBy: { name: 'asc' },
    include: { _count: { select: { members: true } } },
  });

  return lists.map((list) => ({
    id: list.id,
    name: list.name,
    description: list.description,
    memberCount: list._count.members,
  }));
}
