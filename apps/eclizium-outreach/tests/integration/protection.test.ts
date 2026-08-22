import { beforeEach, describe, expect, it } from 'vitest';
import {
  ChannelStatus,
  ConsentChannel,
  ConsentSource,
  ConsentStatus,
  MessageDirection,
  MessageStatus,
  NumberQuality,
  SuppressionReason,
} from '@prisma/client';
import { applyOptOut, handlePossibleOptOut } from '@/features/protection/opt-out-service';
import {
  DEFAULT_POLICY,
  getSendingPolicy,
  updateSendingPolicy,
} from '@/features/protection/policy-service';
import {
  campaignMessagesInWindow,
  evaluateGuardrails,
  quietHoursDecision,
} from '@/features/protection/guardrails';
import { numberHealth, syncNumberHealth, toNumberQuality } from '@/features/protection/health-service';
import { resetDatabase, testPrisma } from '../helpers/db';
import { seedChannel, seedContact, seedTenant } from '../helpers/factories';
import { fakeGraph, metaError } from '../helpers/fake-graph';

async function tenantWithChannel(label: string) {
  const tenant = await seedTenant(label);
  const channel = await seedChannel(tenant.workspaceId);
  return { tenant, channel };
}

describe('política de envio', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('workspace sem política configurada já nasce protegido', async () => {
    const tenant = await seedTenant('pol1', { sendingPolicy: false });
    const policy = await getSendingPolicy(tenant.workspaceId);

    expect(policy).toEqual(DEFAULT_POLICY);
    expect(policy.optOutEnabled).toBe(true);
    expect(policy.frequencyCapMessages).toBeGreaterThan(0);
  });

  it('grava e relê a política', async () => {
    const tenant = await seedTenant('pol2');
    await updateSendingPolicy(tenant.workspaceId, {
      frequencyCapMessages: 2,
      quietHoursStart: 22,
      timeZone: 'America/Manaus',
    });

    const policy = await getSendingPolicy(tenant.workspaceId);
    expect(policy).toMatchObject({
      frequencyCapMessages: 2,
      quietHoursStart: 22,
      timeZone: 'America/Manaus',
    });
  });

  it.each([
    ['fuso inválido', { timeZone: 'Marte/Olympus' }],
    ['teto zero', { frequencyCapMessages: 0 }],
    ['janela zero', { frequencyCapWindowDays: 0 }],
    ['hora fora do relógio', { quietHoursStart: 99 }],
    ['hora fracionária', { quietHoursEnd: 8.5 }],
  ])('recusa %s', async (_label, update) => {
    const tenant = await seedTenant(`pol-${Math.random().toString(36).slice(2, 8)}`, {
      sendingPolicy: false,
    });
    const result = await updateSendingPolicy(tenant.workspaceId, update);

    expect(result.ok).toBe(false);
    // Nada foi gravado: a política continua a padrão.
    await expect(getSendingPolicy(tenant.workspaceId)).resolves.toEqual(DEFAULT_POLICY);
  });

  it('descadastro ligado sem palavra-chave é recusado', async () => {
    const tenant = await seedTenant('pol3', { sendingPolicy: false });
    const result = await updateSendingPolicy(tenant.workspaceId, {
      optOutEnabled: true,
      optOutKeywords: ['   ', ''],
    });

    expect(result.ok).toBe(false);
  });

  it('a política de um workspace não vaza para o outro', async () => {
    const a = await seedTenant('pol4a');
    const b = await seedTenant('pol4b', { sendingPolicy: false });
    await updateSendingPolicy(a.workspaceId, { frequencyCapMessages: 1 });

    await expect(getSendingPolicy(b.workspaceId)).resolves.toEqual(DEFAULT_POLICY);
  });

  it('20 gravações simultâneas convergem para um estado válido', async () => {
    const tenant = await seedTenant('pol5');

    await Promise.all(
      Array.from({ length: 20 }, (_value, index) =>
        updateSendingPolicy(tenant.workspaceId, { frequencyCapMessages: (index % 5) + 1 }),
      ),
    );

    const policy = await getSendingPolicy(tenant.workspaceId);
    expect(policy.frequencyCapMessages).toBeGreaterThanOrEqual(1);
    expect(policy.frequencyCapMessages).toBeLessThanOrEqual(5);
    await expect(testPrisma().sendingPolicy.count()).resolves.toBe(1);
  });
});

