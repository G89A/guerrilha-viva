import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createSession,
  revokeAllUserSessions,
  revokeSession,
  setActiveWorkspace,
  validateSessionToken,
} from '@/lib/auth/session';
import { sha256 } from '@/lib/security/crypto';
import { disconnectTestPrisma, resetDatabase, testPrisma } from '../helpers/db';
import { seedTenant } from '../helpers/factories';

const prisma = testPrisma();

describe('sessions', () => {
  beforeEach(resetDatabase);
  afterAll(disconnectTestPrisma);

  it('stores only the token hash, never the token', async () => {
    const tenant = await seedTenant();
    const { token, session } = await createSession({ userId: tenant.userId });

    const stored = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(stored.tokenHash).toBe(sha256(token));
    expect(stored.tokenHash).not.toBe(token);

    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM sessions WHERE token_hash = ${token}
    `;
    expect(Number(rows[0]?.count ?? 0)).toBe(0);
  });

  it('resolves a valid token to its user', async () => {
    const tenant = await seedTenant();
    const { token } = await createSession({ userId: tenant.userId });

    const resolved = await validateSessionToken(token);
    expect(resolved?.user.id).toBe(tenant.userId);
  });

  it('rejects an unknown or tampered token', async () => {
    const tenant = await seedTenant();
    const { token } = await createSession({ userId: tenant.userId });

    await expect(validateSessionToken(`${token}x`)).resolves.toBeNull();
    await expect(validateSessionToken('')).resolves.toBeNull();
    await expect(validateSessionToken('completely-made-up')).resolves.toBeNull();
  });

  it('rejects and cleans up an expired session', async () => {
    const tenant = await seedTenant();
    const { token, session } = await createSession({ userId: tenant.userId });
    await prisma.session.update({
      where: { id: session.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(validateSessionToken(token)).resolves.toBeNull();
    await expect(prisma.session.findUnique({ where: { id: session.id } })).resolves.toBeNull();
  });

  it('rejects a revoked session', async () => {
    const tenant = await seedTenant();
    const { token, session } = await createSession({ userId: tenant.userId });

    await revokeSession(session.id);
    await expect(validateSessionToken(token)).resolves.toBeNull();
  });

  it('rejects every session of a deactivated user', async () => {
    const tenant = await seedTenant();
    const { token } = await createSession({ userId: tenant.userId });
    await prisma.user.update({ where: { id: tenant.userId }, data: { isActive: false } });

    await expect(validateSessionToken(token)).resolves.toBeNull();
  });

  it('revokes all sessions of a user at once', async () => {
    const tenant = await seedTenant();
    const first = await createSession({ userId: tenant.userId });
    const second = await createSession({ userId: tenant.userId });

    await revokeAllUserSessions(tenant.userId);

    await expect(validateSessionToken(first.token)).resolves.toBeNull();
    await expect(validateSessionToken(second.token)).resolves.toBeNull();
  });

  it('issues a distinct token per session', async () => {
    const tenant = await seedTenant();
    const first = await createSession({ userId: tenant.userId });
    const second = await createSession({ userId: tenant.userId });

    expect(first.token).not.toBe(second.token);
  });

  it('persists the active workspace on the session', async () => {
    const tenant = await seedTenant();
    const { token, session } = await createSession({ userId: tenant.userId });

    await setActiveWorkspace(session.id, tenant.workspaceId);
    const resolved = await validateSessionToken(token);

    expect(resolved?.session.activeWorkspaceId).toBe(tenant.workspaceId);
  });
});
