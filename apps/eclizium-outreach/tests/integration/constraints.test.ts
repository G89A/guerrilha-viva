/**
 * RED TEAM — database invariants.
 *
 * These constraints are the last line of defence behind the services: even if a
 * future worker forgets a check, the database must refuse duplicated sends,
 * duplicated contacts and reprocessed webhook events.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { disconnectTestPrisma, resetDatabase, testPrisma } from '../helpers/db';
import { seedContact, seedTenant, type SeededTenant } from '../helpers/factories';

const prisma = testPrisma();

async function seedChannel(workspaceId: string) {
  return prisma.messagingChannel.create({
    data: { workspaceId, displayName: 'Canal Teste', phoneNumberId: `pn_${workspaceId}` },
  });
}

describe('database constraints', () => {
  let alpha: SeededTenant;
  let beta: SeededTenant;

  beforeEach(async () => {
    await resetDatabase();
    alpha = await seedTenant('alpha');
    beta = await seedTenant('beta');
  });

  afterAll(disconnectTestPrisma);

  it('rejects a duplicated phone within the same workspace', async () => {
    await seedContact(alpha.workspaceId, '+5511988887777');
    await expect(seedContact(alpha.workspaceId, '+5511988887777')).rejects.toThrow();
  });

  it('allows the same phone in two different workspaces', async () => {
    await seedContact(alpha.workspaceId, '+5511988887777');
    await expect(seedContact(beta.workspaceId, '+5511988887777')).resolves.toBeTruthy();
  });

  it('rejects a duplicated suppression entry per workspace', async () => {
    await prisma.suppressionEntry.create({
      data: { workspaceId: alpha.workspaceId, phoneE164: '+5511900000000', reason: 'OPT_OUT' },
    });

    await expect(
      prisma.suppressionEntry.create({
        data: { workspaceId: alpha.workspaceId, phoneE164: '+5511900000000', reason: 'MANUAL' },
      }),
    ).rejects.toThrow();
  });

  it('rejects a second recipient row for the same campaign/contact pair', async () => {
    const contactId = await seedContact(alpha.workspaceId, '+5511911112222');
    const campaign = await prisma.campaign.create({
      data: { workspaceId: alpha.workspaceId, name: 'Campanha' },
    });

    await prisma.campaignRecipient.create({
      data: {
        workspaceId: alpha.workspaceId,
        campaignId: campaign.id,
        contactId,
        idempotencyKey: `${campaign.id}:${contactId}:1`,
      },
    });

    await expect(
      prisma.campaignRecipient.create({
        data: {
          workspaceId: alpha.workspaceId,
          campaignId: campaign.id,
          contactId,
          idempotencyKey: `${campaign.id}:${contactId}:2`,
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects a reused idempotency key', async () => {
    const first = await seedContact(alpha.workspaceId, '+5511911113333');
    const second = await seedContact(alpha.workspaceId, '+5511911114444');
    const campaign = await prisma.campaign.create({
      data: { workspaceId: alpha.workspaceId, name: 'Campanha' },
    });

    await prisma.campaignRecipient.create({
      data: {
        workspaceId: alpha.workspaceId,
        campaignId: campaign.id,
        contactId: first,
        idempotencyKey: 'chave-repetida',
      },
    });

    await expect(
      prisma.campaignRecipient.create({
        data: {
          workspaceId: alpha.workspaceId,
          campaignId: campaign.id,
          contactId: second,
          idempotencyKey: 'chave-repetida',
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects a duplicated provider message id within a workspace', async () => {
    const channel = await seedChannel(alpha.workspaceId);
    const contactId = await seedContact(alpha.workspaceId, '+5511922223333');

    const base = {
      workspaceId: alpha.workspaceId,
      channelId: channel.id,
      contactId,
      direction: 'OUTBOUND',
      providerMessageId: 'wamid.HBgL',
    } as const;

    await prisma.message.create({ data: base });
    await expect(prisma.message.create({ data: base })).rejects.toThrow();
  });

  it('allows many messages with no provider id yet (queued)', async () => {
    const channel = await seedChannel(alpha.workspaceId);
    const contactId = await seedContact(alpha.workspaceId, '+5511922224444');

    const base = {
      workspaceId: alpha.workspaceId,
      channelId: channel.id,
      contactId,
      direction: 'OUTBOUND',
    } as const;

    await prisma.message.create({ data: base });
    await expect(prisma.message.create({ data: base })).resolves.toBeTruthy();
  });

  it('rejects a redelivered webhook event', async () => {
    await prisma.webhookEvent.create({
      data: { providerEventId: 'evt_1', payload: { hello: 'world' } },
    });

    await expect(
      prisma.webhookEvent.create({
        data: { providerEventId: 'evt_1', payload: { hello: 'again' } },
      }),
    ).rejects.toThrow();
  });

  it('rejects a duplicated membership for the same user and workspace', async () => {
    await expect(
      prisma.workspaceMember.create({
        data: { workspaceId: alpha.workspaceId, userId: alpha.userId, role: 'ADMIN' },
      }),
    ).rejects.toThrow();
  });

  it('cascades workspace deletion to its scoped rows', async () => {
    await seedContact(alpha.workspaceId, '+5511933334444');
    await prisma.workspace.delete({ where: { id: alpha.workspaceId } });

    await expect(
      prisma.contact.count({ where: { workspaceId: alpha.workspaceId } }),
    ).resolves.toBe(0);
    // The other tenant is untouched.
    await expect(prisma.workspace.count({ where: { id: beta.workspaceId } })).resolves.toBe(1);
  });
});
