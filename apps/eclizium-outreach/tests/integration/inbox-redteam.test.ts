import { beforeEach, describe, expect, it } from 'vitest';
import { JobType, MessageDirection, WebhookEventStatus } from '@prisma/client';
import {
  addConversationNote,
  assignConversation,
} from '@/features/messaging/conversation-service';
import { createQuickReply, listQuickReplies } from '@/features/messaging/quick-reply-service';
import { getConversationDetail, listConversations } from '@/features/messaging/inbox-query';
import { fetchInboundMedia } from '@/features/messaging/media-service';
import { ingestEvent, processStoredEvent, requeueEvent } from '@/features/webhooks/processor';
import { parseWebhookPayload } from '@/features/webhooks/parser';
import { drainQueue } from '@/features/queue/worker';
import { listFailedEvents, webhookEventSummary } from '@/features/webhooks/event-query';
import { resetDatabase, testPrisma } from '../helpers/db';
import { seedChannel, seedTenant } from '../helpers/factories';
import { fakeGraph } from '../helpers/fake-graph';
import { PHONE_NUMBER_ID, mediaMessagePayload, textMessagePayload } from '../helpers/webhook-fixtures';
import { deliverPayload } from '../helpers/webhook-delivery';

/**
 * Red team da Sprint 6. Cada teste nomeia o ataque e o comportamento correto.
 */

async function tenantWithChannel(label: string) {
  const tenant = await seedTenant(label);
  const channel = await seedChannel(tenant.workspaceId, { phoneNumberId: PHONE_NUMBER_ID });
  return { tenant, channel };
}

async function conversationFor(label: string) {
  const context = await tenantWithChannel(label);
  await deliverPayload(textMessagePayload({ wamid: `wamid.${label}`, body: 'oi' }));
  const conversation = await testPrisma().conversation.findFirstOrThrow({
    where: { workspaceId: context.tenant.workspaceId },
  });
  return { ...context, conversation };
}

describe('red team — cruzamento de workspace', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('atribuir conversa a usuário de outro tenant é recusado', async () => {
    const { tenant, conversation } = await conversationFor('rt1');
    const outsider = await seedTenant('rt1-out');

    await assignConversation({
      workspaceId: tenant.workspaceId,
      conversationId: conversation.id,
      assigneeId: outsider.userId,
    });

    const updated = await testPrisma().conversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    expect(updated.assigneeId).toBeNull();
  });

  it('nota em conversa alheia não é criada', async () => {
    const { conversation } = await conversationFor('rt2');
    const outsider = await seedTenant('rt2-out');

    await addConversationNote({
      workspaceId: outsider.workspaceId,
      conversationId: conversation.id,
      authorId: outsider.userId,
      body: 'espionando',
    });

    await expect(testPrisma().conversationNote.count()).resolves.toBe(0);
  });

  it('detalhe de conversa alheia não vaza nem por id exato', async () => {
    const { conversation } = await conversationFor('rt3');
    const outsider = await seedTenant('rt3-out');

    await expect(
      getConversationDetail(outsider.workspaceId, conversation.id),
    ).resolves.toBeNull();
  });

  it('mídia de outro tenant não é servida e não chama a Meta', async () => {
    const context = await tenantWithChannel('rt4');
    await deliverPayload(mediaMessagePayload({ wamid: 'wamid.rt4', type: 'image' }));
    const message = await testPrisma().message.findFirstOrThrow({
      where: { workspaceId: context.tenant.workspaceId, direction: MessageDirection.INBOUND },
    });
    const outsider = await seedTenant('rt4-out');
    const graph = fakeGraph([{ json: { url: 'https://lookaside.fbsbx.com/x' } }]);

    const outcome = await fetchInboundMedia({
      workspaceId: outsider.workspaceId,
      messageId: message.id,
      providerOverrides: { fetchImpl: graph.fetchImpl },
    });

    expect(outcome.ok).toBe(false);
    expect(graph.calls).toHaveLength(0);
  });

  it('resumo e falhas de webhook só enxergam o próprio workspace', async () => {
    await conversationFor('rt5');
    const outsider = await seedTenant('rt5-out');

    const summary = await webhookEventSummary(outsider.workspaceId);
    expect(summary.processed).toBe(0);
    expect(summary.lastReceivedAt).toBeNull();
    await expect(listFailedEvents(outsider.workspaceId)).resolves.toHaveLength(0);
  });

  it('respostas rápidas de um workspace não aparecem no outro', async () => {
    const a = await seedTenant('rt6a');
    const b = await seedTenant('rt6b');
    await createQuickReply({
      workspaceId: a.workspaceId,
      title: 'Interno',
      body: 'segredo comercial',
      createdById: a.userId,
    });

    await expect(listQuickReplies(b.workspaceId)).resolves.toHaveLength(0);
  });
});

