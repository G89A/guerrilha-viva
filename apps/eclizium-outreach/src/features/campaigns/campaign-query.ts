import 'server-only';
import type { Prisma } from '@prisma/client';
import { CampaignStatus, RecipientEligibility, RecipientStatus, TemplateAvailability, TemplateStatus } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import {
  CAMPAIGNS_PAGE_SIZE,
  RECIPIENTS_PAGE_SIZE,
  type CampaignListFilters,
  type RecipientFilters,
} from '@/features/campaigns/schemas';

/** Consultas de leitura das campanhas. Todas escopadas ao workspace. */

export async function queryCampaigns(workspaceId: string, filters: CampaignListFilters) {
  const and: Prisma.CampaignWhereInput[] = [];
  if (filters.search) and.push({ name: { contains: filters.search, mode: 'insensitive' } });
  if (filters.status) and.push({ status: filters.status });
  if (filters.templateId) and.push({ templateId: filters.templateId });

  const where: Prisma.CampaignWhereInput =
    and.length > 0 ? { workspaceId, AND: and } : { workspaceId };

  const [total, rows] = await prisma.$transaction([
    prisma.campaign.count({ where }),
    prisma.campaign.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (filters.page - 1) * CAMPAIGNS_PAGE_SIZE,
      take: CAMPAIGNS_PAGE_SIZE,
      select: {
        id: true,
        name: true,
        status: true,
        scheduledAt: true,
        createdAt: true,
        totalRecipients: true,
        eligibleRecipients: true,
        template: { select: { id: true, name: true } },
        createdBy: { select: { name: true, email: true } },
      },
    }),
  ]);

  return {
    rows,
    total,
    page: filters.page,
    pageSize: CAMPAIGNS_PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / CAMPAIGNS_PAGE_SIZE)),
  };
}

/** Contagem por estado, para os cartões do painel. */
export async function campaignStatusCounts(
  workspaceId: string,
): Promise<Record<CampaignStatus, number>> {
  const grouped = await prisma.campaign.groupBy({
    by: ['status'],
    where: { workspaceId },
    _count: { _all: true },
  });

  const counts = Object.fromEntries(
    Object.values(CampaignStatus).map((status) => [status, 0]),
  ) as Record<CampaignStatus, number>;

  for (const row of grouped) counts[row.status] = row._count._all;
  return counts;
}

export async function getCampaignDetail(workspaceId: string, campaignId: string) {
  return prisma.campaign.findFirst({
    where: { id: campaignId, workspaceId },
    include: {
      template: true,
      channelRef: true,
      createdBy: { select: { name: true, email: true } },
    },
  });
}

export async function queryRecipients(
  workspaceId: string,
  campaignId: string,
  filters: RecipientFilters,
) {
  const and: Prisma.CampaignRecipientWhereInput[] = [];

  if (filters.status && filters.status in RecipientStatus) {
    and.push({ status: filters.status as RecipientStatus });
  }
  if (filters.eligibility) {
    and.push({ eligibility: filters.eligibility as RecipientEligibility });
  }
  if (filters.search) {
    const term = filters.search;
    const digits = term.replace(/\D/g, '');
    and.push({
      contact: {
        OR: [
          { firstName: { contains: term, mode: 'insensitive' } },
          { lastName: { contains: term, mode: 'insensitive' } },
          // Só busca por telefone com dígitos: `contains: ''` casaria com todos.
          ...(digits.length >= 3 ? [{ phoneE164: { contains: digits } }] : []),
        ],
      },
    });
  }

  const where: Prisma.CampaignRecipientWhereInput = {
    campaignId,
    workspaceId,
    ...(and.length > 0 ? { AND: and } : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.campaignRecipient.count({ where }),
    prisma.campaignRecipient.findMany({
      where,
      orderBy: [{ status: 'asc' }, { id: 'asc' }],
      skip: (filters.page - 1) * RECIPIENTS_PAGE_SIZE,
      take: RECIPIENTS_PAGE_SIZE,
      select: {
        id: true,
        status: true,
        eligibility: true,
        eligibilityReasons: true,
        renderedPreview: true,
        providerMessageId: true,
        failureReason: true,
        contact: {
          select: { id: true, firstName: true, lastName: true, phoneE164: true, company: true },
        },
      },
    }),
  ]);

  return {
    rows,
    total,
    page: filters.page,
    pageSize: RECIPIENTS_PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / RECIPIENTS_PAGE_SIZE)),
  };
}

/** Templates aptos a campanha: aprovados e ainda existentes na Meta. */
export async function campaignReadyTemplates(workspaceId: string) {
  return prisma.messageTemplate.findMany({
    where: {
      workspaceId,
      status: TemplateStatus.APPROVED,
      availability: TemplateAvailability.AVAILABLE,
    },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      language: true,
      body: true,
      headerText: true,
      footerText: true,
      variables: true,
      variableCount: true,
    },
  });
}

/** Alguns destinatários com prévia, para o passo de visualização. */
export async function previewSamples(workspaceId: string, campaignId: string, take = 3) {
  return prisma.campaignRecipient.findMany({
    where: { campaignId, workspaceId, eligibility: RecipientEligibility.ELIGIBLE },
    take,
    orderBy: { id: 'asc' },
    select: {
      id: true,
      renderedPreview: true,
      contact: { select: { firstName: true, lastName: true, phoneE164: true } },
    },
  });
}