describe('descadastro automático', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('suprime, revoga consentimento e registra', async () => {
    const { tenant } = await tenantWithChannel('opt1');
    const contactId = await seedContact(tenant.workspaceId, '+5585960000001');
    await testPrisma().contactConsent.create({
      data: {
        workspaceId: tenant.workspaceId,
        contactId,
        channel: ConsentChannel.WHATSAPP,
        status: ConsentStatus.GRANTED,
        source: ConsentSource.MANUAL,
      },
    });

    const result = await handlePossibleOptOut({
      workspaceId: tenant.workspaceId,
      contactId,
      phoneE164: '+5585960000001',
      body: 'PARAR',
    });

    expect(result.applied).toBe(true);

    const suppression = await testPrisma().suppressionEntry.findFirstOrThrow({});
    expect(suppression.reason).toBe(SuppressionReason.OPT_OUT);

    const consent = await testPrisma().contactConsent.findFirstOrThrow({});
    expect(consent.status).toBe(ConsentStatus.REVOKED);
    expect(consent.revokedAt).not.toBeNull();

    const audit = await testPrisma().auditLog.findFirst({
      where: { action: 'contact.suppressed' },
    });
    expect(audit?.actorType).toBe('SYSTEM');
    // A mensagem inteira nunca entra na auditoria.
    expect(JSON.stringify(audit?.metadata)).not.toContain('PARAR');
  });

  it('mensagem comum NÃO descadastra', async () => {
    const { tenant } = await tenantWithChannel('opt2');
    const contactId = await seedContact(tenant.workspaceId, '+5585960000002');

    const result = await handlePossibleOptOut({
      workspaceId: tenant.workspaceId,
      contactId,
      phoneE164: '+5585960000002',
      body: 'não quero parar de receber, adorei a promoção',
    });

    expect(result.applied).toBe(false);
    await expect(testPrisma().suppressionEntry.count()).resolves.toBe(0);
  });

  it('política desligada não descadastra ninguém', async () => {
    const { tenant } = await tenantWithChannel('opt3');
    const contactId = await seedContact(tenant.workspaceId, '+5585960000003');
    await updateSendingPolicy(tenant.workspaceId, { optOutEnabled: false });

    const result = await handlePossibleOptOut({
      workspaceId: tenant.workspaceId,
      contactId,
      phoneE164: '+5585960000003',
      body: 'PARAR',
    });

    expect(result.applied).toBe(false);
  });

  it('descadastrar duas vezes é inofensivo', async () => {
    const { tenant } = await tenantWithChannel('opt4');
    const contactId = await seedContact(tenant.workspaceId, '+5585960000004');

    const first = await applyOptOut({
      workspaceId: tenant.workspaceId,
      contactId,
      phoneE164: '+5585960000004',
      trigger: 'PARAR',
    });
    const second = await applyOptOut({
      workspaceId: tenant.workspaceId,
      contactId,
      phoneE164: '+5585960000004',
      trigger: 'PARAR',
    });

    expect(first.applied).toBe(true);
    expect(second).toMatchObject({ applied: false, alreadySuppressed: true });
    await expect(testPrisma().suppressionEntry.count()).resolves.toBe(1);
  });

  it('6 pedidos simultâneos criam uma supressão só', async () => {
    const { tenant } = await tenantWithChannel('opt5');
    const contactId = await seedContact(tenant.workspaceId, '+5585960000005');

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        applyOptOut({
          workspaceId: tenant.workspaceId,
          contactId,
          phoneE164: '+5585960000005',
          trigger: 'PARAR',
        }),
      ),
    );

    expect(results.filter((result) => result.applied)).toHaveLength(1);
    await expect(testPrisma().suppressionEntry.count()).resolves.toBe(1);
  });

  it('palavras-chave personalizadas valem', async () => {
    const { tenant } = await tenantWithChannel('opt6');
    const contactId = await seedContact(tenant.workspaceId, '+5585960000006');
    await updateSendingPolicy(tenant.workspaceId, { optOutKeywords: ['CHEGA'] });

    await expect(
      handlePossibleOptOut({
        workspaceId: tenant.workspaceId,
        contactId,
        phoneE164: '+5585960000006',
        body: 'chega!',
      }),
    ).resolves.toMatchObject({ applied: true });
  });
});

