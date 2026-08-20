import 'server-only';
import type { Prisma, Workspace } from '@prisma/client';
import { WorkspaceRole } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { AppError } from '@/lib/errors/app-error';
import { isUniqueConstraintError } from '@/lib/db/errors';
import { slugify, withSuffix } from '@/features/workspaces/slug';

const MAX_SLUG_ATTEMPTS = 25;

/**
 * Runs `attempt` with successive slug candidates until one is free.
 *
 * The retry lives OUTSIDE the caller's transaction on purpose. PostgreSQL
 * aborts an entire transaction on a constraint violation, so retrying an
 * insert inside the same transaction fails with "current transaction is
 * aborted". Callers therefore pass a factory that opens its own transaction
 * per attempt; a failed attempt rolls back cleanly and the next one starts
 * fresh.
 */
export async function withUniqueSlug<T>(
  name: string,
  attempt: (slug: string) => Promise<T>,
): Promise<T> {
  const base = slugify(name) || 'workspace';

  for (let index = 0; index < MAX_SLUG_ATTEMPTS; index += 1) {
    const slug = index === 0 ? base : withSuffix(base, index + 1);
    try {
      return await attempt(slug);
    } catch (error) {
      if (isUniqueConstraintError(error, 'slug')) continue;
      throw error;
    }
  }

  throw AppError.conflict('Não foi possível gerar um identificador único para o workspace.');
}

/** Single attempt: creates the workspace and its OWNER membership together. */
export async function createWorkspaceWithOwner(
  input: { name: string; ownerUserId: string; slug: string },
  client: Prisma.TransactionClient = prisma,
): Promise<Workspace> {
  return client.workspace.create({
    data: {
      name: input.name,
      slug: input.slug,
      members: { create: { userId: input.ownerUserId, role: WorkspaceRole.OWNER } },
    },
  });
}

/**
 * Creates a workspace for an existing user, resolving slug collisions. Use this
 * outside a transaction; inside one, combine `withUniqueSlug` with
 * `createWorkspaceWithOwner` so each retry gets its own transaction.
 */
export async function createWorkspaceForUser(input: {
  name: string;
  ownerUserId: string;
}): Promise<Workspace> {
  return withUniqueSlug(input.name, (slug) =>
    createWorkspaceWithOwner({ name: input.name, ownerUserId: input.ownerUserId, slug }),
  );
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
}

/** Workspaces the user is actually a member of — the only ones they may see. */
export async function listWorkspacesForUser(userId: string): Promise<WorkspaceSummary[]> {
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId },
    include: { workspace: true },
    orderBy: { createdAt: 'asc' },
  });

  return memberships.map((membership) => ({
    id: membership.workspace.id,
    name: membership.workspace.name,
    slug: membership.workspace.slug,
    role: membership.role,
  }));
}

export async function renameWorkspace(workspaceId: string, name: string): Promise<Workspace> {
  return prisma.workspace.update({ where: { id: workspaceId }, data: { name } });
}

export interface WorkspaceMemberSummary {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  createdAt: Date;
}

export async function listWorkspaceMembers(
  workspaceId: string,
): Promise<WorkspaceMemberSummary[]> {
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    include: { user: true },
    orderBy: { createdAt: 'asc' },
  });

  return members.map((member) => ({
    id: member.id,
    userId: member.userId,
    name: member.user.name,
    email: member.user.email,
    role: member.role,
    createdAt: member.createdAt,
  }));
}
