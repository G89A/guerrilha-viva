import 'server-only';
import type { Prisma } from '@prisma/client';
import { TemplateAvailability, type TemplateCategory, TemplateStatus } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { TEMPLATES_PAGE_SIZE, type TemplateFilters } from '@/features/messaging/schemas';

/** Where da listagem. `workspaceId` primeiro; filtros só estreitam. */
export function buildTemplateWhere(
  workspaceId: string,
  filters: TemplateFilters,
): Prisma.MessageTemplateWhereInput {
  const and: Prisma.MessageTemplateWhereInput[] = [];

  if (filters.search) {
    and.push({ name: { contains: filters.search, mode: 'insensitive' } });
  }
  if (filters.status) and.push({ status: filters.status as TemplateStatus });
  if (filters.category) and.push({ category: filters.category as TemplateCategory });
  if (filters.language) and.push({ language: filters.language });

  return and.length > 0 ? { workspaceId, AND: and } : { workspaceId };
}

export async function queryTemplates(workspaceId: string, filters: TemplateFilters) {
  const where = buildTemplateWhere(workspaceId, filters);

  const [total, rows] = await prisma.$transaction([
    prisma.messageTemplate.count({ where }),
    prisma.messageTemplate.findMany({
      where,
      orderBy: [{ name: 'asc' }, { language: 'asc' }],
      skip: (filters.page - 1) * TEMPLATES_PAGE_SIZE,
      take: TEMPLATES_PAGE_SIZE,
      select: {
        id: true,
        name: true,
        language: true,
        category: true,
        status: true,
        providerStatus: true,
        availability: true,
        qualityScore: true,
        variableCount: true,
        syncedAt: true,
      },
    }),
  ]);

  return {
    rows,
    total,
    page: filters.page,
    pageSize: TEMPLATES_PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / TEMPLATES_PAGE_SIZE)),
  };
}

/** Idiomas presentes, para popular o filtro sem varrer a tabela na UI. */
export async function templateLanguages(workspaceId: string): Promise<string[]> {
  const rows = await prisma.messageTemplate.findMany({
    where: { workspaceId },
    select: { language: true },
    distinct: ['language'],
    orderBy: { language: 'asc' },
    take: 50,
  });
  return rows.map((row) => row.language);
}

export async function getTemplateDetail(workspaceId: string, templateId: string) {
  return prisma.messageTemplate.findFirst({
    where: { id: templateId, workspaceId },
  });
}

export async function templateCounts(workspaceId: string) {
  const [total, approved] = await Promise.all([
    prisma.messageTemplate.count({ where: { workspaceId } }),
    prisma.messageTemplate.count({
      where: {
        workspaceId,
        status: TemplateStatus.APPROVED,
        availability: TemplateAvailability.AVAILABLE,
      },
    }),
  ]);
  return { total, approved };
}
