import { beforeEach, describe, expect, it } from 'vitest';
import {
  ConsentChannel,
  ConsentStatus,
  ContactStatus,
  MediaStatus,
  MessageDirection,
  MessageStatus,
  MessageType,
  WebhookEventStatus,
} from '@prisma/client';
import { handleEvent } from '@/features/webhooks/processor';
import { parseWebhookPayload } from '@/features/webhooks/parser';
import { resetDatabase, testPrisma } from '../helpers/db';
import { seedChannel, seedEligibleContact, seedTemplate, seedTenant } from '../helpers/factories';
import {
  FAILED_ERROR,
  mediaMessagePayload,
  multiEventPayload,
  PHONE_NUMBER_ID,
  statusPayload,
  textMessagePayload,
  unknownFieldPayload,
} from '../helpers/webhook-fixtures';

/** Entrega um payload inteiro como a rota faria, evento a evento. */
async function deliver(payload: unknown) {
  const parsed = parseWebhookPayload(JSON.stringify(payload));
  if (!parsed.ok) throw new Error(`payload inválido: ${parsed.reason}`);

  const outcomes = [];
  for (const event of parsed.events) {
    outcomes.push(await handleEvent(event, { signatureValid: true }));
  }
  return outcomes;
}

/** Workspace com canal cujo phoneNumberId casa com as fixtures. */
async function tenantWithChannel(label: string) {
  const tenant = await seedTenant(label);
  const channel = await seedChannel(tenant.workspaceId, { phoneNumberId: PHONE_NUMBER_ID });
  return { tenant, channel };
}

/** Mensagem enviada, pronta para receber webhooks de status. */
async function outboundMessage(
  workspaceId: string,
  channelId: string,
  wamid: string,
  status: MessageStatus = MessageStatus.SENT,
) {
  const template = await seedTemplate(workspaceId, channelId);
  const contactId = await seedEligibleContact(workspaceId, '+5585988887777');

  return testPrisma().message.create({
    data: {
      workspaceId,
      channelId,
      contactId,
      templateId: template.id,
      direction: MessageDirection.OUTBOUND,
      type: MessageType.TEMPLATE,
      status,
      providerMessageId: wamid,
      body: 'Olá {{1}}',
      renderedContent: 'Olá Ana',
    },
  });
}

describe('status de mensagem', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it.each([
    ['sent', MessageStatus.SENT, 'sentAt'],
    ['delivered', MessageStatus.DELIVERED, 'deliveredAt'],
    ['read', MessageStatus.READ, 'readAt'],
  ] as const)('aplica %s e carimba %s', async (providerStatus, expected, field) => {
    const { tenant, channel } = await tenantWithChannel(`st-${providerStatus}`);
    const message = await outboundMessage(
      tenant.workspaceId,
      channel.id,
      `wamid.${providerStatus}`,
      MessageStatus.SENDING,
    );

    await deliver(statusPayload({ wamid: `wamid.${providerStatus}`, status: providerStatus }));

    const updated = await testPrisma().message.findUniqueOrThrow({ where: { id: message.id } });
    expect(updated.status).toBe(expected);
    expect(updated[field]).not.toBeNull();
  });

  it('failed persiste código, título e detalhe sanitizados', async () => {
    const { tenant, channel } = await tenantWithChannel('st-failed');
    const message = await outboundMessage(tenant.workspaceId, channel.id, 'wamid.F', MessageStatus.SENT);

    await deliver(statusPayload({ wamid: 'wamid.F', status: 'failed', errors: FAILED_ERROR }));

    const updated = await testPrisma().message.findUniqueOrThrow({ where: { id: message.id } });
    expect(updated.status).toBe(MessageStatus.FAILED);
    expect(updated.errorCode).toBe('131047');
    expect(updated.errorTitle).toBe('Re-engagement message');
    expect(updated.errorDetails).toEqual({ details: 'Fora da janela de atendimento.' });
    expect(updated.failedAt).not.toBeNull();
  });

  it('status para mensagem desconhecida não quebra e é registrado', async () => {
    await tenantWithChannel('st-unknown');
    const [outcome] = await deliver(statusPayload({ wamid: 'wamid.NAO_EXISTE', status: 'read' }));

    expect(outcome?.result).toBe('IGNORED');
    const event = await testPrisma().webhookEvent.findFirstOrThrow({});
    expect(event.status).toBe(WebhookEventStatus.IGNORED);
  });

  it('webhook fora de ordem não regride o status', async () => {
    const { tenant, channel } = await tenantWithChannel('st-order');
    const message = await outboundMessage(tenant.workspaceId, channel.id, 'wamid.O', MessageStatus.SENT);

    // READ chega primeiro, DELIVERED depois — a ordem que a Meta não garante.
    await deliver(statusPayload({ wamid: 'wamid.O', status: 'read' }));
    await deliver(statusPayload({ wamid: 'wamid.O', status: 'delivered' }));

    const updated = await testPrisma().message.findUniqueOrThrow({ where: { id: message.id } });
    expect(updated.status).toBe(MessageStatus.READ);
  });

  it('a sequência completa fora de ordem termina em READ', async () => {
    const { tenant, channel } = await tenantWithChannel('st-order2');
    const message = await outboundMessage(tenant.workspaceId, channel.id, 'wamid.O2', MessageStatus.SENDING);

    for (const status of ['read', 'sent', 'delivered'] as const) {
      await deliver(statusPayload({ wamid: 'wamid.O2', status }));
    }

    const updated = await testPrisma().message.findUniqueOrThrow({ where: { id: message.id } });
    expect(updated.status).toBe(MessageStatus.READ);
  });

  it('falha depois de entrega comprovada é recusada', async () => {
    const { tenant, channel } = await tenantWithChannel('st-fail-late');
    const message = await outboundMessage(tenant.workspaceId, channel.id, 'wamid.FL', MessageStatus.READ);

    await deliver(statusPayload({ wamid: 'wamid.FL', status: 'failed', errors: FAILED_ERROR }));

    const updated = await testPrisma().message.findUniqueOrThrow({ where: { id: message.id } });
    expect(updated.status).toBe(MessageStatus.READ);
  });
});

