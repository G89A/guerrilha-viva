import { beforeEach, describe, expect, it } from 'vitest';
import { CampaignStatus, ConsentStatus, RecipientStatus } from '@prisma/client';
import {
  cancelCampaign,
  createCampaign,
  getCampaignOrThrow,
  pauseCampaign,
  prepareCampaign,
  resumeCampaign,
  scheduleCampaign,
  startCampaign,
  updateCampaign,
} from '@/features/campaigns/campaign-service';
import { computeRates, reconcileCampaignMetrics } from '@/features/campaigns/metrics';
import { queueExecutionService } from '@/features/campaigns/execution-service';
import { audienceFiltersSchema } from '@/features/campaigns/schemas';
import { resetDatabase, testPrisma } from '../helpers/db';
import {
  seedCampaign,
  seedChannel,
  seedContact,
  seedEligibleContact,
  seedTemplate,
  seedTenant,
} from '../helpers/factories';

/** Red team do Sprint 4. Cada teste descreve o ataque e o comportamento certo. */

async function tenantReady(label: string, contacts = 3) {
  const tenant = await seedTenant(label);
  const channel = await seedChannel(tenant.workspaceId);
  const template = await seedTemplate(tenant.workspaceId, channel.id);
  for (let index = 0; index < contacts; index += 1) {
    await seedEligibleContact(tenant.workspaceId, `+5585977${String(770000 + index)}`);
  }
  const campaign = await seedCampaign(tenant.workspaceId, {
    channelId: channel.id,
    templateId: template.id,
    createdById: tenant.userId,
  });
  return { tenant, channel, template, campaign };
}

