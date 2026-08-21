import { beforeEach, describe, expect, it } from 'vitest';
import {
  ConsentChannel,
  ConsentSource,
  ConsentStatus,
  MessageDirection,
  MessageStatus,
} from '@prisma/client';
import { buildRange } from '@/features/analytics/range';
import {
  audienceGrowth,
  campaignPerformance,
  failureBreakdown,
  inboxResponsiveness,
  messagingSeries,
  messagingTotals,
  percentile,
} from '@/features/analytics/service';
import { resetDatabase, testPrisma } from '../helpers/db';
import { seedCampaign, seedChannel, seedContact, seedTenant } from '../helpers/factories';

const NOW = new Date('2026-08-21T15:00:00Z');
const range = () => buildRange({ days: 7, timeZone: 'UTC', now: NOW });

async function tenantWithChannel(label: string) {
  const tenant = await seedTenant(label);
  const channel = await seedChannel(tenant.workspaceId);
  return { tenant, channel };
}

async function message(input: {
  workspaceId: string;
  channelId: string;
  contactId: string;
  direction?: MessageDirection;
  status?: MessageStatus;
  createdAt: Date;
  conversationId?: string;
  errorCode?: string;
  errorTitle?: string;
  campaignId?: string;
}) {
  return testPrisma().message.create({
    data: {
      workspaceId: input.workspaceId,
      channelId: input.channelId,
      contactId: input.contactId,
      direction: input.direction ?? MessageDirection.OUTBOUND,
      status: input.status ?? MessageStatus.SENT,
      createdAt: input.createdAt,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      ...(input.errorTitle ? { errorTitle: input.errorTitle } : {}),
      ...(input.campaignId ? { campaignId: input.campaignId } : {}),
    },
  });
}

describe('série de mensagens', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('devolve um ponto por dia do período, inclusive os vazios', async () => {
    const { tenant } = await tenantWithChannel('an1');
    const series = await messagingSeries(tenant.workspaceId, range());

    expect(series).toHaveLength(7);
    expect(series.every((point) => point.sent === 0)).toBe(true);
    expect(series.at(-1)?.day).toBe('2026-08-21');
  });

  it('os estados avançam: uma mensagem lida conta como entregue e enviada', async () => {
    const { tenant, channel } = await tenantWithChannel('an2');
    const contactId = await seedContact(tenant.workspaceId, '+5585900001111');

    await message({
      workspaceId: tenant.workspaceId,
      channelId: channel.id,
      contactId,
      status: MessageStatus.READ,
      createdAt: new Date('2026-08-20T10:00:00Z'),
    });

    const totals = await messagingTotals(tenant.workspaceId, range());
    expect(totals).toMatchObject({ sent: 1, delivered: 1, read: 1, failed: 0 });
  });

  it('falha não conta como enviada', async () => {
    const { tenant, channel } = await tenantWithChannel('an3');
    const contactId = await seedContact(tenant.workspaceId, '+5585900002222');

    await message({
      workspaceId: tenant.workspaceId,
      channelId: channel.id,
      contactId,
      status: MessageStatus.FAILED,
      createdAt: new Date('2026-08-20T10:00:00Z'),
    });

    const totals = await messagingTotals(tenant.workspaceId, range());
    expect(totals.sent).toBe(0);
    expect(totals.failed).toBe(1);
    expect(totals.failureRate).toBe(100);
  });

  it('mensagem fora do período NÃO entra', async () => {
    const { tenant, channel } = await tenantWithChannel('an4');
    const contactId = await seedContact(tenant.workspaceId, '+5585900003333');

    await message({
      workspaceId: tenant.workspaceId,
      channelId: channel.id,
      contactId,
      createdAt: new Date('2026-07-01T10:00:00Z'),
    });

    const totals = await messagingTotals(tenant.workspaceId, range());
    expect(totals.sent).toBe(0);
  });

  it('mensagem de OUTRO workspace nunca aparece', async () => {
    const a = await tenantWithChannel('an5a');
    const b = await tenantWithChannel('an5b');
    const contactId = await seedContact(a.tenant.workspaceId, '+5585900004444');

    await message({
      workspaceId: a.tenant.workspaceId,
      channelId: a.channel.id,
      contactId,
      createdAt: new Date('2026-08-20T10:00:00Z'),
    });

    const totals = await messagingTotals(b.tenant.workspaceId, range());
    expect(totals.sent).toBe(0);
  });

  it('sem evento de webhook, o dado de status é declarado indisponível', async () => {
    const { tenant, channel } = await tenantWithChannel('an6');
    const contactId = await seedContact(tenant.workspaceId, '+5585900005555');
    await message({
      workspaceId: tenant.workspaceId,
      channelId: channel.id,
      contactId,
      createdAt: new Date('2026-08-20T10:00:00Z'),
    });

    const totals = await messagingTotals(tenant.workspaceId, range());
    // Enviou, mas ninguém confirmou entrega: 0% aqui é ausência de dado, e a
    // flag existe para a tela não apresentar isso como desempenho.
    expect(totals.sent).toBe(1);
    expect(totals.deliveryRate).toBe(0);
    expect(totals.statusDataAvailable).toBe(false);
  });

  it('o agrupamento por dia respeita o fuso escolhido', async () => {
    const { tenant, channel } = await tenantWithChannel('an7');
    const contactId = await seedContact(tenant.workspaceId, '+5585900006666');

    // 01:00 UTC de 21/08 é 22:00 de 20/08 em São Paulo.
    await message({
      workspaceId: tenant.workspaceId,
      channelId: channel.id,
      contactId,
      createdAt: new Date('2026-08-21T01:00:00Z'),
    });

    const utc = await messagingSeries(
      tenant.workspaceId,
      buildRange({ days: 7, timeZone: 'UTC', now: NOW }),
    );
    const brasil = await messagingSeries(
      tenant.workspaceId,
      buildRange({ days: 7, timeZone: 'America/Sao_Paulo', now: NOW }),
    );

    expect(utc.find((point) => point.day === '2026-08-21')?.sent).toBe(1);
    expect(brasil.find((point) => point.day === '2026-08-20')?.sent).toBe(1);
  });
});