describe('horário silencioso', () => {
  const policy = { ...DEFAULT_POLICY, quietHoursStart: 21, quietHoursEnd: 8, timeZone: 'America/Sao_Paulo' };

  it('silencia de madrugada no fuso configurado', () => {
    // 06:00 UTC = 03:00 em São Paulo.
    const decision = quietHoursDecision(policy, new Date('2026-08-22T06:00:00Z'));
    expect(decision.silent).toBe(true);
    expect(decision.resumeAtMs).toBeGreaterThan(0);
  });

  it('não silencia no meio da tarde', () => {
    // 18:00 UTC = 15:00 em São Paulo.
    expect(quietHoursDecision(policy, new Date('2026-08-22T18:00:00Z')).silent).toBe(false);
  });

  it('a janela que atravessa a meia-noite funciona nos dois lados', () => {
    // 23:00 local (02:00 UTC do dia seguinte) e 07:00 local.
    expect(quietHoursDecision(policy, new Date('2026-08-23T02:00:00Z')).silent).toBe(true);
    expect(quietHoursDecision(policy, new Date('2026-08-22T10:00:00Z')).silent).toBe(true);
  });

  it('desligado nunca silencia', () => {
    const off = { ...policy, quietHoursEnabled: false };
    expect(quietHoursDecision(off, new Date('2026-08-22T06:00:00Z')).silent).toBe(false);
  });

  it('início igual ao fim é tratado como desligado, não como silêncio eterno', () => {
    const degenerate = { ...policy, quietHoursStart: 9, quietHoursEnd: 9 };
    expect(quietHoursDecision(degenerate, new Date('2026-08-22T12:00:00Z')).silent).toBe(false);
  });

  it('o tempo de retomada nunca é zero nem negativo', () => {
    // 07:59 local — ainda dentro do silêncio, um minuto antes de abrir às 8h.
    const decision = quietHoursDecision(policy, new Date('2026-08-22T10:59:00Z'));
    expect(decision.silent).toBe(true);
    expect(decision.resumeAtMs).toBeGreaterThanOrEqual(60_000);

    // 08:00 local já é fora do silêncio: a janela fecha no fim, não depois.
    expect(quietHoursDecision(policy, new Date('2026-08-22T11:00:00Z')).silent).toBe(false);
  });

  it('janela diurna também funciona', () => {
    const daytime = { ...policy, quietHoursStart: 12, quietHoursEnd: 14 };
    // 16:00 UTC = 13:00 em São Paulo.
    expect(quietHoursDecision(daytime, new Date('2026-08-22T16:00:00Z')).silent).toBe(true);
    expect(quietHoursDecision(daytime, new Date('2026-08-22T20:00:00Z')).silent).toBe(false);
  });
});

