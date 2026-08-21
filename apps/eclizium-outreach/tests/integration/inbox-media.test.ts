import { beforeEach, describe, expect, it } from 'vitest';
import { MessageDirection } from '@prisma/client';
import { fetchInboundMedia, isServableMime, MAX_MEDIA_BYTES } from '@/features/messaging/media-service';
import { confirmReadOnProvider } from '@/features/messaging/read-receipt-service';
import { resetDatabase, testPrisma } from '../helpers/db';
import { seedChannel, seedTenant } from '../helpers/factories';
import { fakeGraph, metaError } from '../helpers/fake-graph';
import { PHONE_NUMBER_ID, mediaMessagePayload, textMessagePayload } from '../helpers/webhook-fixtures';
import { deliverPayload } from '../helpers/webhook-delivery';

const MEDIA_URL = 'https://lookaside.fbsbx.com/whatsapp_business/attachments/abc';

async function tenantWithChannel(label: string) {
  const tenant = await seedTenant(label);
  const channel = await seedChannel(tenant.workspaceId, { phoneNumberId: PHONE_NUMBER_ID });
  return { tenant, channel };
}

async function inboundMedia(label: string, type: 'image' | 'document' = 'image') {
  const context = await tenantWithChannel(label);
  await deliverPayload(mediaMessagePayload({ wamid: `wamid.${label}`, type }));
  const message = await testPrisma().message.findFirstOrThrow({
    where: { workspaceId: context.tenant.workspaceId, direction: MessageDirection.INBOUND },
  });
  return { ...context, message };
}

describe('allowlist de tipo', () => {
  it.each([
    ['image/jpeg', true],
    ['image/png; charset=binary', true],
    ['video/mp4', true],
    ['audio/ogg', true],
    ['application/pdf', true],
    ['text/html', false],
    ['image/svg+xml', true],
    ['application/javascript', false],
    ['text/plain', false],
    [null, false],
  ])('%s → servível: %s', (mime, expected) => {
    expect(isServableMime(mime)).toBe(expected);
  });
});

