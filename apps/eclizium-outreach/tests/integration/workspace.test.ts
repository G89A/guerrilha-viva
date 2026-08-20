import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceRole } from '@prisma/client';
import {
  createWorkspaceForUser,
  listWorkspaceMembers,
  listWorkspacesForUser,
  renameWorkspace,
} from '@/features/workspaces/service';
import { disconnectTestPrisma, resetDatabase, testPrisma } from '../helpers/db';
import { seedTenant } from '../helpers/factories';

const prisma = testPrisma();

describe('workspace service', () => {
  beforeEach(resetDatabase);
  afterAll(disconnectTestPrisma);

  it('creates the workspace with an OWNER membership', async () => {
    const tenant = await seedTenant();
    const workspace = await createWorkspaceForUser({
      name: 'Segunda Operação',
      ownerUserId: tenant.userId,
    });

    const membership = await prisma.workspaceMember.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: tenant.userId } },
    });
    expect(membership.role).toBe(WorkspaceRole.OWNER);
  });

  it('generates unique slugs under repeated identical names', async () => {
    const tenant = await seedTenant();
    const slugs: string[] = [];

    for (let index = 0; index < 4; index += 1) {
      const workspace = await createWorkspaceForUser({
        name: 'Mesma Operação',
        ownerUserId: tenant.userId,
      });
      slugs.push(workspace.slug);
    }

    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('lists only the workspaces the user belongs to', async () => {
    const mine = await seedTenant('mine');
    const theirs = await seedTenant('theirs');

    const listed = await listWorkspacesForUser(mine.userId);
    const ids = listed.map((workspace) => workspace.id);

    expect(ids).toContain(mine.workspaceId);
    expect(ids).not.toContain(theirs.workspaceId);
  });

  it('renames a workspace without touching its slug', async () => {
    const tenant = await seedTenant();
    const renamed = await renameWorkspace(tenant.workspaceId, 'Nome Novo');

    expect(renamed.name).toBe('Nome Novo');
    expect(renamed.slug).toBe(tenant.workspaceSlug);
  });

  it('lists members of one workspace only', async () => {
    const mine = await seedTenant('mine');
    const theirs = await seedTenant('theirs');

    const members = await listWorkspaceMembers(mine.workspaceId);
    expect(members).toHaveLength(1);
    expect(members[0]?.userId).toBe(mine.userId);
    expect(members.map((member) => member.userId)).not.toContain(theirs.userId);
  });
});
