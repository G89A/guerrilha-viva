import { WorkspaceRole } from '@prisma/client';

/**
 * Roles are totally ordered: a higher rank implies every capability of the
 * ranks below it.
 */
const RANK: Record<WorkspaceRole, number> = {
  [WorkspaceRole.VIEWER]: 10,
  [WorkspaceRole.MEMBER]: 20,
  [WorkspaceRole.ADMIN]: 30,
  [WorkspaceRole.OWNER]: 40,
};

export function hasAtLeastRole(actual: WorkspaceRole, required: WorkspaceRole): boolean {
  return RANK[actual] >= RANK[required];
}

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  [WorkspaceRole.OWNER]: 'Proprietário',
  [WorkspaceRole.ADMIN]: 'Administrador',
  [WorkspaceRole.MEMBER]: 'Membro',
  [WorkspaceRole.VIEWER]: 'Leitor',
};

export { WorkspaceRole };