describe('red team — conteúdo hostil vindo do WhatsApp', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('mensagem com HTML é guardada como TEXTO, sem interpretação', async () => {
    const { tenant } = await tenantWithChannel('rt7');
    const hostile = '<img src=x onerror="alert(1)">';
    await deliverPayload(textMessagePayload({ wamid: 'wamid.rt7', body: hostile }));

    const message = await testPrisma().message.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    // Guardado exatamente como veio: quem escapa é a renderização, e nenhuma
    // parte da árvore da Inbox usa dangerouslySetInnerHTML.
    expect(message.body).toBe(hostile);

    const page = await listConversations(tenant.workspaceId);
    expect(page.items[0]?.lastMessagePreview).toBe(hostile);
  });

  it('nome de perfil hostil não vira nome de contato interpretado', async () => {
    const { tenant } = await tenantWithChannel('rt8');
    await deliverPayload(textMessagePayload({ wamid: 'wamid.rt8', body: 'oi' }));

    const contact = await testPrisma().contact.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    await testPrisma().contact.update({
      where: { id: contact.id },
      data: { firstName: '<script>alert(1)</script>' },
    });

    const page = await listConversations(tenant.workspaceId);
    expect(page.items[0]?.contactName).toBe('<script>alert(1)</script>');
  });

  it('mime forjado para text/html não é servido', async () => {
    const context = await tenantWithChannel('rt9');
    await deliverPayload(mediaMessagePayload({ wamid: 'wamid.rt9', type: 'image' }));
    const message = await testPrisma().message.findFirstOrThrow({
      where: { workspaceId: context.tenant.workspaceId, direction: MessageDirection.INBOUND },
    });
    await testPrisma().message.update({
      where: { id: message.id },
      data: { mediaMimeType: 'text/html' },
    });

    const outcome = await fetchInboundMedia({
      workspaceId: context.tenant.workspaceId,
      messageId: message.id,
    });
    expect(outcome).toMatchObject({ ok: false, status: 415 });
  });

  it('busca com termo vazio não devolve o mundo', async () => {
    const { tenant } = await conversationFor('rt10');
    const page = await listConversations(tenant.workspaceId, { search: '   ' });
    // Um ou dois dígitos também não podem casar com tudo.
    const curto = await listConversations(tenant.workspaceId, { search: '55' });
    expect(page.items.length + curto.items.length).toBe(0);
  });
});

