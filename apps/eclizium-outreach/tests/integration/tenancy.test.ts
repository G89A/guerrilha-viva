/**
 * RED TEAM — multi-tenancy.
 *
 * Every test here plays the attacker: an authenticated user of workspace A
 * trying to read or act on workspace B. Each one must end in a denial, not in
 * data. If any of these ever passes silently, the product has a tenant leak.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceRole } from '@prisma/client';
import type * as SessionModule from '@/lib/auth/session';
import { disconnectTestPrisma, resetDatabase, testPrisma } from '../helpers/db';
import { seedContact, seedTenant, type SeededTenant } from '../helpers/factories';

const prisma = testPrisma();

const sessionMock = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
}));

vi.mock('@/lib/auth/session', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionModule>();
  return { ...actual, getCurrentSession: sessionMock.getCurrentSession };
});

const { assertWorkspaceMembership, requireWorkspace, requireWorkspaceRole, workspaceScope } =
  await import('@/lib/auth/guards');
const { isAppError } = await import('@/lib/errors/app-error');

// NOTE: `requireWorkspace` is wrapped in React `cache()`. Outside a render there
// is no cache dispatcher, so React falls through to calling the function
// directly — each call below really re-queries the database.

/** Signs the given user in, optionally with a chosen active workspace. */
async function signIn(tenant: SeededTenant, activeWorkspaceId?: string | null): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: tenant.userId } });
  sessionMock.getCurrentSession.mockResolvedValue({
    user,
    session: {
      id: 'session_test',
      userId: user.id,
      tokenHash: 'irrelevant',
      activeWorkspaceId: activeWorkspaceId === undefined ? tenant.workspaceId : activeWorkspaceId,
      ipAddress: null,
      userAgent: null,
      expiresAt: new Date(Date.now() + 60_000),
      lastUsedAt: new Date(),
      revokedAt: null,
      createdAt: new Date(),
    },
  });
}

describe('multi-tenant isolation', () => {
  let attacker: SeededTenant;
  let victim: SeededTenant;

  beforeEach(async () => {
    await resetDatabase();
    attacker = await seedTenant('attacker');
    victim = await seedTenant('victim');
  });

  afterEach(() => {
    sessionMock.getCurrentSession.mockReset();
  });

  afterAll(disconnectTestPrisma);

  it('denies membership assertion for a foreign workspace', async () => {
    await expect(
      assertWorkspaceMembership(attacker.userId, victim.workspaceId),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === 'FORBIDDEN');
  });

  it('does not distinguish a foreign workspace from a non-existent one', async () => {
    const foreign = await assertWorkspaceMembership(attacker.userId, victim.workspaceId).catch(
      (error: unknown) => error,
    );
    const missing = await assertWorkspaceMembership(attacker.userId, 'ws_does_not_exist').catch(
      (error: unknown) => error,
    );

    expect(isAppError(foreign) && foreign.code).toBe('FORBIDDEN');
    expect(isAppError(missing) && missing.code).toBe('FORBIDDEN');
    expect(isAppError(foreign) && foreign.message).toBe(isAppError(missing) ? missing.message : '');
  });

  it('ignores a session pointing at a workspace the user does not belong to', async () => {
    // Simulates a forged/stale session claim: the id is real, the membership is not.
    await signIn(attacker, victim.workspaceId);

    const context = await requireWorkspace();
    expect(context.workspace.id).toBe(attacker.workspaceId);
    expect(context.workspace.id).not.toBe(victim.workspaceId);
  });

  it('falls back to another membership when the active workspace was revoked', async () => {
    await prisma.workspaceMember.create({
      data: {
        workspaceId: victim.workspaceId,
        userId: attacker.userId,
        role: WorkspaceRole.MEMBER,
      },
    });
    await signIn(attacker, victim.workspaceId);

    const before = await requireWorkspace();
    expect(before.workspace.id).toBe(victim.workspaceId);

    await prisma.workspaceMember.deleteMany({
      where: { workspaceId: victim.workspaceId, userId: attacker.userId },
    });

    const after = await requireWorkspace();
    expect(after.workspace.id).toBe(attacker.workspaceId);
  });

  it('refuses to resolve a workspace for a user with no membership at all', async () => {
    const orphan = await prisma.user.create({
      data: { email: 'orphan@example.test', name: 'Orphan', passwordHash: 'scrypt$x' },
    });
    sessionMock.getCurrentSession.mockResolvedValue({
      user: orphan,
      session: {
        id: 'session_orphan',
        userId: orphan.id,
        tokenHash: 'irrelevant',
        activeWorkspaceId: null,
        ipAddress: null,
        userAgent: null,
        expiresAt: new Date(Date.now() + 60_000),
        lastUsedAt: new Date(),
        revokedAt: null,
        createdAt: new Date(),
      },
    });

    await expect(requireWorkspace()).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === 'FORBIDDEN',
    );
  });

  it('rejects an unauthenticated caller before any query runs', async () => {
    sessionMock.getCurrentSession.mockResolvedValue(null);

    await expect(requireWorkspace()).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === 'UNAUTHENTICATED',
    );
  });

  it('scopes reads so a foreign contact is invisible even by id', async () => {
    const victimContactId = await seedContact(victim.workspaceId, '+5511999990001');
    await signIn(attacker);

    const context = await requireWorkspace();

    const byId = await prisma.contact.findFirst({
      where: { id: victimContactId, ...workspaceScope(context) },
    });
    const all = await prisma.contact.findMany({ where: workspaceScope(context) });

    expect(byId).toBeNull();
    expect(all).toHaveLength(0);
  });

  it('scopes writes so a foreign contact cannot be mutated', async () => {
    const victimContactId = await seedContact(victim.workspaceId, '+5511999990002');
    await signIn(attacker);

    const context = await requireWorkspace();
    const result = await prisma.contact.updateMany({
      where: { id: victimContactId, ...workspaceScope(context) },
      data: { firstName: 'Invadido' },
    });

    expect(result.count).toBe(0);
    const untouched = await prisma.contact.findUniqueOrThrow({ where: { id: victimContactId } });
    expect(untouched.firstName).toBe('Contato');
  });

  it('scopes deletes so a foreign contact survives', async () => {
    const victimContactId = await seedContact(victim.workspaceId, '+5511999990003');
    await signIn(attacker);

    const context = await requireWorkspace();
    const result = await prisma.contact.deleteMany({
      where: { id: victimContactId, ...workspaceScope(context) },
    });

    expect(result.count).toBe(0);
    await expect(
      prisma.contact.findUnique({ where: { id: victimContactId } }),
    ).resolves.not.toBeNull();
  });

  it('enforces the role floor for privileged actions', async () => {
    await prisma.workspaceMember.updateMany({
      where: { workspaceId: attacker.workspaceId, userId: attacker.userId },
      data: { role: WorkspaceRole.VIEWER },
    });
    await signIn(attacker);

    await expect(requireWorkspaceRole(WorkspaceRole.ADMIN)).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === 'FORBIDDEN',
    );
  });

  it('allows a privileged action for a sufficient role', async () => {
    await signIn(attacker);
    const context = await requireWorkspaceRole(WorkspaceRole.ADMIN);
    expect(context.workspace.id).toBe(attacker.workspaceId);
  });
});