describe('idempotência de entrega', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('o mesmo webhook entregue duas vezes tem um único efeito', async () => {
    const { tenant, channel } = await tenantWithChannel('idem');
    const message = await outboundMessage(tenant.workspaceId, channel.id, 'wamid.D', MessageStatus.SENT);
    const payload = statusPayload({ wamid: 'wamid.D', status: 'delivered' });

    const [primeira] = await deliver(payload);
    const [segunda] = await deliver(payload);

    expect(primeira?.result).toBe('PROCESSED');
    expect(segunda?.result).toBe('DUPLICATE');

    // Um único WebhookEvent, um único efeito.
    await expect(testPrisma().webhookEvent.count()).resolves.toBe(1);
    const updated = await testPrisma().message.findUniqueOrThrow({ where: { id: message.id } });
    expect(updated.status).toBe(MessageStatus.DELIVERED);
  });

  it('entregas concorrentes do mesmo evento não duplicam', async () => {
    const { tenant, channel } = await tenantWithChannel('idem-race');
    await outboundMessage(tenant.workspaceId, channel.id, 'wamid.R', MessageStatus.SENT);
    const payload = statusPayload({ wamid: 'wamid.R', status: 'delivered' });

    await Promise.all([deliver(payload), deliver(payload)]);

    await expect(testPrisma().webhookEvent.count()).resolves.toBe(1);
  });

  it('a mesma mensagem recebida duas vezes não duplica nem conta duas', async () => {
    const { tenant } = await tenantWithChannel('idem-in');
    const payload = textMessagePayload({ wamid: 'wamid.IN_DUP' });

    await deliver(payload);
    const [segunda] = await deliver(payload);

    expect(segunda?.result).toBe('DUPLICATE');
    await expect(
      testPrisma().message.count({ where: { workspaceId: tenant.workspaceId } }),
    ).resolves.toBe(1);

    const conversation = await testPrisma().conversation.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    expect(conversation.unreadCount).toBe(1);
  });
});