describe('desempenho por campanha', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('agrega destinatários por estado, numa consulta só', async () => {
    const { tenant, channel } = await tenantWithChannel('cp1');
    const campaign = await seedCampaign(tenant.workspaceId, { channelId: channel.id });
    await testPrisma().campaign.update({
      where: { id: campaign.id },
      data: { startedAt: new Date('2026-08-20T10:00:00Z') },
    });

    const contacts = await Promise.all([
      seedContact(tenant.workspaceId, '+5585910000001'),
      seedContact(tenant.workspaceId, '+5585910000002'),
      seedContact(tenant.workspaceId, '+5585910000003'),
    ]);

    const statuses = ['SENT', 'READ', 'FAILED'] as const;
    for (const [index, contactId] of contacts.entries()) {
      await testPrisma().campaignRecipient.create({
        data: {
          workspaceId: tenant.workspaceId,
          campaignId: campaign.id,
          contactId,
          status: statuses[index] ?? 'SENT',
          idempotencyKey: `cp1-${index}`,
        },
      });
    }

    const [row] = await campaignPerformance(
      tenant.workspaceId,
      buildRange({ days: 7, timeZone: 'UTC' }),
    );
    expect(row).toMatchObject({ total: 3, sent: 2, delivered: 1, read: 1, failed: 1 });
    expect(row?.deliveryRate).toBe(50);
  });

  it('campanha de outro workspace não aparece', async () => {
    const a = await tenantWithChannel('cp2a');
    const b = await tenantWithChannel('cp2b');
    await seedCampaign(a.tenant.workspaceId, { channelId: a.channel.id });

    await expect(
      campaignPerformance(b.tenant.workspaceId, buildRange({ days: 7, timeZone: 'UTC' })),
    ).resolves.toHaveLength(0);
  });

  it('campanha sem destinatário aparece com zero, não some', async () => {
    const { tenant, channel } = await tenantWithChannel('cp3');
    await seedCampaign(tenant.workspaceId, { channelId: channel.id });

    const rows = await campaignPerformance(
      tenant.workspaceId,
      buildRange({ days: 7, timeZone: 'UTC' }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.total).toBe(0);
    expect(rows[0]?.deliveryRate).toBe(0);
  });
});

