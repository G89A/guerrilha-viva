import { beforeEach, describe, expect, it } from 'vitest';
import { CampaignStatus, RecipientEligibility, RecipientStatus } from '@prisma/client';
import {
  cancelCampaign,
  pauseCampaign,
  prepareCampaign,
  resumeCampaign,
  startCampaign,
} from '@/features/campaigns/campaign-service';
import { reconcileCampaignMetrics } from '@/features/campaigns/metrics';
import { resetDatabase, testPrisma } from '../helpers/db';
import {
  seedCampaign,
  seedChannel,
  seedContactsBulk,
  seedEligibleContact,
  seedTemplate,
  seedTenant,
} from '../helpers/factories';

/**
 * Concorrência é requisito, não detalhe.
 *
 * A Sprint 3 mostrou que uma corrida pode causar perda silenciosa de dados. Cada
 * operação crítica do motor de campanhas é exercitada aqui com chamadas
 * realmente simultâneas.
 */

async function readyCampaign(label: string, contacts = 5) {
  const tenant = await seedTenant(label);
  const channel = await seedChannel(tenant.workspaceId);
  const template = await seedTemplate(tenant.workspaceId, channel.id);

  for (let index = 0; index < contacts; index += 1) {
    await seedEligibleContact(tenant.workspaceId, `+55859999${String(1000 + index)}`);
  }

  const campaign = await seedCampaign(tenant.workspaceId, {
    channelId: channel.id,
    templateId: template.id,
    createdById: tenant.userId,
  });

  return { tenant, channel, template, campaign };
}

function settledOk<T>(results: PromiseSettledResult<T>[]): T[] {
  return results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
}

describe('preparação concorrente', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it.each([6, 20])(
    '%i preparações simultâneas não duplicam destinatários',
    async (parallelism) => {
      const context = await readyCampaign(`prep-${parallelism}`, 8);

      const results = await Promise.allSettled(
        Array.from({ length: parallelism }, () =>
          prepareCampaign({
            workspaceId: context.tenant.workspaceId,
            campaignId: context.campaign.id,
            actorUserId: context.tenant.userId,
          }),
        ),
      );

      // Exatamente uma chamada entra em PREPARING; as demais são recusadas.
      expect(settledOk(results)).toHaveLength(1);

      const recipients = await testPrisma().campaignRecipient.findMany({
        where: { campaignId: context.campaign.id },
        select: { contactId: true },
      });
      expect(recipients).toHaveLength(8);
      // Cada contato aparece uma única vez.
      expect(new Set(recipients.map((row) => row.contactId)).size).toBe(8);
    },
  );

  it('50 preparações simultâneas mantêm a campanha consistente', async () => {
    const context = await readyCampaign('prep-50', 5);

    await Promise.allSettled(
      Array.from({ length: 50 }, () =>
        prepareCampaign({
          workspaceId: context.tenant.workspaceId,
          campaignId: context.campaign.id,
          actorUserId: context.tenant.userId,
        }),
      ),
    );

    const campaign = await testPrisma().campaign.findUniqueOrThrow({
      where: { id: context.campaign.id },
    });
    // Nunca fica presa em PREPARING.
    expect([CampaignStatus.READY, CampaignStatus.FAILED]).toContain(campaign.status);

    await expect(
      testPrisma().campaignRecipient.count({ where: { campaignId: context.campaign.id } }),
    ).resolves.toBe(5);
  });

  it('repreparar depois de pronta não duplica nem perde ninguém', async () => {
    const context = await readyCampaign('prep-again', 6);
    const input = {
      workspaceId: context.tenant.workspaceId,
      campaignId: context.campaign.id,
      actorUserId: context.tenant.userId,
    };

    const first = await prepareCampaign(input);
    const second = await prepareCampaign(input);

    expect(first.created).toBe(6);
    // A chave determinística faz a segunda preparação não criar nada novo.
    expect(second.created).toBe(0);
    await expect(
      testPrisma().campaignRecipient.count({ where: { campaignId: context.campaign.id } }),
    ).resolves.toBe(6);
  });
});

