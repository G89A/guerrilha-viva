import { beforeEach, describe, expect, it } from 'vitest';
import { ConversationStatus, MessageDirection, MessageStatus } from '@prisma/client';
import { handleEvent } from '@/features/webhooks/processor';
import { parseWebhookPayload } from '@/features/webhooks/parser';
import {
  getConversationDetail,
  listConversations,
  unreadTotal,
} from '@/features/messaging/inbox-query';
import {
  markConversationRead,
  serviceWindow,
  setConversationStatus,
} from '@/features/messaging/conversation-service';
import { sendReply } from '@/features/messaging/reply-service';
import { resetDatabase, testPrisma } from '../helpers/db';
import { seedChannel, seedTenant } from '../helpers/factories';
import { fakeGraph, metaError, SEND_SUCCESS_RESPONSE } from '../helpers/fake-graph';
import { PHONE_NUMBER_ID, textMessagePayload } from '../helpers/webhook-fixtures';

async function deliver(payload: unknown) {
  const parsed = parseWebhookPayload(JSON.stringify(payload));
  if (!parsed.ok) throw new Error(parsed.reason);
  for (const event of parsed.events) {
    await handleEvent(event, { signatureValid: true });
  }
}

async function tenantWithChannel(label: string) {
  const tenant = await seedTenant(label);
  const channel = await seedChannel(tenant.workspaceId, { phoneNumberId: PHONE_NUMBER_ID });
  return { tenant, channel };
}

describe('listagem de conversas', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('mostra a conversa com prévia da última mensagem e não lidas', async () => {
    const { tenant } = await tenantWithChannel('ib-1');
    await deliver(textMessagePayload({ wamid: 'wamid.L1', body: 'Bom dia' }));

    const [conversation] = await listConversations(tenant.workspaceId);
    expect(conversation).toMatchObject({
      contactName: 'Larissa Melo',
      phoneE164: '+5585988887777',
      unreadCount: 1,
      lastMessagePreview: 'Bom dia',
      lastMessageInbound: true,
    });
  });

  it('ordena pela atividade mais recente', async () => {
    const { tenant } = await tenantWithChannel('ib-2');
    await deliver(textMessagePayload({ wamid: 'wamid.A', from: '5585911110000', timestamp: 1755730000 }));
    await deliver(textMessagePayload({ wamid: 'wamid.B', from: '5585922220000', timestamp: 1755740000 }));

    const conversations = await listConversations(tenant.workspaceId);
    expect(conversations[0]?.phoneE164).toBe('+5585922220000');
    expect(conversations[1]?.phoneE164).toBe('+5585911110000');
  });

  it('filtra apenas não lidas', async () => {
    const { tenant } = await tenantWithChannel('ib-3');
    await deliver(textMessagePayload({ wamid: 'wamid.C', from: '5585911110000' }));
    await deliver(textMessagePayload({ wamid: 'wamid.D', from: '5585922220000' }));

    const [primeira] = await listConversations(tenant.workspaceId);
    await markConversationRead(tenant.workspaceId, primeira!.id);

    const naoLidas = await listConversations(tenant.workspaceId, { unreadOnly: true });
    expect(naoLidas).toHaveLength(1);
    expect(naoLidas[0]?.id).not.toBe(primeira!.id);
  });

  it('busca por nome e por telefone', async () => {
    const { tenant } = await tenantWithChannel('ib-4');
    await deliver(textMessagePayload({ wamid: 'wamid.E', profileName: 'Fernanda Dias' }));

    await expect(
      listConversations(tenant.workspaceId, { search: 'Fernanda' }),
    ).resolves.toHaveLength(1);
    await expect(
      listConversations(tenant.workspaceId, { search: '98888' }),
    ).resolves.toHaveLength(1);
    await expect(
      listConversations(tenant.workspaceId, { search: 'ninguém' }),
    ).resolves.toHaveLength(0);
  });

  it('filtra por status', async () => {
    const { tenant } = await tenantWithChannel('ib-5');
    await deliver(textMessagePayload({ wamid: 'wamid.F' }));
    const [conversation] = await listConversations(tenant.workspaceId);
    await setConversationStatus(tenant.workspaceId, conversation!.id, ConversationStatus.CLOSED);

    await expect(
      listConversations(tenant.workspaceId, { status: ConversationStatus.OPEN }),
    ).resolves.toHaveLength(0);
    await expect(
      listConversations(tenant.workspaceId, { status: ConversationStatus.CLOSED }),
    ).resolves.toHaveLength(1);
  });

  it('não vaza conversas de outro workspace', async () => {
    const { tenant } = await tenantWithChannel('ib-6');
    const outsider = await seedTenant('ib-outsider');
    await deliver(textMessagePayload({ wamid: 'wamid.G' }));

    await expect(listConversations(outsider.workspaceId)).resolves.toEqual([]);
    void tenant;
  });
});