describe('red team — ataque entre workspaces', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('campanha de outro workspace não é encontrada', async () => {
    const alvo = await tenantReady('rt-alvo');
    const atacante = await seedTenant('rt-atacante');

    await expect(
      getCampaignOrThrow(atacante.workspaceId, alvo.campaign.id),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it.each([
    ['preparar', (workspaceId: string, campaignId: string, userId: string) =>
      prepareCampaign({ workspaceId, campaignId, actorUserId: userId })],
    ['iniciar', (workspaceId: string, campaignId: string) =>
      startCampaign({ workspaceId, campaignId })],
    ['pausar', (workspaceId: string, campaignId: string) =>
      pauseCampaign({ workspaceId, campaignId })],
    ['retomar', (workspaceId: string, campaignId: string) =>
      resumeCampaign({ workspaceId, campaignId })],
    ['cancelar', (workspaceId: string, campaignId: string) =>
      cancelCampaign({ workspaceId, campaignId })],
  ] as const)('%s campanha alheia é recusado', async (_label, action) => {
    const alvo = await tenantReady(`rt-act-${_label}`);
    const atacante = await seedTenant(`rt-atk-${_label}`);

    await expect(
      action(atacante.workspaceId, alvo.campaign.id, atacante.userId),
    ).rejects.toMatchObject({ code: expect.stringMatching(/NOT_FOUND|CONFLICT/) });

    // O estado da vítima não muda.
    const campaign = await testPrisma().campaign.findUniqueOrThrow({
      where: { id: alvo.campaign.id },
    });
    expect(campaign.status).toBe(CampaignStatus.DRAFT);
  });

  it('template de outro workspace é recusado na criação', async () => {
    const alpha = await tenantReady('rt-tpl-a');
    const beta = await seedTenant('rt-tpl-b');

    await expect(
      createCampaign({
        workspaceId: beta.workspaceId,
        actorUserId: beta.userId,
        name: 'Roubando template',
        description: null,
        templateId: alpha.template.id,
        audienceFilters: {},
        variableMap: {},
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lista de outro workspace na audiência não traz ninguém', async () => {
    const alpha = await tenantReady('rt-lst-a', 5);
    const beta = await tenantReady('rt-lst-b', 0);
    const listaAlpha = await testPrisma().contactList.create({
      data: { workspaceId: alpha.tenant.workspaceId, name: 'Alpha' },
    });

    await testPrisma().campaign.update({
      where: { id: beta.campaign.id },
      data: { audienceFilters: { listIds: [listaAlpha.id] } as never },
    });

    const report = await prepareCampaign({
      workspaceId: beta.tenant.workspaceId,
      campaignId: beta.campaign.id,
      actorUserId: beta.tenant.userId,
    });

    expect(report.breakdown.total).toBe(0);
    await expect(
      testPrisma().campaignRecipient.count({ where: { campaignId: beta.campaign.id } }),
    ).resolves.toBe(0);
  });

  it('destinatários de uma campanha nunca aparecem em outra', async () => {
    const alpha = await tenantReady('rt-rcp-a', 4);
    const beta = await tenantReady('rt-rcp-b', 2);

    for (const context of [alpha, beta]) {
      await prepareCampaign({
        workspaceId: context.tenant.workspaceId,
        campaignId: context.campaign.id,
        actorUserId: context.tenant.userId,
      });
    }

    const recipientsBeta = await testPrisma().campaignRecipient.findMany({
      where: { campaignId: beta.campaign.id },
      select: { workspaceId: true },
    });
    expect(recipientsBeta).toHaveLength(2);
    expect(
      recipientsBeta.every((row) => row.workspaceId === beta.tenant.workspaceId),
    ).toBe(true);
  });

  it('métricas de um workspace não contam destinatários do outro', async () => {
    const alpha = await tenantReady('rt-met-a', 5);
    const beta = await tenantReady('rt-met-b', 1);
    for (const context of [alpha, beta]) {
      await prepareCampaign({
        workspaceId: context.tenant.workspaceId,
        campaignId: context.campaign.id,
        actorUserId: context.tenant.userId,
      });
    }

    const metrics = await reconcileCampaignMetrics(
      beta.tenant.workspaceId,
      beta.campaign.id,
    );
    expect(metrics.total).toBe(1);
  });
});

describe('red team — transições inválidas', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('iniciar sem preparar é recusado', async () => {
    const context = await tenantReady('rt-start-raw');
    await expect(
      startCampaign({
        workspaceId: context.tenant.workspaceId,
        campaignId: context.campaign.id,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('campanha sem nenhum elegível não inicia', async () => {
    const tenant = await seedTenant('rt-sem-eleg');
    const channel = await seedChannel(tenant.workspaceId);
    const template = await seedTemplate(tenant.workspaceId, channel.id);
    // Contato sem consentimento: entra na audiência mas não é elegível.
    await seedContact(tenant.workspaceId, '+5585966660001');

    const campaign = await seedCampaign(tenant.workspaceId, {
      channelId: channel.id,
      templateId: template.id,
      audienceFilters: { consent: ConsentStatus.UNKNOWN },
    });
    await prepareCampaign({
      workspaceId: tenant.workspaceId,
      campaignId: campaign.id,
      actorUserId: tenant.userId,
    });

    await expect(
      startCampaign({ workspaceId: tenant.workspaceId, campaignId: campaign.id }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('retomar campanha concluída é recusado', async () => {
    const context = await tenantReady('rt-resume-done');
    await testPrisma().campaign.update({
      where: { id: context.campaign.id },
      data: { status: CampaignStatus.COMPLETED, completedAt: new Date() },
    });

    await expect(
      resumeCampaign({
        workspaceId: context.tenant.workspaceId,
        campaignId: context.campaign.id,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('editar campanha em execução é recusado', async () => {
    const context = await tenantReady('rt-edit-running');
    await prepareCampaign({
      workspaceId: context.tenant.workspaceId,
      campaignId: context.campaign.id,
      actorUserId: context.tenant.userId,
    });
    await startCampaign({
      workspaceId: context.tenant.workspaceId,
      campaignId: context.campaign.id,
    });

    await expect(
      updateCampaign(context.tenant.workspaceId, context.campaign.id, {
        name: 'Mudando no meio',
        description: null,
        audienceFilters: {},
        variableMap: {},
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('preparar campanha cancelada é recusado', async () => {
    const context = await tenantReady('rt-prep-cancel');
    await cancelCampaign({
      workspaceId: context.tenant.workspaceId,
      campaignId: context.campaign.id,
    });

    await expect(
      prepareCampaign({
        workspaceId: context.tenant.workspaceId,
        campaignId: context.campaign.id,
        actorUserId: context.tenant.userId,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('red team — agendamento', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function prepared(label: string) {
    const context = await tenantReady(label);
    await prepareCampaign({
      workspaceId: context.tenant.workspaceId,
      campaignId: context.campaign.id,
      actorUserId: context.tenant.userId,
    });
    return context;
  }

  it.each([
    ['no passado', -60_000],
    ['agora', 0],
  ])('recusa agendamento %s', async (_label, offset) => {
    const context = await prepared(`rt-sched-${_label.slice(0, 4)}`);

    await expect(
      scheduleCampaign({
        workspaceId: context.tenant.workspaceId,
        campaignId: context.campaign.id,
        scheduledAt: new Date(Date.now() + offset),
        timezone: 'America/Fortaleza',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('grava o instante em UTC e preserva a zona escolhida', async () => {
    const context = await prepared('rt-sched-tz');
    // 09:00 em Fortaleza (UTC-3) é 12:00 UTC.
    const alvo = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await scheduleCampaign({
      workspaceId: context.tenant.workspaceId,
      campaignId: context.campaign.id,
      scheduledAt: alvo,
      timezone: 'America/Fortaleza',
    });

    const campaign = await testPrisma().campaign.findUniqueOrThrow({
      where: { id: context.campaign.id },
    });
    expect(campaign.scheduledAt?.toISOString()).toBe(alvo.toISOString());
    expect(campaign.timezone).toBe('America/Fortaleza');
    expect(campaign.status).toBe(CampaignStatus.SCHEDULED);
  });
});

describe('red team — filtros malformados', () => {
  it.each([
    ['listIds não array', { listIds: 'nao-array' }],
    ['id inválido', { listIds: ['../../etc/passwd'] }],
    ['lista gigante', { tagIds: Array.from({ length: 500 }, () => 'x'.repeat(25)) }],
    ['cidade absurdamente longa', { cities: ['a'.repeat(5000)] }],
    ['status inexistente', { contactStatus: 'SUPER_ATIVO' }],
    ['consentimento inventado', { consent: 'TALVEZ' }],
  ])('rejeita %s antes de virar consulta', (_label, filters) => {
    expect(audienceFiltersSchema.safeParse(filters).success).toBe(false);
  });

  it('aceita filtros vazios', () => {
    expect(audienceFiltersSchema.safeParse({}).success).toBe(true);
  });
});

describe('red team — conteúdo hostil', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('XSS no nome da campanha é guardado como texto', async () => {
    const tenant = await seedTenant('rt-xss-nome');
    const hostil = '<script>alert(document.cookie)</script>';

    const campaign = await createCampaign({
      workspaceId: tenant.workspaceId,
      actorUserId: tenant.userId,
      name: hostil,
      description: '<img src=x onerror=alert(1)>',
      audienceFilters: {},
      variableMap: {},
    });

    // Guardado literalmente; a defesa é a renderização como texto pelo React.
    expect(campaign.name).toBe(hostil);
    expect(campaign.description).toBe('<img src=x onerror=alert(1)>');
  });

  it('XSS no fallback de variável vira texto na prévia, não markup', async () => {
    const tenant = await seedTenant('rt-xss-fb');
    const channel = await seedChannel(tenant.workspaceId);
    const template = await seedTemplate(tenant.workspaceId, channel.id);
    await seedEligibleContact(tenant.workspaceId, '+5585955550001', { firstName: null } as never);

    const campaign = await seedCampaign(tenant.workspaceId, {
      channelId: channel.id,
      templateId: template.id,
    });
    await testPrisma().campaign.update({
      where: { id: campaign.id },
      data: {
        variablePolicy: 'FALLBACK_VALUE',
        variableFallbacks: { 'body:1': '<script>alert(1)</script>' } as never,
      },
    });

    await prepareCampaign({
      workspaceId: tenant.workspaceId,
      campaignId: campaign.id,
      actorUserId: tenant.userId,
    });

    const recipient = await testPrisma().campaignRecipient.findFirstOrThrow({
      where: { campaignId: campaign.id },
    });
    expect(recipient.renderedPreview).toContain('<script>alert(1)</script>');
    expect(recipient.status).toBe(RecipientStatus.ELIGIBLE);
  });
});

describe('red team — enfileiramento exige campanha em execução', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('campanha em rascunho não pode ser enfileirada', async () => {
    const context = await tenantReady('rt-enq-draft');

    await expect(
      queueExecutionService.enqueueCampaign(context.tenant.workspaceId, context.campaign.id),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('campanha de outro workspace não pode ser enfileirada', async () => {
    const alvo = await tenantReady('rt-enq-a');
    const atacante = await seedTenant('rt-enq-b');

    await expect(
      queueExecutionService.enqueueCampaign(atacante.workspaceId, alvo.campaign.id),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('red team — taxas', () => {
  it('divisão por zero devolve zero, nunca NaN', () => {
    const rates = computeRates({
      total: 0, eligible: 0, suppressed: 0, invalid: 0, ineligible: 0,
      queued: 0, sending: 0, sent: 0, delivered: 0, read: 0, replied: 0,
      failed: 0, cancelled: 0, pending: 0,
    });

    for (const [name, value] of Object.entries(rates)) {
      expect(Number.isFinite(value), `${name} não é finito`).toBe(true);
      expect(value).toBe(0);
    }
  });

  it('nenhuma taxa passa de 100%', () => {
    const rates = computeRates({
      total: 10, eligible: 0, suppressed: 0, invalid: 0, ineligible: 0,
      queued: 0, sending: 0, sent: 0, delivered: 5, read: 3, replied: 2,
      failed: 0, cancelled: 0, pending: 0,
    });

    for (const value of Object.values(rates)) {
      expect(value).toBeLessThanOrEqual(1);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('red team — mudança de contato após preparação', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('revogar consentimento depois NÃO altera o destinatário já materializado', async () => {
    const context = await tenantReady('rt-recheck', 1);
    await prepareCampaign({
      workspaceId: context.tenant.workspaceId,
      campaignId: context.campaign.id,
      actorUserId: context.tenant.userId,
    });

    const recipient = await testPrisma().campaignRecipient.findFirstOrThrow({
      where: { campaignId: context.campaign.id },
    });
    expect(recipient.status).toBe(RecipientStatus.ELIGIBLE);

    // O contato revoga DEPOIS da preparação.
    await testPrisma().contactConsent.updateMany({
      where: { contactId: recipient.contactId },
      data: { status: ConsentStatus.REVOKED },
    });

    const depois = await testPrisma().campaignRecipient.findUniqueOrThrow({
      where: { id: recipient.id },
    });
    // A audiência é um retrato do momento da preparação — por isso a
    // reverificação IMEDIATAMENTE ANTES DO ENVIO é obrigatória na Sprint 5.
    expect(depois.status).toBe(RecipientStatus.ELIGIBLE);

    // Repreparar reflete a revogação.
    await testPrisma().campaign.update({
      where: { id: context.campaign.id },
      data: { status: CampaignStatus.READY },
    });
    await testPrisma().campaignRecipient.deleteMany({
      where: { campaignId: context.campaign.id },
    });
    const report = await prepareCampaign({
      workspaceId: context.tenant.workspaceId,
      campaignId: context.campaign.id,
      actorUserId: context.tenant.userId,
    });
    expect(report.breakdown.eligible).toBe(0);
  });
});