describe('transições concorrentes', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function runningCampaign(label: string) {
    const context = await readyCampaign(label, 3);
    await prepareCampaign({
      workspaceId: context.tenant.workspaceId,
      campaignId: context.campaign.id,
      actorUserId: context.tenant.userId,
    });
    await startCampaign({
      workspaceId: context.tenant.workspaceId,
      campaignId: context.campaign.id,
    });
    return context;
  }

  it('20 pauses simultâneos: um vence, estado previsível', async () => {
    const context = await runningCampaign('pause-20');

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        pauseCampaign({
          workspaceId: context.tenant.workspaceId,
          campaignId: context.campaign.id,
        }),
      ),
    );

    expect(settledOk(results)).toHaveLength(1);
    const campaign = await testPrisma().campaign.findUniqueOrThrow({
      where: { id: context.campaign.id },
    });
    expect(campaign.status).toBe(CampaignStatus.PAUSED);
    expect(campaign.pausedAt).not.toBeNull();
  });

  it('pause e resume disputando terminam num dos dois estados, nunca corrompidos', async () => {
    const context = await runningCampaign('pause-resume');
    const input = {
      workspaceId: context.tenant.workspaceId,
      campaignId: context.campaign.id,
    };

    await Promise.allSettled([
      pauseCampaign(input),
      resumeCampaign(input),
      pauseCampaign(input),
      resumeCampaign(input),
      pauseCampaign(input),
    ]);

    const campaign = await testPrisma().campaign.findUniqueOrThrow({
      where: { id: context.campaign.id },
    });
    expect([CampaignStatus.RUNNING, CampaignStatus.PAUSED]).toContain(campaign.status);
  });

  it('cancelar durante preparação não deixa estado inconsistente', async () => {
    const context = await readyCampaign('cancel-prep', 10);
    const input = {
      workspaceId: context.tenant.workspaceId,
      campaignId: context.campaign.id,
    };

    await Promise.allSettled([
      prepareCampaign({ ...input, actorUserId: context.tenant.userId }),
      cancelCampaign(input),
    ]);

    const campaign = await testPrisma().campaign.findUniqueOrThrow({
      where: { id: context.campaign.id },
    });
    // Qualquer um dos dois pode vencer; o que não pode é ficar em PREPARING.
    expect(campaign.status).not.toBe(CampaignStatus.PREPARING);
  });

  it('20 cancelamentos simultâneos: um vence e a campanha não ressuscita', async () => {
    const context = await runningCampaign('cancel-20');

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        cancelCampaign({
          workspaceId: context.tenant.workspaceId,
          campaignId: context.campaign.id,
        }),
      ),
    );

    expect(settledOk(results)).toHaveLength(1);
    const campaign = await testPrisma().campaign.findUniqueOrThrow({
      where: { id: context.campaign.id },
    });
    expect(campaign.status).toBe(CampaignStatus.CANCELLED);
  });

  it('resume depois de cancelada é sempre recusado', async () => {
    const context = await runningCampaign('resume-cancelled');
    const input = {
      workspaceId: context.tenant.workspaceId,
      campaignId: context.campaign.id,
    };

    await cancelCampaign(input);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => resumeCampaign(input)),
    );
    expect(settledOk(results)).toHaveLength(0);

    const campaign = await testPrisma().campaign.findUniqueOrThrow({
      where: { id: context.campaign.id },
    });
    expect(campaign.status).toBe(CampaignStatus.CANCELLED);
  });

  it('start simultâneo não duplica o início', async () => {
    const context = await readyCampaign('start-race', 4);
    await prepareCampaign({
      workspaceId: context.tenant.workspaceId,
      campaignId: context.campaign.id,
      actorUserId: context.tenant.userId,
    });

    const results = await Promise.allSettled(
      Array.from({ length: 15 }, () =>
        startCampaign({
          workspaceId: context.tenant.workspaceId,
          campaignId: context.campaign.id,
        }),
      ),
    );

    expect(settledOk(results)).toHaveLength(1);
  });
});

