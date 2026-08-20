import { describe, expect, it } from 'vitest';
import { hasAtLeastRole, ROLE_LABELS, WorkspaceRole } from '@/lib/auth/roles';

describe('role hierarchy', () => {
  it('treats OWNER as satisfying every requirement', () => {
    for (const role of Object.values(WorkspaceRole)) {
      expect(hasAtLeastRole(WorkspaceRole.OWNER, role)).toBe(true);
    }
  });

  it('does not let a VIEWER satisfy MEMBER or above', () => {
    expect(hasAtLeastRole(WorkspaceRole.VIEWER, WorkspaceRole.VIEWER)).toBe(true);
    expect(hasAtLeastRole(WorkspaceRole.VIEWER, WorkspaceRole.MEMBER)).toBe(false);
    expect(hasAtLeastRole(WorkspaceRole.VIEWER, WorkspaceRole.ADMIN)).toBe(false);
    expect(hasAtLeastRole(WorkspaceRole.VIEWER, WorkspaceRole.OWNER)).toBe(false);
  });

  it('does not let a MEMBER satisfy ADMIN', () => {
    expect(hasAtLeastRole(WorkspaceRole.MEMBER, WorkspaceRole.ADMIN)).toBe(false);
  });

  it('labels every role', () => {
    for (const role of Object.values(WorkspaceRole)) {
      expect(ROLE_LABELS[role]).toBeTruthy();
    }
  });
});
