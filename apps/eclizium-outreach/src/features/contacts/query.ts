import 'server-only';
import type { Prisma } from '@prisma/client';
import { ConsentChannel, ConsentStatus, type ContactStatus } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { CONTACTS_PAGE_SIZE, type ContactFilters } from '@/features/contacts/schemas';
import { normalizePhone } from '@/features/contacts/phone';

export interface ContactRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phoneE164: string;
  email: string | null;
  company: string | null;
  city: string | null;
  status: ContactStatus;
  createdAt: Date;
  tags: Array<{ id: string; name: string }>;
  whatsappConsent: ConsentStatus;
  suppressed: boolean;
}

export interface ContactPage {
  rows: ContactRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/**
 * Monta o `where` da listagem. `workspaceId` entra sempre e primeiro; os
 * filtros do usuário só podem estreitar o resultado, nunca ampliá-lo para
 * fora do tenant.
 */
export function buildContactWhere(
  workspaceId: string,
  filters: ContactFilters,
  phoneRegion: string,
): Prisma.ContactWhereInput {
  const where: Prisma.ContactWhereInput = { workspaceId };
  const and: Prisma.ContactWhereInput[] = [];

  if (filters.search) {
    const term = filters.search;
    const or: Prisma.ContactWhereInput[] = [
      { firstName: { contains: term, mode: 'insensitive' } },
      { lastName: { contains: term, mode: 'insensitive' } },
      { email: { contains: term, mode: 'insensitive' } },
      { company: { contains: term, mode: 'insensitive' } },
    ];

    // Se o termo parece telefone, buscar pelo E.164 normalizado usa o índice
    // em vez de varrer a tabela com ILIKE.
    if (/\d/.test(term)) {
      const normalized = normalizePhone(term, phoneRegion);
      if (normalized.ok) {
        or.push({ phoneE164: normalized.phone.e164 });
      } else {
        const digits = term.replace(/\D/g, '');
        if (digits.length >= 4) or.push({ phoneE164: { contains: digits } });
      }
    }

    and.push({ OR: or });
  }

  if (filters.status) and.push({ status: filters.status });
  if (filters.tagId) and.push({ tags: { some: { tagId: filters.tagId } } });
  if (filters.listId) and.push({ listMembers: { some: { listId: filters.listId } } });
  if (filters.city) and.push({ city: { equals: filters.city, mode: 'insensitive' } });
  if (filters.source) and.push({ source: { equals: filters.source, mode: 'insensitive' } });

  if (filters.consent) {
    const channel = ConsentChannel.WHATSAPP;
    and.push(
      filters.consent === ConsentStatus.UNKNOWN
        ? {
            // "Desconhecido" inclui quem nunca teve registro de consentimento.
            OR: [
              { consents: { some: { channel, status: ConsentStatus.UNKNOWN } } },
              { consents: { none: { channel } } },
            ],
          }
        : { consents: { some: { channel, status: filters.consent } } },
    );
  }

  if (filters.suppressed === 'yes') and.push({ suppressions: { some: {} } });
  if (filters.suppressed === 'no') and.push({ suppressions: { none: {} } });

  if (and.length > 0) where.AND = and;
  return where;
}

/**
 * Página de contatos com tags, consentimento e supressão resolvidos.
 *
 * As relações vêm por `include`, o que o Prisma resolve com um punhado de
 * queries fixas — não uma por linha. Nenhum caminho aqui carrega a base
 * inteira para filtrar em memória.
 */
export async function queryContacts(
  workspaceId: string,
  filters: ContactFilters,
  phoneRegion: string,
): Promise<ContactPage> {
  const where = buildContactWhere(workspaceId, filters, phoneRegion);
  const pageSize = CONTACTS_PAGE_SIZE;

  const [total, records] = await prisma.$transaction([
    prisma.contact.count({ where }),
    prisma.contact.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (filters.page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phoneE164: true,
        email: true,
        company: true,
        city: true,
        status: true,
        createdAt: true,
        tags: { select: { tag: { select: { id: true, name: true } } } },
        consents: {
          where: { channel: ConsentChannel.WHATSAPP },
          select: { status: true },
          take: 1,
        },
        suppressions: { select: { id: true }, take: 1 },
      },
    }),
  ]);

  const rows: ContactRow[] = records.map((record) => ({
    id: record.id,
    firstName: record.firstName,
    lastName: record.lastName,
    phoneE164: record.phoneE164,
    email: record.email,
    company: record.company,
    city: record.city,
    status: record.status,
    createdAt: record.createdAt,
    tags: record.tags.map((link) => link.tag),
    whatsappConsent: record.consents[0]?.status ?? ConsentStatus.UNKNOWN,
    suppressed: record.suppressions.length > 0,
  }));

  return {
    rows,
    total,
    page: filters.page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Valores distintos usados para popular os selects de filtro. */
export async function contactFilterOptions(
  workspaceId: string,
): Promise<{ cities: string[]; sources: string[] }> {
  const [cities, sources] = await Promise.all([
    prisma.contact.findMany({
      where: { workspaceId, city: { not: null } },
      select: { city: true },
      distinct: ['city'],
      orderBy: { city: 'asc' },
      take: 200,
    }),
    prisma.contact.findMany({
      where: { workspaceId, source: { not: null } },
      select: { source: true },
      distinct: ['source'],
      orderBy: { source: 'asc' },
      take: 200,
    }),
  ]);

  return {
    cities: cities.map((row) => row.city).filter((city): city is string => Boolean(city)),
    sources: sources.map((row) => row.source).filter((source): source is string => Boolean(source)),
  };
}

/** Ficha completa do contato, em uma única ida ao banco. */
export async function getContactDetail(workspaceId: string, contactId: string) {
  return prisma.contact.findFirst({
    where: { id: contactId, workspaceId },
    include: {
      tags: { include: { tag: true }, orderBy: { createdAt: 'asc' } },
      listMembers: { include: { list: true }, orderBy: { createdAt: 'asc' } },
      consents: { orderBy: { channel: 'asc' } },
      suppressions: { orderBy: { createdAt: 'desc' } },
    },
  });
}