describe('métricas sob concorrência', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('reconciliações simultâneas convergem para o mesmo valor', async () => {
    const context = await readyCampaign('metrics-race', 12);
    await prepareCampaign({
      workspaceId: context.tenant.workspaceId,
      campaignId: context.campaign.id,
      actorUserId: context.tenant.userId,
    });

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        reconcileCampaignMetrics(context.tenant.workspaceId, context.campaign.id),
      ),
    );

    // Todas veem o mesmo total: a métrica é calculada, não incrementada.
    expect(new Set(results.map((metrics) => metrics.total)).size).toBe(1);
    expect(results[0]?.total).toBe(12);

    const campaign = await testPrisma().campaign.findUniqueOrThrow({
      where: { id: context.campaign.id },
    });
    expect(campaign.totalRecipients).toBe(12);
    expect(campaign.eligibleRecipients).toBe(12);
  });

  it('mudanças simultâneas de destinatário não corrompem a contagem', async () => {
    const context = await readyCampaign('metrics-mutate', 20);
    await prepareCampaign({
      workspaceId: context.tenant.workspaceId,
      campaignId: context.campaign.id,
      actorUserId: context.tenant.userId,
    });

    const recipients = await testPrisma().campaignRecipient.findMany({
      where: { campaignId: context.campaign.id },
      select: { id: true },
    });

    // Metade vira FAILED enquanto reconciliações rodam junto.
    await Promise.all([
      ...recipients.slice(0, 10).map((recipient) =>
        testPrisma().campaignRecipient.update({
          where: { id: recipient.id },
          data: { status: RecipientStatus.FAILED, failedAt: new Date() },
        }),
      ),
      ...Array.from({ length: 5 }, () =>
        reconcileCampaignMetrics(context.tenant.workspaceId, context.campaign.id),
      ),
    ]);

    const metrics = await reconcileCampaignMetrics(
      context.tenant.workspaceId,
      context.campaign.id,
    );
    expect(metrics.total).toBe(20);
    expect(metrics.failed).toBe(10);
    expect(metrics.eligible).toBe(10);
  });
});

describe('cancelamento preserva histórico', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('só cancela quem ainda não saiu', async () => {
    const context = await readyCampaign('cancel-history', 6);
    await prepareCampaign({
      workspaceId: context.tenant.workspaceId,
      campaignId: context.campaign.id,
      actorUserId: context.tenant.userId,
    });
    await startCampaign({
      workspaceId: context.tenant.workspaceId,
      campaignId: context.campaign.id,
    });

    const recipients = await testPrisma().campaignRecipient.findMany({
      where: { campaignId: context.campaign.id },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    // Simula que dois já foram enviados.
    await testPrisma().campaignRecipient.updateMany({
      where: { id: { in: recipients.slice(0, 2).map((row) => row.id) } },
      data: { status: RecipientStatus.SENT, sentAt: new Date() },
    });

    const outcome = await cancelCampaign({
      workspaceId: context.tenant.workspaceId,
      campaignId: context.campaign.id,
    });

    expect(outcome.cancelledRecipients).toBe(4);
    // O histórico de quem recebeu não é reescrito.
    await expect(
      testPrisma().campaignRecipient.count({
        where: { campaignId: context.campaign.id, status: RecipientStatus.SENT },
      }),
    ).resolves.toBe(2);
    // E a avaliação de elegibilidade continua registrada.
    await expect(
      testPrisma().campaignRecipient.count({
        where: { campaignId: context.campaign.id, eligibility: RecipientEligibility.ELIGIBLE },
      }),
    ).resolves.toBe(6);
  });
});

describe('escala', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('materializa 1000 contatos em blocos, sem carregar tudo de uma vez', async () => {
    const tenant = await seedTenant('escala-1k');
    const channel = await seedChannel(tenant.workspaceId);
    const template = await seedTemplate(tenant.workspaceId, channel.id);
    await seedContactsBulk(tenant.workspaceId, 1000, { consent: 'GRANTED' });

    const campaign = await seedCampaign(tenant.workspaceId, {
      channelId: channel.id,
      templateId: template.id,
    });

    const report = await prepareCampaign({
      workspaceId: tenant.workspaceId,
      campaignId: campaign.id,
      actorUserId: tenant.userId,
    });

    expect(report.breakdown.total).toBe(1000);
    expect(report.created).toBe(1000);
    // 1000 contatos em blocos de 500 = pelo menos 2 idas ao banco.
    expect(report.chunks).toBeGreaterThanOrEqual(2);

    await expect(
      testPrisma().campaignRecipient.count({ where: { campaignId: campaign.id } }),
    ).resolves.toBe(1000);
  }, 120_000);
});