describe('não lidas do CRM', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('marcar como lida zera o contador sem tocar no status do WhatsApp', async () => {
    const { tenant } = await tenantWithChannel('unread-1');
    await deliver(textMessagePayload({ wamid: 'wamid.U1' }));
    await deliver(textMessagePayload({ wamid: 'wamid.U2', body: 'segunda' }));

    const [conversation] = await listConversations(tenant.workspaceId);
    expect(conversation?.unreadCount).toBe(2);

    const result = await markConversationRead(tenant.workspaceId, conversation!.id);
    expect(result.changed).toBe(true);

    await expect(unreadTotal(tenant.workspaceId)).resolves.toBe(0);

    // O status das mensagens recebidas continua RECEIVED: o contador de não
    // lidas é da equipe, não do WhatsApp.
    const messages = await testPrisma().message.findMany({
      where: { workspaceId: tenant.workspaceId },
    });
    expect(messages.every((message) => message.status === MessageStatus.RECEIVED)).toBe(true);
  });

  it('marcar duas vezes é inofensivo', async () => {
    const { tenant } = await tenantWithChannel('unread-2');
    await deliver(textMessagePayload({ wamid: 'wamid.U3' }));
    const [conversation] = await listConversations(tenant.workspaceId);

    await expect(markConversationRead(tenant.workspaceId, conversation!.id)).resolves.toEqual({
      changed: true,
    });
    await expect(markConversationRead(tenant.workspaceId, conversation!.id)).resolves.toEqual({
      changed: false,
    });
  });

  it('não zera o contador de conversa de outro workspace', async () => {
    const { tenant } = await tenantWithChannel('unread-3');
    const outsider = await seedTenant('unread-out');
    await deliver(textMessagePayload({ wamid: 'wamid.U4' }));
    const [conversation] = await listConversations(tenant.workspaceId);

    const result = await markConversationRead(outsider.workspaceId, conversation!.id);
    expect(result.changed).toBe(false);
    await expect(unreadTotal(tenant.workspaceId)).resolves.toBe(1);
  });

  it('nova mensagem depois de lida volta a contar', async () => {
    const { tenant } = await tenantWithChannel('unread-4');
    await deliver(textMessagePayload({ wamid: 'wamid.U5' }));
    const [conversation] = await listConversations(tenant.workspaceId);
    await markConversationRead(tenant.workspaceId, conversation!.id);

    await deliver(textMessagePayload({ wamid: 'wamid.U6', body: 'de novo' }));
    await expect(unreadTotal(tenant.workspaceId)).resolves.toBe(1);
  });
});

describe('detalhe da conversa', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('traz histórico em ordem cronológica e ficha do contato', async () => {
    const { tenant } = await tenantWithChannel('det-1');
    await deliver(textMessagePayload({ wamid: 'wamid.H1', body: 'primeira', timestamp: 1755730000 }));
    await deliver(textMessagePayload({ wamid: 'wamid.H2', body: 'segunda', timestamp: 1755740000 }));

    const [item] = await listConversations(tenant.workspaceId);
    const detail = await getConversationDetail(tenant.workspaceId, item!.id);

    expect(detail?.messages.map((message) => message.body)).toEqual(['primeira', 'segunda']);
    expect(detail?.contact.phoneE164).toBe('+5585988887777');
    expect(detail?.contact.consents).toHaveLength(1);
  });

  it('conversa de outro workspace não é encontrada', async () => {
    const { tenant } = await tenantWithChannel('det-2');
    const outsider = await seedTenant('det-out');
    await deliver(textMessagePayload({ wamid: 'wamid.H3' }));
    const [item] = await listConversations(tenant.workspaceId);

    await expect(getConversationDetail(outsider.workspaceId, item!.id)).resolves.toBeNull();
  });
});

describe('janela de atendimento de 24 horas', () => {
  it('aberta logo após a mensagem do contato', () => {
    const now = new Date('2026-08-21T12:00:00Z');
    const window = serviceWindow(new Date('2026-08-21T10:00:00Z'), now);
    expect(window.open).toBe(true);
  });

  it('fechada passadas 24 horas', () => {
    const now = new Date('2026-08-22T11:00:00Z');
    const window = serviceWindow(new Date('2026-08-21T10:00:00Z'), now);
    expect(window.open).toBe(false);
  });

  it('fechada quando o contato nunca escreveu', () => {
    expect(serviceWindow(null).open).toBe(false);
  });

  it('exatamente no limite já está fechada', () => {
    const inbound = new Date('2026-08-21T10:00:00Z');
    const now = new Date(inbound.getTime() + 24 * 60 * 60 * 1000);
    expect(serviceWindow(inbound, now).open).toBe(false);
  });
});

