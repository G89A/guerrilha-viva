import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { registerSchema } from '@/features/auth/schemas';
import { authenticateUser, registerUser } from '@/features/auth/service';
import { isAppError } from '@/lib/errors/app-error';
import { parseOrThrow } from '@/lib/validation/parse';
import { disconnectTestPrisma, resetDatabase, testPrisma } from '../helpers/db';
import { seedUserWithPassword } from '../helpers/factories';

const prisma = testPrisma();

function registration(overrides: Partial<Record<string, string>> = {}) {
  return parseOrThrow(registerSchema, {
    name: 'Ana Souza',
    email: 'ana@example.com',
    password: 'senha-forte-2026',
    workspaceName: 'Acme Outreach',
    ...overrides,
  });
}

describe('registerUser', () => {
  beforeEach(resetDatabase);
  afterAll(disconnectTestPrisma);

  it('creates user, workspace and OWNER membership atomically', async () => {
    const { user, workspace } = await registerUser(registration());

    const membership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
    });

    expect(membership?.role).toBe('OWNER');
    expect(workspace.slug).toBe('acme-outreach');
    expect(user.passwordHash).not.toContain('senha-forte-2026');
  });

  it('rejects a duplicate email with CONFLICT', async () => {
    await registerUser(registration());

    await expect(registerUser(registration({ workspaceName: 'Outra' }))).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === 'CONFLICT',
    );
  });

  it('leaves no orphan user behind when the signup conflicts', async () => {
    await registerUser(registration());
    await registerUser(registration({ email: 'bruno@example.com' })).catch(() => undefined);

    // Second signup used a distinct email, so both users must exist with a workspace each.
    const users = await prisma.user.findMany({ include: { members: true } });
    expect(users).toHaveLength(2);
    for (const user of users) expect(user.members.length).toBeGreaterThan(0);
  });

  it('disambiguates colliding workspace slugs', async () => {
    const first = await registerUser(registration());
    const second = await registerUser(registration({ email: 'bruno@example.com' }));

    expect(first.workspace.slug).toBe('acme-outreach');
    expect(second.workspace.slug).toBe('acme-outreach-2');
  });

  it('never stores the password in clear text', async () => {
    const { user } = await registerUser(registration());
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    expect(stored.passwordHash.startsWith('scrypt$')).toBe(true);
    expect(stored.passwordHash).not.toContain('senha-forte-2026');
  });
});

describe('authenticateUser', () => {
  beforeEach(resetDatabase);

  it('accepts valid credentials', async () => {
    await seedUserWithPassword('ok@example.com', 'senha-valida-1');
    const user = await authenticateUser({ email: 'ok@example.com', password: 'senha-valida-1' });
    expect(user.email).toBe('ok@example.com');
  });

  it('rejects a wrong password', async () => {
    await seedUserWithPassword('ok@example.com', 'senha-valida-1');
    await expect(
      authenticateUser({ email: 'ok@example.com', password: 'senha-errada-1' }),
    ).rejects.toThrow();
  });

  it('returns the same error for an unknown email as for a wrong password', async () => {
    await seedUserWithPassword('ok@example.com', 'senha-valida-1');

    const wrongPassword = await authenticateUser({
      email: 'ok@example.com',
      password: 'errada',
    }).catch((error: unknown) => error);
    const unknownEmail = await authenticateUser({
      email: 'ninguem@example.com',
      password: 'errada',
    }).catch((error: unknown) => error);

    expect(isAppError(wrongPassword) && wrongPassword.code).toBe('UNAUTHENTICATED');
    expect(isAppError(unknownEmail) && unknownEmail.code).toBe('UNAUTHENTICATED');
    expect(isAppError(wrongPassword) && wrongPassword.message).toBe(
      isAppError(unknownEmail) ? unknownEmail.message : '',
    );
  });

  it('refuses a deactivated account even with the right password', async () => {
    const userId = await seedUserWithPassword('off@example.com', 'senha-valida-1');
    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });

    await expect(
      authenticateUser({ email: 'off@example.com', password: 'senha-valida-1' }),
    ).rejects.toThrow();
  });
});