describe('crescimento da base', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('conta entradas, consentimentos e supressões por dia', async () => {
    const { tenant } = await tenantWithChannel('cr1');
    const contactId = await seedContact(tenant.workspaceId, '+5585920000001');
    await testPrisma().contact.update({
      where: { id: contactId },
      data: { createdAt: new Date('2026-08-19T10:00:00Z') },
    });

    await testPrisma().contactConsent.create({
      data: {
        workspaceId: tenant.workspaceId,
        contactId,
        channel: ConsentChannel.WHATSAPP,
        status: ConsentStatus.GRANTED,
        source: ConsentSource.MANUAL,
        updatedAt: new Date('2026-08-19T11:00:00Z'),
      },
    });
    await testPrisma().suppressionEntry.create({
      data: {
        workspaceId: tenant.workspaceId,
        contactId,
        phoneE164: '+5585920000001',
        reason: 'MANUAL',
        createdAt: new Date('2026-08-20T10:00:00Z'),
      },
    });

    const growth = await audienceGrowth(tenant.workspaceId, range());
    expect(growth.totals).toMatchObject({ created: 1, granted: 1, suppressed: 1 });
    expect(growth.days.find((day) => day.day === '2026-08-19')?.created).toBe(1);
    expect(growth.days.find((day) => day.day === '2026-08-20')?.suppressed).toBe(1);
  });

  it('a base de outro workspace não contamina', async () => {
    const a = await tenantWithChannel('cr2a');
    const b = await tenantWithChannel('cr2b');
    await seedContact(a.tenant.workspaceId, '+5585920000002');

    const growth = await audienceGrowth(b.tenant.workspaceId, range());
    expect(growth.totals.created).toBe(0);
  });
});

describe('motivos de falha', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('agrupa por código e ordena por volume', async () => {
    const { tenant, channel } = await tenantWithChannel('mf1');
    const contactId = await seedContact(tenant.workspaceId, '+5585930000001');

    for (let index = 0; index < 3; index += 1) {
      await message({
        workspaceId: tenant.workspaceId,
        channelId: channel.id,
        contactId,
        status: MessageStatus.FAILED,
        errorCode: '131047',
        errorTitle: 'Fora da janela',
        createdAt: new Date('2026-08-20T10:00:00Z'),
      });
    }
    await message({
      workspaceId: tenant.workspaceId,
      channelId: channel.id,
      contactId,
      status: MessageStatus.FAILED,
      errorCode: '100',
      errorTitle: 'Parâmetro inválido',
      createdAt: new Date('2026-08-20T11:00:00Z'),
    });

    const rows = await failureBreakdown(tenant.workspaceId, range());
    expect(rows[0]).toMatchObject({ code: '131047', total: 3 });
    expect(rows[1]).toMatchObject({ code: '100', total: 1 });
  });

  it('falha sem código não é escondida', async () => {
    const { tenant, channel } = await tenantWithChannel('mf2');
    const contactId = await seedContact(tenant.workspaceId, '+5585930000002');
    await message({
      workspaceId: tenant.workspaceId,
      channelId: channel.id,
      contactId,
      status: MessageStatus.FAILED,
      createdAt: new Date('2026-08-20T10:00:00Z'),
    });

    const rows = await failureBreakdown(tenant.workspaceId, range());
    expect(rows[0]).toMatchObject({ code: 'SEM_CODIGO', total: 1 });
  });
});