describe('freios de envio', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function campaignMessage(input: {
    workspaceId: string;
    channelId: string;
    contactId: string;
    campaignId: string;
    createdAt?: Date;
  }) {
    return testPrisma().message.create({
      data: {
        workspaceId: input.workspaceId,
        channelId: input.channelId,
        contactId: input.contactId,
        campaignId: input.campaignId,
        direction: MessageDirection.OUTBOUND,
        status: MessageStatus.SENT,
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      },
    });
  }

  it('conta só mensagem de campanha na janela', async () => {
    const { tenant, channel } = await tenantWithChannel('fr1');
    const contactId = await seedContact(tenant.workspaceId, '+5585970000001');
    const campaign = await testPrisma().campaign.create({
      data: { workspaceId: tenant.workspaceId, name: 'c', channelId: channel.id },
    });

    await campaignMessage({
      workspaceId: tenant.workspaceId,
      channelId: channel.id,
      contactId,
      campaignId: campaign.id,
    });
    // Resposta manual da Inbox: não entra na conta.
    await testPrisma().message.create({
      data: {
        workspaceId: tenant.workspaceId,
        channelId: channel.id,
        contactId,
        direction: MessageDirection.OUTBOUND,
        status: MessageStatus.SENT,
      },
    });

    const count = await campaignMessagesInWindow({
      workspaceId: tenant.workspaceId,
      contactId,
      windowDays: 7,
      now: new Date(),
    });
    expect(count).toBe(1);
  });

  it('mensagem fora da janela não conta', async () => {
    const { tenant, channel } = await tenantWithChannel('fr2');
    const contactId = await seedContact(tenant.workspaceId, '+5585970000002');
    const campaign = await testPrisma().campaign.create({
      data: { workspaceId: tenant.workspaceId, name: 'c', channelId: channel.id },
    });

    await campaignMessage({
      workspaceId: tenant.workspaceId,
      channelId: channel.id,
      contactId,
      campaignId: campaign.id,
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });

    const count = await campaignMessagesInWindow({
      workspaceId: tenant.workspaceId,
      contactId,
      windowDays: 7,
      now: new Date(),
    });
    expect(count).toBe(0);
  });

  it('teto de frequência BLOQUEIA, não adia', async () => {
    const { tenant, channel } = await tenantWithChannel('fr3');
    const contactId = await seedContact(tenant.workspaceId, '+5585970000003');
    const campaign = await testPrisma().campaign.create({
      data: { workspaceId: tenant.workspaceId, name: 'c', channelId: channel.id },
    });

    for (let index = 0; index < 4; index += 1) {
      await campaignMessage({
        workspaceId: tenant.workspaceId,
        channelId: channel.id,
        contactId,
        campaignId: campaign.id,
      });
    }

    const decision = await evaluateGuardrails({
      workspaceId: tenant.workspaceId,
      contactId,
      policy: { ...DEFAULT_POLICY, quietHoursEnabled: false },
      quality: NumberQuality.GREEN,
    });

    expect(decision.allow).toBe(false);
    if (decision.allow) return;
    expect(decision.kind).toBe('BLOCK');
    expect(decision.reason).toContain('frequência');
  });

  it('qualidade vermelha bloqueia antes de qualquer outra checagem', async () => {
    const { tenant } = await tenantWithChannel('fr4');
    const contactId = await seedContact(tenant.workspaceId, '+5585970000004');

    const decision = await evaluateGuardrails({
      workspaceId: tenant.workspaceId,
      contactId,
      policy: DEFAULT_POLICY,
      quality: NumberQuality.RED,
    });

    expect(decision.allow).toBe(false);
    if (decision.allow) return;
    expect(decision.kind).toBe('BLOCK');
    expect(decision.reason).toContain('VERMELHA');
  });

  it('amarela só bloqueia quando a política manda', async () => {
    const { tenant } = await tenantWithChannel('fr5');
    const contactId = await seedContact(tenant.workspaceId, '+5585970000005');
    const base = { ...DEFAULT_POLICY, quietHoursEnabled: false };

    await expect(
      evaluateGuardrails({
        workspaceId: tenant.workspaceId,
        contactId,
        policy: base,
        quality: NumberQuality.YELLOW,
      }),
    ).resolves.toMatchObject({ allow: true });

    const strict = await evaluateGuardrails({
      workspaceId: tenant.workspaceId,
      contactId,
      policy: { ...base, pauseOnYellowQuality: true },
      quality: NumberQuality.YELLOW,
    });
    expect(strict.allow).toBe(false);
  });

  it('horário silencioso ADIA, não bloqueia', async () => {
    const { tenant } = await tenantWithChannel('fr6');
    const contactId = await seedContact(tenant.workspaceId, '+5585970000006');

    const decision = await evaluateGuardrails({
      workspaceId: tenant.workspaceId,
      contactId,
      policy: DEFAULT_POLICY,
      quality: NumberQuality.GREEN,
      now: new Date('2026-08-22T06:00:00Z'),
    });

    expect(decision.allow).toBe(false);
    if (decision.allow || decision.kind !== 'DEFER') throw new Error('esperava adiamento');
    expect(decision.retryAtMs).toBeGreaterThan(0);
  });

  it('tudo em ordem libera o envio', async () => {
    const { tenant } = await tenantWithChannel('fr7');
    const contactId = await seedContact(tenant.workspaceId, '+5585970000007');

    await expect(
      evaluateGuardrails({
        workspaceId: tenant.workspaceId,
        contactId,
        policy: { ...DEFAULT_POLICY, quietHoursEnabled: false },
        quality: NumberQuality.GREEN,
      }),
    ).resolves.toMatchObject({ allow: true });
  });
});