describe('mensagem recebida', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('cria contato, conversa e mensagem', async () => {
    const { tenant } = await tenantWithChannel('in-1');

    const [outcome] = await deliver(
      textMessagePayload({ wamid: 'wamid.IN1', body: 'Quero um orçamento' }),
    );
    expect(outcome?.result).toBe('PROCESSED');

    const contact = await testPrisma().contact.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    expect(contact.phoneE164).toBe('+5585988887777');
    expect(contact.source).toBe('WHATSAPP_INBOUND');
    expect(contact.firstName).toBe('Larissa Melo');

    const message = await testPrisma().message.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    expect(message.direction).toBe(MessageDirection.INBOUND);
    expect(message.status).toBe(MessageStatus.RECEIVED);
    expect(message.body).toBe('Quero um orçamento');
    expect(message.providerMessageId).toBe('wamid.IN1');

    const conversation = await testPrisma().conversation.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    expect(conversation.unreadCount).toBe(1);
    expect(conversation.lastInboundAt).not.toBeNull();
  });

  it('contato desconhecido NÃO ganha consentimento de marketing', async () => {
    const { tenant } = await tenantWithChannel('in-consent');
    await deliver(textMessagePayload({ wamid: 'wamid.IN2' }));

    const consent = await testPrisma().contactConsent.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId, channel: ConsentChannel.WHATSAPP },
    });
    // Escrever para a empresa é permissão de responder, não de fazer campanha.
    expect(consent.status).toBe(ConsentStatus.UNKNOWN);
    expect(consent.capturedAt).toBeNull();
  });

  it('reaproveita contato já existente em vez de duplicar', async () => {
    const { tenant } = await tenantWithChannel('in-existing');
    const contactId = await seedEligibleContact(tenant.workspaceId, '+5585988887777');

    await deliver(textMessagePayload({ wamid: 'wamid.IN3' }));

    await expect(
      testPrisma().contact.count({ where: { workspaceId: tenant.workspaceId } }),
    ).resolves.toBe(1);
    const message = await testPrisma().message.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    expect(message.contactId).toBe(contactId);
  });

  it('não altera o consentimento de um contato que já consentiu', async () => {
    const { tenant } = await tenantWithChannel('in-keep');
    await seedEligibleContact(tenant.workspaceId, '+5585988887777');

    await deliver(textMessagePayload({ wamid: 'wamid.IN4' }));

    const consent = await testPrisma().contactConsent.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    expect(consent.status).toBe(ConsentStatus.GRANTED);
  });

  it('contato arquivado que volta a escrever é reativado', async () => {
    const { tenant } = await tenantWithChannel('in-revive');
    const contactId = await seedEligibleContact(tenant.workspaceId, '+5585988887777');
    await testPrisma().contact.update({
      where: { id: contactId },
      data: { status: ContactStatus.ARCHIVED, archivedAt: new Date() },
    });

    await deliver(textMessagePayload({ wamid: 'wamid.IN5' }));

    const contact = await testPrisma().contact.findUniqueOrThrow({ where: { id: contactId } });
    expect(contact.status).toBe(ContactStatus.ACTIVE);
    expect(contact.archivedAt).toBeNull();
  });

  it('duas mensagens do mesmo contato usam uma só conversa', async () => {
    const { tenant } = await tenantWithChannel('in-conv');

    await deliver(textMessagePayload({ wamid: 'wamid.A1' }));
    await deliver(textMessagePayload({ wamid: 'wamid.A2', body: 'segunda' }));

    await expect(
      testPrisma().conversation.count({ where: { workspaceId: tenant.workspaceId } }),
    ).resolves.toBe(1);
    const conversation = await testPrisma().conversation.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    expect(conversation.unreadCount).toBe(2);
  });

  it('mídia guarda metadados e marca que o binário não foi baixado', async () => {
    const { tenant } = await tenantWithChannel('in-media');
    await deliver(mediaMessagePayload({ wamid: 'wamid.IMG', type: 'image' }));

    const message = await testPrisma().message.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    expect(message.type).toBe(MessageType.IMAGE);
    expect(message.mediaId).toBe('media_abc123');
    expect(message.mediaMimeType).toBe('image/jpeg');
    expect(message.mediaStatus).toBe(MediaStatus.NOT_YET_FETCHED);
  });

  it('conteúdo hostil é guardado como texto, sem interpretação', async () => {
    const { tenant } = await tenantWithChannel('in-xss');
    const hostil = '<script>fetch("//evil")</script><img src=x onerror=alert(1)>';
    await deliver(textMessagePayload({ wamid: 'wamid.XSS', body: hostil }));

    const message = await testPrisma().message.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    expect(message.body).toBe(hostil);
  });
});

