import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { writeAuditLog } from '@/lib/audit/audit-log';
import { disconnectTestPrisma, resetDatabase, testPrisma } from '../helpers/db';
import { seedTenant } from '../helpers/factories';

const prisma = testPrisma();

describe('writeAuditLog', () => {
  beforeEach(resetDatabase);
  afterAll(disconnectTestPrisma);

  it('records the action with actor and workspace', async () => {
    const tenant = await seedTenant();

    await writeAuditLog({
      action: 'workspace.updated',
      resourceType: 'Workspace',
      resourceId: tenant.workspaceId,
      workspaceId: tenant.workspaceId,
      actorUserId: tenant.userId,
      metadata: { from: 'Antes', to: 'Depois' },
      ipAddress: '203.0.113.10',
    });

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });

    expect(entry.action).toBe('workspace.updated');
    expect(entry.actorUserId).toBe(tenant.userId);
    expect(entry.actorType).toBe('USER');
    expect(entry.metadata).toEqual({ from: 'Antes', to: 'Depois' });
    expect(entry.ipAddress).toBe('203.0.113.10');
  });

  it('supports system actors without a user', async () => {
    await writeAuditLog({
      action: 'user.login_failed',
      resourceType: 'User',
      actorType: 'SYSTEM',
      metadata: { email: 'quem@example.test' },
    });

    const entry = await prisma.auditLog.findFirstOrThrow();
    expect(entry.actorUserId).toBeNull();
    expect(entry.actorType).toBe('SYSTEM');
  });

  it('never propagates a write failure to the caller', async () => {
    // A non-existent actor violates the FK: the audit write must fail silently.
    await expect(
      writeAuditLog({
        action: 'user.logged_out',
        resourceType: 'Session',
        actorUserId: 'user_does_not_exist',
      }),
    ).resolves.toBeUndefined();

    await expect(prisma.auditLog.count()).resolves.toBe(0);
  });

  it('survives the deletion of the workspace it references', async () => {
    const tenant = await seedTenant();
    await writeAuditLog({
      action: 'workspace.created',
      resourceType: 'Workspace',
      resourceId: tenant.workspaceId,
      workspaceId: tenant.workspaceId,
      actorUserId: tenant.userId,
    });

    await prisma.workspace.delete({ where: { id: tenant.workspaceId } });

    const entry = await prisma.auditLog.findFirstOrThrow();
    expect(entry.workspaceId).toBeNull();
    expect(entry.action).toBe('workspace.created');
  });
});