describe('resposta manual', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function conversationReady(label: string) {
    const { tenant, channel } = await tenantWithChannel(label);
    await deliver(textMessagePayload({ wamid: `wamid.${label}`, timestamp: Math.floor(Date.now() / 1000) }));
    const [item] = await listConversations(tenant.workspaceId);
    return { tenant, channel, conversationId: item!.id };
  }

  it('envia e persiste o wamid devolvido pelo provider', async () => {
    const context = await conversationReady('rep1');
    const { fetchImpl, calls } = fakeGraph([{ json: SEND_SUCCESS_RESPONSE }]);

    const outcome = await sendReply({
      workspaceId: context.tenant.workspaceId,
      actorUserId: context.tenant.userId,
      conversationId: context.conversationId,
      text: 'Claro, posso ajudar!',
      providerOverrides: { fetchImpl },
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.providerMessageId).toBe(SEND_SUCCESS_RESPONSE.messages[0]?.id);
    expect(outcome.message.direction).toBe(MessageDirection.OUTBOUND);
    expect(outcome.message.status).toBe(MessageStatus.SENT);

    const body = calls[0]?.body as { type: string; text: { body: string } };
    expect(body.type).toBe('text');
    expect(body.text.body).toBe('Claro, posso ajudar!');
  });

  it('bloqueia fora da janela de 24 horas, sem chamar a Meta', async () => {
    const { tenant, channel } = await tenantWithChannel('rep2');
    // Mensagem recebida há dois dias: janela fechada.
    const old = Math.floor((Date.now() - 48 * 60 * 60 * 1000) / 1000);
    await deliver(textMessagePayload({ wamid: 'wamid.OLD', timestamp: old }));
    const [item] = await listConversations(tenant.workspaceId);
    const { fetchImpl, calls } = fakeGraph([{ json: SEND_SUCCESS_RESPONSE }]);

    const outcome = await sendReply({
      workspaceId: tenant.workspaceId,
      actorUserId: tenant.userId,
      conversationId: item!.id,
      text: 'oi',
      providerOverrides: { fetchImpl },
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok || outcome.kind !== 'BLOCKED') return;
    expect(outcome.reason).toContain('24 horas');
    expect(calls).toHaveLength(0);
    void channel;
  });

  it('bloqueia contato suprimido, sem chamar a Meta', async () => {
    const context = await conversationReady('rep3');
    const contact = await testPrisma().contact.findFirstOrThrow({
      where: { workspaceId: context.tenant.workspaceId },
    });
    await testPrisma().suppressionEntry.create({
      data: {
        workspaceId: context.tenant.workspaceId,
        contactId: contact.id,
        phoneE164: contact.phoneE164,
        reason: 'OPT_OUT',
      },
    });
    const { fetchImpl, calls } = fakeGraph([{ json: SEND_SUCCESS_RESPONSE }]);

    const outcome = await sendReply({
      workspaceId: context.tenant.workspaceId,
      actorUserId: context.tenant.userId,
      conversationId: context.conversationId,
      text: 'oi',
      providerOverrides: { fetchImpl },
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok || outcome.kind !== 'BLOCKED') return;
    expect(outcome.reason).toContain('supressão');
    expect(calls).toHaveLength(0);
  });

  it('falha do provider marca FAILED sem inventar wamid', async () => {
    const context = await conversationReady('rep4');
    const { fetchImpl } = fakeGraph([{ status: 400, json: metaError('bad request', 100) }]);

    const outcome = await sendReply({
      workspaceId: context.tenant.workspaceId,
      actorUserId: context.tenant.userId,
      conversationId: context.conversationId,
      text: 'oi',
      providerOverrides: { fetchImpl },
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok || outcome.kind !== 'FAILED') return;
    expect(outcome.message.status).toBe(MessageStatus.FAILED);
    expect(outcome.message.providerMessageId).toBeNull();
  });

  it('recusa conversa de outro workspace', async () => {
    const context = await conversationReady('rep5');
    const outsider = await seedTenant('rep-out');
    const { fetchImpl, calls } = fakeGraph([{ json: SEND_SUCCESS_RESPONSE }]);

    await expect(
      sendReply({
        workspaceId: outsider.workspaceId,
        actorUserId: outsider.userId,
        conversationId: context.conversationId,
        text: 'oi',
        providerOverrides: { fetchImpl },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['vazia', '   '],
    ['longa demais', 'x'.repeat(5000)],
  ])('recusa mensagem %s', async (_label, text) => {
    const context = await conversationReady(`rep-${_label.slice(0, 4)}`);
    await expect(
      sendReply({
        workspaceId: context.tenant.workspaceId,
        actorUserId: context.tenant.userId,
        conversationId: context.conversationId,
        text,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('a resposta entra na conversa e atualiza a última atividade', async () => {
    const context = await conversationReady('rep6');
    const { fetchImpl } = fakeGraph([{ json: SEND_SUCCESS_RESPONSE }]);

    await sendReply({
      workspaceId: context.tenant.workspaceId,
      actorUserId: context.tenant.userId,
      conversationId: context.conversationId,
      text: 'resposta',
      providerOverrides: { fetchImpl },
    });

    const detail = await getConversationDetail(context.tenant.workspaceId, context.conversationId);
    expect(detail?.messages).toHaveLength(2);
    expect(detail?.messages[1]?.direction).toBe(MessageDirection.OUTBOUND);

    const [item] = await listConversations(context.tenant.workspaceId);
    expect(item?.lastMessageInbound).toBe(false);
  });
});