describe('red team — fila de webhooks', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('job forjado apontando para evento de outro workspace não aplica efeito', async () => {
    const { tenant } = await tenantWithChannel('rt11');
    const parsed = parseWebhookPayload(
      JSON.stringify(textMessagePayload({ wamid: 'wamid.rt11', body: 'alvo' })),
    );
    if (!parsed.ok || !parsed.events[0]) throw new Error('sem evento');
    const ingested = await ingestEvent(parsed.events[0], { signatureValid: true });

    const attacker = await seedTenant('rt11-out');
    await testPrisma().job.create({
      data: {
        workspaceId: attacker.workspaceId,
        type: JobType.WEBHOOK_EVENT,
        payload: { eventId: ingested.eventId },
        idempotencyKey: 'webhook-event:forjado',
      },
    });

    await drainQueue({ workerId: 'rt-worker' });

    // O efeito foi aplicado no tenant DONO do canal, uma vez só — o workspace
    // do job não decide nada.
    await expect(
      testPrisma().message.count({ where: { workspaceId: attacker.workspaceId } }),
    ).resolves.toBe(0);
    await expect(
      testPrisma().message.count({ where: { workspaceId: tenant.workspaceId } }),
    ).resolves.toBe(1);
  });

  it('reprocessar em massa não duplica efeito', async () => {
    const { tenant } = await tenantWithChannel('rt12');
    await deliverPayload(textMessagePayload({ wamid: 'wamid.rt12', body: 'uma vez' }));
    const event = await testPrisma().webhookEvent.findFirstOrThrow({});

    // Força o evento de volta para FAILED e reenfileira várias vezes.
    await testPrisma().webhookEvent.update({
      where: { id: event.id },
      data: { status: WebhookEventStatus.FAILED },
    });
    await testPrisma().job.deleteMany({});

    await Promise.all(
      Array.from({ length: 6 }, () => requeueEvent(tenant.workspaceId, event.id)),
    );
    await drainQueue({ workerId: 'rt-worker-2' });

    await expect(
      testPrisma().message.count({ where: { workspaceId: tenant.workspaceId } }),
    ).resolves.toBe(1);
  });

  it('payload de evento adulterado para outro número não aplica no tenant errado', async () => {
    const { tenant } = await tenantWithChannel('rt13');
    const victim = await tenantWithChannel('rt13-victim');
    // O segundo canal precisa de outro phoneNumberId para o teste fazer sentido.
    await testPrisma().messagingChannel.update({
      where: { id: victim.channel.id },
      data: { phoneNumberId: '999999999999999' },
    });

    const parsed = parseWebhookPayload(
      JSON.stringify(textMessagePayload({ wamid: 'wamid.rt13', body: 'x' })),
    );
    if (!parsed.ok || !parsed.events[0]) throw new Error('sem evento');
    const ingested = await ingestEvent(parsed.events[0], { signatureValid: true });

    // Adultera o payload gravado para apontar ao número da vítima.
    const stored = await testPrisma().webhookEvent.findUniqueOrThrow({
      where: { id: ingested.eventId },
    });
    const payload = stored.payload as Record<string, unknown>;
    await testPrisma().webhookEvent.update({
      where: { id: stored.id },
      data: {
        payload: {
          ...payload,
          metadata: { phoneNumberId: '999999999999999', displayPhoneNumber: null, wabaId: null },
        },
      },
    });

    const result = await processStoredEvent(stored.id);

    // O workspace gravado na recepção não bate com o do canal resolvido agora:
    // ignorar é a resposta certa.
    expect(result.result).toBe('IGNORED');
    await expect(
      testPrisma().message.count({ where: { workspaceId: victim.tenant.workspaceId } }),
    ).resolves.toBe(0);
    await expect(
      testPrisma().message.count({ where: { workspaceId: tenant.workspaceId } }),
    ).resolves.toBe(0);
  });

  it('evento sem assinatura válida nunca chega à fila pelo caminho da rota', async () => {
    // A rota recusa antes de chamar a ingestão; aqui garantimos que a marca
    // fica gravada quando alguém chama a ingestão sem validar.
    const { tenant } = await tenantWithChannel('rt14');
    const parsed = parseWebhookPayload(
      JSON.stringify(textMessagePayload({ wamid: 'wamid.rt14', body: 'x' })),
    );
    if (!parsed.ok || !parsed.events[0]) throw new Error('sem evento');

    await ingestEvent(parsed.events[0], { signatureValid: false });
    const event = await testPrisma().webhookEvent.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    expect(event.signatureValid).toBe(false);
  });

  it('carga com 50 eventos não trava o ciclo nem perde nenhum', async () => {
    const { tenant } = await tenantWithChannel('rt15');

    for (let index = 0; index < 50; index += 1) {
      const parsed = parseWebhookPayload(
        JSON.stringify(textMessagePayload({ wamid: `wamid.rt15.${index}`, body: `m${index}` })),
      );
      if (!parsed.ok || !parsed.events[0]) throw new Error('sem evento');
      await ingestEvent(parsed.events[0], { signatureValid: true });
    }

    await drainQueue({ workerId: 'rt-worker-3', batchSize: 10 });

    await expect(
      testPrisma().message.count({ where: { workspaceId: tenant.workspaceId } }),
    ).resolves.toBe(50);
    await expect(
      testPrisma().webhookEvent.count({ where: { status: WebhookEventStatus.PROCESSED } }),
    ).resolves.toBe(50);
  }, 60_000);
});
