import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';

/**
 * Leitura do registro de auditoria.
 *
 * O audit log é escrito desde a Sprint 0 e até agora não tinha como ser lido —
 * registro que ninguém consulta não é auditoria, é arquivo morto.
 *
 * Três regras que valem para tudo aqui:
 *
 *   1. Escopo de workspace no WHERE, sempre. Um registro de auditoria mostra
 *      quem fez o quê; vazá-lo entre tenants é pior que vazar um contato.
 *   2. Somente leitura. Não existe função de editar ou apagar registro — um
 *      log que o próprio sistema altera não serve de prova.
 *   3. `metadata` já é gravada sem segredo (ver `writeAuditLog`). Nada aqui
 *      tenta "limpar" depois: o que não pode ser guardado não é guardado.
 */

export const AUDIT_PAGE_SIZE = 50;

export interface AuditFilters {
  action?: string;
  resourceType?: string;
  actorUserId?: string;
  from?: Date;
  to?: Date;
}

export interface AuditEntry {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  actorType: string;
  actorName: string | null;
  actorEmail: string | null;
  metadata: Prisma.JsonValue;
  createdAt: Date;
}

export interface AuditPage {
  entries: AuditEntry[];
  nextCursor: string | null;
}

export function auditWhere(workspaceId: string, filters: AuditFilters): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = { workspaceId };

  if (filters.action) where.action = filters.action;
  if (filters.resourceType) where.resourceType = filters.resourceType;
  if (filters.actorUserId) where.actorUserId = filters.actorUserId;

  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }

  return where;
}

export async function listAuditEntries(
  workspaceId: string,
  filters: AuditFilters = {},
  page: { cursor?: string; take?: number } = {},
): Promise<AuditPage> {
  const take = Math.min(page.take ?? AUDIT_PAGE_SIZE, 200);

  const rows = await prisma.auditLog.findMany({
    where: auditWhere(workspaceId, filters),
    // `id` desempata para que a ordenação seja total: vários registros podem
    // cair no mesmo milissegundo, e sem desempate o cursor pula linhas.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: take + 1,
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      action: true,
      resourceType: true,
      resourceId: true,
      actorType: true,
      metadata: true,
      createdAt: true,
      actor: { select: { name: true, email: true } },
    },
  });

  const hasMore = rows.length > take;
  const visible = hasMore ? rows.slice(0, take) : rows;

  return {
    entries: visible.map((row) => ({
      id: row.id,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      actorType: row.actorType,
      actorName: row.actor?.name ?? null,
      actorEmail: row.actor?.email ?? null,
      metadata: row.metadata,
      createdAt: row.createdAt,
    })),
    nextCursor: hasMore ? (visible[visible.length - 1]?.id ?? null) : null,
  };
}

/** Valores existentes para montar os filtros, sem chutar uma lista fixa. */
export async function auditFilterOptions(workspaceId: string): Promise<{
  actions: string[];
  resourceTypes: string[];
  actors: Array<{ id: string; name: string }>;
}> {
  const [actions, resourceTypes, actors] = await Promise.all([
    prisma.auditLog.groupBy({ by: ['action'], where: { workspaceId }, orderBy: { action: 'asc' } }),
    prisma.auditLog.groupBy({
      by: ['resourceType'],
      where: { workspaceId },
      orderBy: { resourceType: 'asc' },
    }),
    prisma.workspaceMember.findMany({
      where: { workspaceId },
      orderBy: { user: { name: 'asc' } },
      select: { user: { select: { id: true, name: true } } },
    }),
  ]);

  return {
    actions: actions.map((row) => row.action),
    resourceTypes: resourceTypes.map((row) => row.resourceType),
    actors: actors.map((row) => row.user),
  };
}

/** Volume por ação no período — para a tela de analytics. */
export async function auditActivity(
  workspaceId: string,
  from: Date,
  to: Date,
  limit = 10,
): Promise<Array<{ action: string; total: number }>> {
  const rows = await prisma.auditLog.groupBy({
    by: ['action'],
    where: { workspaceId, createdAt: { gte: from, lte: to } },
    _count: { _all: true },
    orderBy: { _count: { action: 'desc' } },
    take: limit,
  });

  return rows.map((row) => ({ action: row.action, total: row._count._all }));
}