describe('saúde do número', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it.each([
    ['GREEN', NumberQuality.GREEN],
    ['green', NumberQuality.GREEN],
    ['YELLOW', NumberQuality.YELLOW],
    ['RED', NumberQuality.RED],
    ['UNKNOWN', NumberQuality.UNKNOWN],
    ['coisa nova da Meta', NumberQuality.UNKNOWN],
    [null, NumberQuality.UNKNOWN],
  ])('mapeia %s sem presumir saúde', (input, expected) => {
    expect(toNumberQuality(input as string | null)).toBe(expected);
  });

  it('lê a qualidade da Meta e grava', async () => {
    const { tenant } = await tenantWithChannel('sd1');
    const graph = fakeGraph([{ json: { quality_rating: 'YELLOW', messaging_limit_tier: 'TIER_1K' } }]);

    const outcome = await syncNumberHealth({
      workspaceId: tenant.workspaceId,
      providerOverrides: { fetchImpl: graph.fetchImpl },
    });

    expect(outcome).toMatchObject({ ok: true, quality: NumberQuality.YELLOW, tier: 'TIER_1K' });
    const channel = await testPrisma().messagingChannel.findFirstOrThrow({});
    expect(channel.qualityRating).toBe(NumberQuality.YELLOW);
    expect(channel.qualityCheckedAt).not.toBeNull();
  });

  it('mudança de qualidade vira registro de auditoria', async () => {
    const { tenant } = await tenantWithChannel('sd2');
    const graph = fakeGraph([{ json: { quality_rating: 'RED' } }]);

    await syncNumberHealth({
      workspaceId: tenant.workspaceId,
      providerOverrides: { fetchImpl: graph.fetchImpl },
    });

    const audit = await testPrisma().auditLog.findFirst({
      where: { action: 'channel.quality_changed' },
    });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit?.metadata)).toContain('RED');
  });

  it('consultar duas vezes sem mudança não polui a auditoria', async () => {
    const { tenant } = await tenantWithChannel('sd3');
    const graph = fakeGraph([{ json: { quality_rating: 'GREEN' } }]);

    await syncNumberHealth({
      workspaceId: tenant.workspaceId,
      providerOverrides: { fetchImpl: graph.fetchImpl },
    });
    await syncNumberHealth({
      workspaceId: tenant.workspaceId,
      providerOverrides: { fetchImpl: graph.fetchImpl },
    });

    await expect(
      testPrisma().auditLog.count({ where: { action: 'channel.quality_changed' } }),
    ).resolves.toBe(1);
  });

  it('erro da Meta não inventa qualidade', async () => {
    const { tenant, channel } = await tenantWithChannel('sd4');
    const graph = fakeGraph([{ status: 401, json: metaError('Invalid token', 190) }]);

    const outcome = await syncNumberHealth({
      workspaceId: tenant.workspaceId,
      providerOverrides: { fetchImpl: graph.fetchImpl },
    });

    expect(outcome.ok).toBe(false);
    const after = await testPrisma().messagingChannel.findUniqueOrThrow({
      where: { id: channel.id },
    });
    expect(after.qualityRating).toBe(NumberQuality.UNKNOWN);
    expect(after.qualityCheckedAt).toBeNull();
  });

  it('canal de outro workspace não é consultado nem alterado', async () => {
    await tenantWithChannel('sd5a');
    const outsider = await seedTenant('sd5b');
    const graph = fakeGraph([{ json: { quality_rating: 'RED' } }]);

    const outcome = await syncNumberHealth({
      workspaceId: outsider.workspaceId,
      providerOverrides: { fetchImpl: graph.fetchImpl },
    });

    expect(outcome.ok).toBe(false);
    expect(graph.calls).toHaveLength(0);
  });

  it('nunca consultada aparece como leitura velha, não como verde', async () => {
    const { tenant, channel } = await tenantWithChannel('sd6');
    await testPrisma().messagingChannel.update({
      where: { id: channel.id },
      data: { status: ChannelStatus.CONNECTED },
    });

    const health = await numberHealth(tenant.workspaceId, DEFAULT_POLICY);
    expect(health).toMatchObject({
      quality: NumberQuality.UNKNOWN,
      checkedAt: null,
      stale: true,
      blocksSending: false,
    });
  });

  it('qualidade vermelha com política padrão bloqueia o envio', async () => {
    const { tenant, channel } = await tenantWithChannel('sd7');
    await testPrisma().messagingChannel.update({
      where: { id: channel.id },
      data: { qualityRating: NumberQuality.RED, qualityCheckedAt: new Date() },
    });

    const health = await numberHealth(tenant.workspaceId, DEFAULT_POLICY);
    expect(health?.blocksSending).toBe(true);
  });
});