describe('responsividade do atendimento', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function conversation(workspaceId: string, channelId: string, phone: string) {
    const contactId = await seedContact(workspaceId, phone);
    const created = await testPrisma().conversation.create({
      data: { workspaceId, channelId, contactId, lastMessageAt: new Date('2026-08-20T10:30:00Z') },
    });
    return { contactId, conversationId: created.id };
  }

  it('mede o tempo até a primeira resposta', async () => {
    const { tenant, channel } = await tenantWithChannel('rp1');
    const { contactId, conversationId } = await conversation(
      tenant.workspaceId,
      channel.id,
      '+5585940000001',
    );

    await message({
      workspaceId: tenant.workspaceId,
      channelId: channel.id,
      contactId,
      conversationId,
      direction: MessageDirection.INBOUND,
      status: MessageStatus.RECEIVED,
      createdAt: new Date('2026-08-20T10:00:00Z'),
    });
    await message({
      workspaceId: tenant.workspaceId,
      channelId: channel.id,
      contactId,
      conversationId,
      createdAt: new Date('2026-08-20T10:30:00Z'),
    });

    const result = await inboxResponsiveness(tenant.workspaceId, range());
    expect(result.medianFirstReplyMinutes).toBe(30);
    expect(result.unanswered).toBe(0);
  });

  it('conversa sem resposta entra em "sem resposta", não some da conta', async () => {
    const { tenant, channel } = await tenantWithChannel('rp2');
    const { contactId, conversationId } = await conversation(
      tenant.workspaceId,
      channel.id,
      '+5585940000002',
    );

    await message({
      workspaceId: tenant.workspaceId,
      channelId: channel.id,
      contactId,
      conversationId,
      direction: MessageDirection.INBOUND,
      status: MessageStatus.RECEIVED,
      createdAt: new Date('2026-08-20T10:00:00Z'),
    });

    const result = await inboxResponsiveness(tenant.workspaceId, range());
    expect(result.unanswered).toBe(1);
    expect(result.medianFirstReplyMinutes).toBeNull();
  });

  it('resposta ANTERIOR à mensagem recebida não conta como resposta dela', async () => {
    const { tenant, channel } = await tenantWithChannel('rp3');
    const { contactId, conversationId } = await conversation(
      tenant.workspaceId,
      channel.id,
      '+5585940000003',
    );

    await message({
      workspaceId: tenant.workspaceId,
      channelId: channel.id,
      contactId,
      conversationId,
      createdAt: new Date('2026-08-20T09:00:00Z'),
    });
    await message({
      workspaceId: tenant.workspaceId,
      channelId: channel.id,
      contactId,
      conversationId,
      direction: MessageDirection.INBOUND,
      status: MessageStatus.RECEIVED,
      createdAt: new Date('2026-08-20T10:00:00Z'),
    });

    const result = await inboxResponsiveness(tenant.workspaceId, range());
    expect(result.unanswered).toBe(1);
  });

  it('mensagem de campanha não conta como resposta manual', async () => {
    const { tenant, channel } = await tenantWithChannel('rp4');
    const campaign = await seedCampaign(tenant.workspaceId, { channelId: channel.id });
    const contactId = await seedContact(tenant.workspaceId, '+5585940000004');

    await message({
      workspaceId: tenant.workspaceId,
      channelId: channel.id,
      contactId,
      campaignId: campaign.id,
      createdAt: new Date('2026-08-20T10:00:00Z'),
    });

    const result = await inboxResponsiveness(tenant.workspaceId, range());
    expect(result.replies).toBe(0);
  });
});

describe('percentil', () => {
  it('sem amostra devolve null em vez de zero', () => {
    expect(percentile([], 0.5)).toBeNull();
  });

  it('mediana e p90 sobre amostra conhecida', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(sorted, 0.5)).toBe(5);
    expect(percentile(sorted, 0.9)).toBe(9);
  });

  it('amostra de um elemento devolve o próprio valor', () => {
    expect(percentile([42], 0.5)).toBe(42);
    expect(percentile([42], 0.9)).toBe(42);
  });
});