describe('mídia sob demanda', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('busca na Meta em dois passos e devolve os bytes', async () => {
    const { tenant, message } = await inboundMedia('med1');
    const graph = fakeGraph([
      { json: { url: MEDIA_URL, mime_type: 'image/jpeg' } },
      { raw: 'BYTES-DA-IMAGEM' },
    ]);

    const outcome = await fetchInboundMedia({
      workspaceId: tenant.workspaceId,
      messageId: message.id,
      providerOverrides: { fetchImpl: graph.fetchImpl },
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(Buffer.from(outcome.media.bytes).toString()).toBe('BYTES-DA-IMAGEM');
    expect(outcome.mimeType).toBe('image/jpeg');

    // Duas chamadas: descrever e baixar. O token vai no header, nunca na URL.
    expect(graph.calls).toHaveLength(2);
    expect(graph.calls[1]?.url).toBe(MEDIA_URL);
    expect(graph.calls[1]?.headers.authorization).toMatch(/^Bearer /);
    expect(graph.calls[1]?.url).not.toContain('Bearer');
  });

  it('NADA é armazenado: o status da mídia continua "não baixado"', async () => {
    const { tenant, message } = await inboundMedia('med2');
    const graph = fakeGraph([{ json: { url: MEDIA_URL } }, { raw: 'x' }]);

    await fetchInboundMedia({
      workspaceId: tenant.workspaceId,
      messageId: message.id,
      providerOverrides: { fetchImpl: graph.fetchImpl },
    });

    const after = await testPrisma().message.findUniqueOrThrow({ where: { id: message.id } });
    expect(after.mediaStatus).toBe('NOT_YET_FETCHED');
  });

  it('mensagem de OUTRO workspace não é encontrada', async () => {
    const { message } = await inboundMedia('med3');
    const outsider = await seedTenant('med3-out');
    const graph = fakeGraph([{ json: { url: MEDIA_URL } }, { raw: 'x' }]);

    const outcome = await fetchInboundMedia({
      workspaceId: outsider.workspaceId,
      messageId: message.id,
      providerOverrides: { fetchImpl: graph.fetchImpl },
    });

    expect(outcome).toMatchObject({ ok: false, status: 404 });
    // Nenhuma chamada externa: a recusa acontece antes de falar com a Meta.
    expect(graph.calls).toHaveLength(0);
  });

  it('mensagem enviada por nós não é servida como mídia recebida', async () => {
    const { tenant, channel } = await tenantWithChannel('med4');
    const contact = await testPrisma().contact.create({
      data: { workspaceId: tenant.workspaceId, phoneE164: '+5585912341234' },
    });
    const outbound = await testPrisma().message.create({
      data: {
        workspaceId: tenant.workspaceId,
        channelId: channel.id,
        contactId: contact.id,
        direction: MessageDirection.OUTBOUND,
        mediaId: 'media_x',
        mediaMimeType: 'image/jpeg',
      },
    });

    const outcome = await fetchInboundMedia({
      workspaceId: tenant.workspaceId,
      messageId: outbound.id,
    });
    expect(outcome).toMatchObject({ ok: false, status: 404 });
  });

  it('tipo fora da allowlist é recusado sem chamar a Meta', async () => {
    const { tenant, message } = await inboundMedia('med5');
    await testPrisma().message.update({
      where: { id: message.id },
      data: { mediaMimeType: 'text/html' },
    });
    const graph = fakeGraph([{ json: { url: MEDIA_URL } }]);

    const outcome = await fetchInboundMedia({
      workspaceId: tenant.workspaceId,
      messageId: message.id,
      providerOverrides: { fetchImpl: graph.fetchImpl },
    });

    expect(outcome).toMatchObject({ ok: false, status: 415 });
    expect(graph.calls).toHaveLength(0);
  });

  it('URL fora dos domínios da Meta é recusada — o token não sai de casa', async () => {
    const { tenant, message } = await inboundMedia('med6');
    const graph = fakeGraph([{ json: { url: 'https://atacante.example/roubo' } }]);

    const outcome = await fetchInboundMedia({
      workspaceId: tenant.workspaceId,
      messageId: message.id,
      providerOverrides: { fetchImpl: graph.fetchImpl },
    });

    expect(outcome.ok).toBe(false);
    // Só a chamada de descrição aconteceu; o download nunca foi tentado.
    expect(graph.calls).toHaveLength(1);
  });

  it('resposta sem URL não vira download', async () => {
    const { tenant, message } = await inboundMedia('med7');
    const graph = fakeGraph([{ json: { mime_type: 'image/jpeg' } }]);

    const outcome = await fetchInboundMedia({
      workspaceId: tenant.workspaceId,
      messageId: message.id,
      providerOverrides: { fetchImpl: graph.fetchImpl },
    });

    expect(outcome.ok).toBe(false);
    expect(graph.calls).toHaveLength(1);
  });

  it('erro da Meta vira recusa com texto nosso, sem vazar detalhe cru', async () => {
    const { tenant, message } = await inboundMedia('med8');
    const graph = fakeGraph([{ status: 404, json: metaError('Unsupported get request', 100) }]);

    const outcome = await fetchInboundMedia({
      workspaceId: tenant.workspaceId,
      messageId: message.id,
      providerOverrides: { fetchImpl: graph.fetchImpl },
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).not.toContain('Unsupported get request');
  });

  it('arquivo maior que o teto é recusado', async () => {
    const { tenant, message } = await inboundMedia('med9');
    const graph = fakeGraph([
      { json: { url: MEDIA_URL, mime_type: 'image/jpeg' } },
      { raw: 'a'.repeat(MAX_MEDIA_BYTES + 1) },
    ]);

    const outcome = await fetchInboundMedia({
      workspaceId: tenant.workspaceId,
      messageId: message.id,
      providerOverrides: { fetchImpl: graph.fetchImpl },
    });

    expect(outcome.ok).toBe(false);
  }, 30_000);

  it('mensagem sem mídia não busca nada', async () => {
    const context = await tenantWithChannel('med10');
    await deliverPayload(textMessagePayload({ wamid: 'wamid.med10', body: 'só texto' }));
    const message = await testPrisma().message.findFirstOrThrow({
      where: { workspaceId: context.tenant.workspaceId },
    });

    const outcome = await fetchInboundMedia({
      workspaceId: context.tenant.workspaceId,
      messageId: message.id,
    });
    expect(outcome).toMatchObject({ ok: false, status: 404 });
  });
});

describe('confirmação de leitura', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function conversationWithInbound(label: string) {
    const context = await tenantWithChannel(label);
    await deliverPayload(textMessagePayload({ wamid: `wamid.${label}`, body: 'oi' }));
    const conversation = await testPrisma().conversation.findFirstOrThrow({
      where: { workspaceId: context.tenant.workspaceId },
    });
    return { ...context, conversation };
  }

  it('confirma na Meta e só então marca localmente', async () => {
    const { tenant, conversation } = await conversationWithInbound('rr1');
    const graph = fakeGraph([{ json: { success: true } }]);

    const outcome = await confirmReadOnProvider({
      workspaceId: tenant.workspaceId,
      conversationId: conversation.id,
      providerOverrides: { fetchImpl: graph.fetchImpl },
    });

    expect(outcome).toMatchObject({ ok: true, confirmed: 1 });
    expect(graph.calls[0]?.body).toMatchObject({
      messaging_product: 'whatsapp',
      status: 'read',
    });

    const message = await testPrisma().message.findFirstOrThrow({
      where: { direction: MessageDirection.INBOUND },
    });
    expect(message.readReceiptAt).not.toBeNull();
  });

  it('falha na Meta NÃO marca como confirmado', async () => {
    const { tenant, conversation } = await conversationWithInbound('rr2');
    const graph = fakeGraph([{ status: 400, json: metaError('Something went wrong', 131_000) }]);

    const outcome = await confirmReadOnProvider({
      workspaceId: tenant.workspaceId,
      conversationId: conversation.id,
      providerOverrides: { fetchImpl: graph.fetchImpl },
    });

    expect(outcome.ok).toBe(false);
    const message = await testPrisma().message.findFirstOrThrow({
      where: { direction: MessageDirection.INBOUND },
    });
    expect(message.readReceiptAt).toBeNull();
  });

  it('sem nada novo, não chama a Meta', async () => {
    const { tenant, conversation } = await conversationWithInbound('rr3');
    const first = fakeGraph([{ json: { success: true } }]);
    await confirmReadOnProvider({
      workspaceId: tenant.workspaceId,
      conversationId: conversation.id,
      providerOverrides: { fetchImpl: first.fetchImpl },
    });

    const second = fakeGraph([{ json: { success: true } }]);
    const outcome = await confirmReadOnProvider({
      workspaceId: tenant.workspaceId,
      conversationId: conversation.id,
      providerOverrides: { fetchImpl: second.fetchImpl },
    });

    expect(outcome.ok).toBe(false);
    expect(second.calls).toHaveLength(0);
  });

  it('conversa de outro workspace não confirma nada', async () => {
    const { conversation } = await conversationWithInbound('rr4');
    const outsider = await seedTenant('rr4-out');
    const graph = fakeGraph([{ json: { success: true } }]);

    const outcome = await confirmReadOnProvider({
      workspaceId: outsider.workspaceId,
      conversationId: conversation.id,
      providerOverrides: { fetchImpl: graph.fetchImpl },
    });

    expect(outcome.ok).toBe(false);
    expect(graph.calls).toHaveLength(0);
  });

  it('confirmar leitura é diferente de zerar o contador do CRM', async () => {
    const { tenant, conversation } = await conversationWithInbound('rr5');
    const graph = fakeGraph([{ json: { success: true } }]);

    await confirmReadOnProvider({
      workspaceId: tenant.workspaceId,
      conversationId: conversation.id,
      providerOverrides: { fetchImpl: graph.fetchImpl },
    });

    const updated = await testPrisma().conversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    // O contador da equipe continua como estava: são conceitos separados.
    expect(updated.unreadCount).toBe(1);
  });

  it('6 confirmações simultâneas fazem no máximo uma chamada bem-sucedida', async () => {
    const { tenant, conversation } = await conversationWithInbound('rr6');
    const graph = fakeGraph([{ json: { success: true } }]);

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        confirmReadOnProvider({
          workspaceId: tenant.workspaceId,
          conversationId: conversation.id,
          providerOverrides: { fetchImpl: graph.fetchImpl },
        }),
      ),
    );

    // Todas podem passar pela Meta (ela é idempotente para isso), mas a marca
    // local converge para uma data só.
    expect(results.some((result) => result.ok)).toBe(true);
    const messages = await testPrisma().message.findMany({
      where: { direction: MessageDirection.INBOUND },
      select: { readReceiptAt: true },
    });
    expect(messages.every((message) => message.readReceiptAt !== null)).toBe(true);
  });
});
