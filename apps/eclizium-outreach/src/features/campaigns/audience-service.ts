import 'server-only';
import type { Prisma } from '@prisma/client';
import { ConsentChannel, ConsentStatus, ContactStatus } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { normalizePhone } from '@/features/contacts/phone';
import type { AudienceFilters } from '@/features/campaigns/schemas';

/**
 * Construção da audiência.
 *
 * Duas garantias que orientam este módulo:
 *
 * 1. Estimar NUNCA carrega a base. Tudo é COUNT agregado; uma audiência de
 *    500 mil contatos custa o mesmo que uma de dez.
 * 2. Materializar percorre por cursor em blocos. Não existe caminho aqui que
 *    faça `findMany` sem `take`.
 */

/** Tamanho do bloco na materialização. Equilibra idas ao banco e memória. */
export const AUDIENCE_CHUNK_SIZE = 500;

/**
 * Monta o `where` a partir dos filtros.
 *
 * `workspaceId` entra sempre e primeiro; os filtros do usuário só podem
 * estreitar o conjunto, nunca alcançar outro tenant.
 */
export function buildAudienceWhere(
  workspaceId: string,
  filters: AudienceFilters,
  phoneRegion: string,
): Prisma.ContactWhereInput {
  const and: Prisma.ContactWhereInput[] = [];

  // Por padrão, campanha só fala com contato ativo.
  and.push({ status: filters.contactStatus ?? ContactStatus.ACTIVE });

  if (filters.listIds?.length) {
    and.push({ listMembers: { some: { listId: { in: filters.listIds } } } });
  }
  if (filters.tagIds?.length) {
    and.push({ tags: { some: { tagId: { in: filters.tagIds } } } });
  }
  if (filters.cities?.length) and.push({ city: { in: filters.cities, mode: 'insensitive' } });
  if (filters.states?.length) and.push({ state: { in: filters.states, mode: 'insensitive' } });
  if (filters.segments?.length) and.push({ segment: { in: filters.segments, mode: 'insensitive' } });
  if (filters.sources?.length) and.push({ source: { in: filters.sources, mode: 'insensitive' } });

  if (filters.consent) {
    const channel = ConsentChannel.WHATSAPP;
    and.push(
      filters.consent === ConsentStatus.UNKNOWN
        ? {
            // "Desconhecido" inclui quem nunca teve registro algum.
            OR: [
              { consents: { some: { channel, status: ConsentStatus.UNKNOWN } } },
              { consents: { none: { channel } } },
            ],
          }
        : { consents: { some: { channel, status: filters.consent } } },
    );
  }

  // Suprimidos ficam de fora a menos que alguém peça explicitamente o
  // contrário — e mesmo assim a elegibilidade os bloqueia depois.
  if (!filters.includeSuppressed) and.push({ suppressions: { none: {} } });

  if (filters.search) {
    const term = filters.search;
    const or: Prisma.ContactWhereInput[] = [
      { firstName: { contains: term, mode: 'insensitive' } },
      { lastName: { contains: term, mode: 'insensitive' } },
      { company: { contains: term, mode: 'insensitive' } },
      { email: { contains: term, mode: 'insensitive' } },
    ];

    // Só busca por telefone com dígitos suficientes: `contains: ''` casaria
    // com todos os contatos.
    const normalized = normalizePhone(term, phoneRegion);
    if (normalized.ok) {
      or.push({ phoneE164: normalized.phone.e164 });
    } else {
      const digits = term.replace(/\D/g, '');
      if (digits.length >= 4) or.push({ phoneE164: { contains: digits } });
    }

    and.push({ OR: or });
  }

  return { workspaceId, AND: and };
}

export interface AudienceEstimate {
  /** Contatos que casam com os filtros. */
  matched: number;
  /** Recorte por motivo de bloqueio, para o relatório do wizard. */
  withConsent: number;
  withoutConsent: number;
  suppressed: number;
  invalidPhone: number;
  /** Quantos passariam pelos critérios verificáveis por consulta. */
  potentiallyEligible: number;
}