describe('eventos não suportados e canal desconhecido', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('campo desconhecido é registrado como IGNORED, sem quebrar', async () => {
    await tenantWithChannel('unk-1');
    const [outcome] = await deliver(unknownFieldPayload());

    expect(outcome?.result).toBe('IGNORED');
    const event = await testPrisma().webhookEvent.findFirstOrThrow({});
    expect(event.status).toBe(WebhookEventStatus.IGNORED);
    expect(event.eventType).toBe('UNKNOWN_EVENT');
  });

  it('phone_number_id desconhecido é registrado sem workspace', async () => {
    await tenantWithChannel('unk-2');
    const [outcome] = await deliver(
      textMessagePayload({ wamid: 'wamid.NOCH', phoneNumberId: '999999999999999' }),
    );

    expect(outcome?.result).toBe('IGNORED');
    const event = await testPrisma().webhookEvent.findFirstOrThrow({});
    expect(event.workspaceId).toBeNull();
    expect(event.status).toBe(WebhookEventStatus.IGNORED);
    // Nenhum contato criado num workspace qualquer.
    await expect(testPrisma().contact.count()).resolves.toBe(0);
  });

  it('uma entrega com vários eventos processa todos', async () => {
    const { tenant, channel } = await tenantWithChannel('multi');
    await outboundMessage(tenant.workspaceId, channel.id, 'wamid.OUT_A', MessageStatus.SENT);
    await testPrisma().message.create({
      data: {
        workspaceId: tenant.workspaceId,
        channelId: channel.id,
        contactId: (await testPrisma().contact.findFirstOrThrow({})).id,
        direction: MessageDirection.OUTBOUND,
        type: MessageType.TEMPLATE,
        status: MessageStatus.SENT,
        providerMessageId: 'wamid.OUT_B',
      },
    });

    const outcomes = await deliver(multiEventPayload());

    expect(outcomes).toHaveLength(3);
    expect(outcomes.every((outcome) => outcome.result === 'PROCESSED')).toBe(true);
    await expect(testPrisma().webhookEvent.count()).resolves.toBe(3);
  });
});

describe('isolamento entre workspaces', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('o evento atinge apenas o workspace dono do phone_number_id', async () => {
    const alpha = await seedTenant('wh-a');
    const beta = await seedTenant('wh-b');
    await seedChannel(alpha.workspaceId, { phoneNumberId: PHONE_NUMBER_ID });
    await seedChannel(beta.workspaceId, { phoneNumberId: '888888888888888' });

    await deliver(textMessagePayload({ wamid: 'wamid.ISO' }));

    await expect(
      testPrisma().contact.count({ where: { workspaceId: alpha.workspaceId } }),
    ).resolves.toBe(1);
    await expect(
      testPrisma().contact.count({ where: { workspaceId: beta.workspaceId } }),
    ).resolves.toBe(0);
    await expect(
      testPrisma().conversation.count({ where: { workspaceId: beta.workspaceId } }),
    ).resolves.toBe(0);
  });

  it('status não alcança mensagem de outro workspace com o mesmo wamid', async () => {
    const alpha = await seedTenant('wh-c');
    const beta = await seedTenant('wh-d');
    const channelAlpha = await seedChannel(alpha.workspaceId, { phoneNumberId: PHONE_NUMBER_ID });
    const channelBeta = await seedChannel(beta.workspaceId, { phoneNumberId: '777777777777777' });

    const messageAlpha = await outboundMessage(alpha.workspaceId, channelAlpha.id, 'wamid.SHARED', MessageStatus.SENT);
    const contactBeta = await seedEligibleContact(beta.workspaceId, '+5585911112222');
    const messageBeta = await testPrisma().message.create({
      data: {
        workspaceId: beta.workspaceId,
        channelId: channelBeta.id,
        contactId: contactBeta,
        direction: MessageDirection.OUTBOUND,
        type: MessageType.TEMPLATE,
        status: MessageStatus.SENT,
        providerMessageId: 'wamid.SHARED',
      },
    });

    await deliver(statusPayload({ wamid: 'wamid.SHARED', status: 'read' }));

    await expect(
      testPrisma().message.findUniqueOrThrow({ where: { id: messageAlpha.id } }),
    ).resolves.toMatchObject({ status: MessageStatus.READ });
    await expect(
      testPrisma().message.findUniqueOrThrow({ where: { id: messageBeta.id } }),
    ).resolves.toMatchObject({ status: MessageStatus.SENT });
  });

  it('o audit log fica no workspace correto', async () => {
    const { tenant } = await tenantWithChannel('wh-audit');
    const outsider = await seedTenant('wh-outsider');

    await deliver(textMessagePayload({ wamid: 'wamid.AUD' }));

    await expect(
      testPrisma().auditLog.count({ where: { workspaceId: outsider.workspaceId } }),
    ).resolves.toBe(0);
    const actions = await testPrisma().auditLog.findMany({
      where: { workspaceId: tenant.workspaceId },
      select: { action: true },
    });
    expect(actions.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['conversation.created', 'message.inbound_received']),
    );
  });
});
