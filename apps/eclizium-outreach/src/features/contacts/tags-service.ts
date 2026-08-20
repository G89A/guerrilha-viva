import 'server-only';
import type { Prisma, Tag } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { AppError } from '@/lib/errors/app-error';
import { isUniqueConstraintError } from '@/lib/db/errors';

/**
 * Resolve uma tag por id OU cria/reaproveita por nome, sempre dentro do
 * workspace autorizado. Um `tagId` de outro tenant não é encontrado — e o
 * banco recusaria o vínculo de qualquer forma, pelas foreign keys compostas.
 */
export async function resolveTag(
  workspaceId: string,
  input: { tagId?: string | undefined; tagName?: string | undefined },
  client: Prisma.TransactionClient = prisma,
): Promise<Tag> {
  if (input.tagId) {
    const tag = await client.tag.findFirst({ where: { id: input.tagId, workspaceId } });
    if (!tag) throw AppError.notFound('Tag não encontrada.');
    return tag;
  }

  const name = input.tagName?.trim();
  if (!name) throw AppError.validation('Informe uma tag.', { tagName: ['Informe uma tag.'] });

  const existing = await client.tag.findFirst({ where: { workspaceId, name } });
  if (existing) return existing;

  try {
    return await client.tag.create({ data: { workspaceId, name } });
  } catch (error) {
    // Corrida entre duas criações do mesmo nome: a perdedora relê a vencedora.
    if (isUniqueConstraintError(error, 'name')) {
      return client.tag.findFirstOrThrow({ where: { workspaceId, name } });
    }
    throw error;
  }
}

/** `attached: false` quando o contato já tinha a tag. Repetir é inofensivo. */
export async function attachTag(
  workspaceId: string,
  contactId: string,
  tagId: string,
  client: Prisma.TransactionClient = prisma,
): Promise<{ attached: boolean }> {
  try {
    await client.contactTag.create({ data: { workspaceId, contactId, tagId } });
    return { attached: true };
  } catch (error) {
    if (isUniqueConstraintError(error)) return { attached: false };
    throw error;
  }
}

export async function detachTag(
  workspaceId: string,
  contactId: string,
  tagId: string,
): Promise<{ detached: boolean }> {
  const result = await prisma.contactTag.deleteMany({ where: { workspaceId, contactId, tagId } });
  return { detached: result.count > 0 };
}

export interface TagSummary {
  id: string;
  name: string;
  contactCount: number;
}

export async function listTags(workspaceId: string): Promise<TagSummary[]> {
  const tags = await prisma.tag.findMany({
    where: { workspaceId },
    orderBy: { name: 'asc' },
    include: { _count: { select: { contacts: true } } },
  });

  return tags.map((tag) => ({ id: tag.id, name: tag.name, contactCount: tag._count.contacts }));
}