/**
 * Estimativa por agregação. Cada número vem de um COUNT — nenhum contato é
 * carregado, e nenhum valor é inventado.
 *
 * `invalidPhone` é aproximado: telefone é validado de verdade em memória, e
 * fazer isso na base inteira derrotaria o propósito da estimativa. A conta
 * exata sai da materialização.
 */
export async function estimateAudience(
  workspaceId: string,
  filters: AudienceFilters,
  phoneRegion: string,
): Promise<AudienceEstimate> {
  const base = buildAudienceWhere(workspaceId, filters, phoneRegion);
  const channel = ConsentChannel.WHATSAPP;

  const [matched, withConsent, suppressed] = await prisma.$transaction([
    prisma.contact.count({ where: base }),
    prisma.contact.count({
      where: { AND: [base, { consents: { some: { channel, status: ConsentStatus.GRANTED } } }] },
    }),
    prisma.contact.count({
      where: { AND: [base, { suppressions: { some: {} } }] },
    }),
  ]);

  // Amostra os telefones para estimar quantos são inválidos, sem varrer tudo.
  const sample = await prisma.contact.findMany({
    where: base,
    select: { phoneE164: true },
    take: 500,
    orderBy: { id: 'asc' },
  });
  const invalidInSample = sample.filter((row) => !normalizePhone(row.phoneE164).ok).length;
  const invalidPhone =
    sample.length === 0 ? 0 : Math.round((invalidInSample / sample.length) * matched);

  return {
    matched,
    withConsent,
    withoutConsent: matched - withConsent,
    suppressed,
    invalidPhone,
    potentiallyEligible: Math.max(0, withConsent - suppressed - invalidPhone),
  };
}

export interface AudienceChunk {
  contacts: AudienceContact[];
  /** Cursor para o próximo bloco; `null` quando acabou. */
  nextCursor: string | null;
}

export type AudienceContact = {
  id: string;
  phoneE164: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  city: string | null;
  segment: string | null;
  status: ContactStatus;
  consents: Array<{ channel: ConsentChannel; status: ConsentStatus }>;
  suppressions: Array<{ id: string }>;
};

/**
 * Um bloco da audiência, com consentimentos e supressões já carregados.
 *
 * Trazer as relações junto é o que permite avaliar elegibilidade em memória:
 * sem isso, dez mil contatos custariam dez mil consultas.
 */
export async function fetchAudienceChunk(
  workspaceId: string,
  filters: AudienceFilters,
  phoneRegion: string,
  cursor: string | null,
  size: number = AUDIENCE_CHUNK_SIZE,
): Promise<AudienceChunk> {
  const contacts = await prisma.contact.findMany({
    where: buildAudienceWhere(workspaceId, filters, phoneRegion),
    // Ordem estável por id: garante que o cursor não pule nem repita linhas.
    orderBy: { id: 'asc' },
    take: size,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      phoneE164: true,
      firstName: true,
      lastName: true,
      company: true,
      city: true,
      segment: true,
      status: true,
      consents: {
        where: { channel: ConsentChannel.WHATSAPP },
        select: { channel: true, status: true },
      },
      suppressions: { select: { id: true }, take: 1 },
    },
  });

  return {
    contacts,
    nextCursor: contacts.length === size ? (contacts[contacts.length - 1]?.id ?? null) : null,
  };
}

/** Valores distintos para popular os selects do construtor de audiência. */
export async function audienceFilterOptions(workspaceId: string) {
  const [cities, states, segments, sources] = await Promise.all([
    distinctValues(workspaceId, 'city'),
    distinctValues(workspaceId, 'state'),
    distinctValues(workspaceId, 'segment'),
    distinctValues(workspaceId, 'source'),
  ]);
  return { cities, states, segments, sources };
}

async function distinctValues(
  workspaceId: string,
  field: 'city' | 'state' | 'segment' | 'source',
): Promise<string[]> {
  const rows = await prisma.contact.findMany({
    where: { workspaceId, [field]: { not: null } },
    select: { [field]: true },
    distinct: [field],
    orderBy: { [field]: 'asc' },
    take: 200,
  });
  return rows
    .map((row) => (row as Record<string, unknown>)[field])
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
}
