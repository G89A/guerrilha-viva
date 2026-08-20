import 'server-only';
import type { Session, User, Workspace, WorkspaceRole } from '@prisma/client';
import { cache } from 'react';
import { prisma } from '@/lib/db/client';
import { AppError } from '@/lib/errors/app-error';
import { getCurrentSession } from '@/lib/auth/session';
import { hasAtLeastRole } from '@/lib/auth/roles';

export interface AuthContext {
  user: User;
  session: Session;
}

export interface WorkspaceContext extends AuthContext {
  workspace: Workspace;
  role: WorkspaceRole;
}

/** Throws UNAUTHENTICATED when there is no valid session. */
export async function requireUser(): Promise<AuthContext> {
  const current = await getCurrentSession();
  if (!current) throw AppError.unauthenticated();
  return { user: current.user, session: current.session };
}

/**
 * Resolves the workspace the request operates on. The id comes from the
 * server-side session and is re-checked against `workspace_members` on every
 * call — a `workspace_id` supplied by the client is never consulted here.
 */
export const requireWorkspace = cache(async (): Promise<WorkspaceContext> => {
  const { user, session } = await requireUser();

  if (session.activeWorkspaceId) {
    const membership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: session.activeWorkspaceId, userId: user.id },
      },
      include: { workspace: true },
    });
    if (membership) {
      return { user, session, workspace: membership.workspace, role: membership.role };
    }
    // The session points at a workspace the user was removed from: fall through
    // and pick another membership instead of serving foreign data.
  }

  const fallback = await prisma.workspaceMember.findFirst({
    where: { userId: user.id },
    include: { workspace: true },
    orderBy: { createdAt: 'asc' },
  });

  if (!fallback) {
    throw AppError.forbidden('Nenhum workspace disponível para este usuário.');
  }

  return { user, session, workspace: fallback.workspace, role: fallback.role };
});

/** Same as `requireWorkspace`, additionally enforcing a minimum role. */
export async function requireWorkspaceRole(minimum: WorkspaceRole): Promise<WorkspaceContext> {
  const context = await requireWorkspace();
  if (!hasAtLeastRole(context.role, minimum)) {
    throw AppError.forbidden('Seu papel neste workspace não permite esta ação.');
  }
  return context;
}

/**
 * Verifies that `userId` really belongs to `workspaceId`. Use this whenever a
 * workspace id arrives from outside (e.g. a workspace switcher) — it converts
 * an untrusted id into an authorised one, or refuses.
 */
export async function assertWorkspaceMembership(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceRole> {
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  });

  // Deliberately FORBIDDEN and not NOT_FOUND: the two must be indistinguishable
  // or the API becomes a workspace-existence oracle.
  if (!membership) throw AppError.forbidden('Acesso negado a este workspace.');
  return membership.role;
}

/**
 * Canonical tenant filter. Every query against a workspace-scoped table should
 * spread this into its `where` clause.
 */
export function workspaceScope(context: { workspace: { id: string } }): { workspaceId: string } {
  return { workspaceId: context.workspace.id };
}
