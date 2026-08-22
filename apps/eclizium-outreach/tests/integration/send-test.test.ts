import { beforeEach, describe, expect, it } from 'vitest';
import {
  ChannelStatus,
  ConsentChannel,
  ConsentStatus,
  ContactStatus,
  MessageStatus,
  SuppressionReason,
  TemplateAvailability,
  TemplateStatus,
} from '@prisma/client';
import { sendTestMessage } from '@/features/messaging/send-service';
import { resetDatabase, testPrisma } from '../helpers/db';
import {
  seedChannel,
  seedEligibleContact,
  seedTemplate,
  seedTenant,
} from '../helpers/factories';
import { fakeGraph, metaError, SEND_SUCCESS_RESPONSE, type FakeResponse } from '../helpers/fake-graph';

const MAPPING = { 'body:1': { source: 'contact.firstName' as const } };

async function scenario(options: { responses?: FakeResponse[] } = {}) {
  const tenant = await seedTenant('send');
  const channel = await seedChannel(tenant.workspaceId);
  const template = await seedTemplate(tenant.workspaceId, channel.id);
  const contactId = await seedEligibleContact(tenant.workspaceId, '+5585999990000');
  const { fetchImpl, calls } = fakeGraph(options.responses ?? [{ json: SEND_SUCCESS_RESPONSE }]);

  return { tenant, channel, template, contactId, fetchImpl, calls };
}

describe('sendTestMessage — caminho feliz', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('envia e persiste o wamid real devolvido pela Meta', async () => {
    const context = await scenario();

    const outcome = await sendTestMessage({
      workspaceId: context.tenant.workspaceId,
      actorUserId: context.tenant.userId,
      contactId: context.contactId,
      templateId: context.template.id,
      mapping: MAPPING,
      providerOverrides: { fetchImpl: context.fetchImpl },
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.providerMessageId).toBe(SEND_SUCCESS_RESPONSE.messages[0]?.id);

    const stored = await testPrisma().message.findUniqueOrThrow({
      where: { id: outcome.message.id },
    });
    expect(stored.status).toBe(MessageStatus.SENT);
    expect(stored.providerMessageId).toBe(SEND_SUCCESS_RESPONSE.messages[0]?.id);
    expect(stored.sentAt).not.toBeNull();
    expect(stored.renderedContent).toBe('Olá Ana, tudo bem?');
    expect(stored.createdById).toBe(context.tenant.userId);
  });

  it('envia os parâmetros resolvidos para a Meta', async () => {
    const context = await scenario();

    await sendTestMessage({
      workspaceId: context.tenant.workspaceId,
      actorUserId: context.tenant.userId,
      contactId: context.contactId,
      templateId: context.template.id,
      mapping: MAPPING,
      providerOverrides: { fetchImpl: context.fetchImpl },
    });

    const body = context.calls[0]?.body as {
      to: string;
      template: { components: Array<{ parameters: Array<{ text: string }> }> };
    };
    expect(body.to).toBe('5585999990000');
    expect(body.template.components[0]?.parameters[0]?.text).toBe('Ana');
  });

  it('registra audit log de tentativa e de envio', async () => {
    const context = await scenario();

    await sendTestMessage({
      workspaceId: context.tenant.workspaceId,
      actorUserId: context.tenant.userId,
      contactId: context.contactId,
      templateId: context.template.id,
      mapping: MAPPING,
      providerOverrides: { fetchImpl: context.fetchImpl },
    });

    const actions = await testPrisma().auditLog.findMany({
      where: { workspaceId: context.tenant.workspaceId },
      select: { action: true },
    });
    expect(actions.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['messaging.test_message_attempted', 'messaging.test_message_sent']),
    );
  });
});

describe('sendTestMessage — bloqueios NÃO chamam a Meta', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function expectBlocked(
    mutate: (context: Awaited<ReturnType<typeof scenario>>) => Promise<void>,
    expectedReason: string,
  ) {
    const context = await scenario();
    await mutate(context);

    const outcome = await sendTestMessage({
      workspaceId: context.tenant.workspaceId,
      actorUserId: context.tenant.userId,
      contactId: context.contactId,
      templateId: context.template.id,
      mapping: MAPPING,
      providerOverrides: { fetchImpl: context.fetchImpl },
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.kind).toBe('BLOCKED');
    if (outcome.kind !== 'BLOCKED') return;
    expect(outcome.eligibility.reasons.map((reason) => reason.code)).toContain(expectedReason);

    // A garantia central desta sprint: ZERO requisições ao provedor.
    expect(context.calls).toHaveLength(0);
    // E nenhuma mensagem persistida.
    await expect(
      testPrisma().message.count({ where: { workspaceId: context.tenant.workspaceId } }),
    ).resolves.toBe(0);
  }

  it('consentimento revogado bloqueia', async () => {
    await expectBlocked(async (context) => {
      await testPrisma().contactConsent.updateMany({
        where: { contactId: context.contactId, channel: ConsentChannel.WHATSAPP },
        data: { status: ConsentStatus.REVOKED },
      });
    }, 'CONSENT_REVOKED');
  });

  it('consentimento desconhecido bloqueia', async () => {
    await expectBlocked(async (context) => {
      await testPrisma().contactConsent.updateMany({
        where: { contactId: context.contactId },
        data: { status: ConsentStatus.UNKNOWN },
      });
    }, 'CONSENT_MISSING');
  });

  it('contato suprimido bloqueia', async () => {
    await expectBlocked(async (context) => {
      await testPrisma().suppressionEntry.create({
        data: {
          workspaceId: context.tenant.workspaceId,
          contactId: context.contactId,
          phoneE164: '+5585999990000',
          channel: ConsentChannel.WHATSAPP,
          reason: SuppressionReason.OPT_OUT,
        },
      });
    }, 'SUPPRESSED');
  });

  it('template rejeitado bloqueia', async () => {
    await expectBlocked(async (context) => {
      await testPrisma().messageTemplate.update({
        where: { id: context.template.id },
        data: { status: TemplateStatus.REJECTED, providerStatus: 'REJECTED' },
      });
    }, 'TEMPLATE_NOT_APPROVED');
  });

  it('template indisponível na Meta bloqueia', async () => {
    await expectBlocked(async (context) => {
      await testPrisma().messageTemplate.update({
        where: { id: context.template.id },
        data: { availability: TemplateAvailability.UNAVAILABLE },
      });
    }, 'TEMPLATE_UNAVAILABLE');
  });

  it('canal desconectado bloqueia', async () => {
    await expectBlocked(async (context) => {
      await testPrisma().messagingChannel.update({
        where: { id: context.channel.id },
        data: { status: ChannelStatus.DISCONNECTED },
      });
    }, 'CHANNEL_NOT_CONNECTED');
  });

  it('canal com credencial inválida bloqueia', async () => {
    await expectBlocked(async (context) => {
      await testPrisma().messagingChannel.update({
        where: { id: context.channel.id },
        data: { status: ChannelStatus.INVALID },
      });
    }, 'CHANNEL_NOT_CONNECTED');
  });

  it('contato arquivado bloqueia', async () => {
    await expectBlocked(async (context) => {
      await testPrisma().contact.update({
        where: { id: context.contactId },
        data: { status: ContactStatus.ARCHIVED, archivedAt: new Date() },
      });
    }, 'CONTACT_NOT_ACTIVE');
  });

  it('variável sem valor bloqueia em vez de enviar texto vazio', async () => {
    const context = await scenario();
    await testPrisma().contact.update({
      where: { id: context.contactId },
      data: { firstName: null },
    });

    const outcome = await sendTestMessage({
      workspaceId: context.tenant.workspaceId,
      actorUserId: context.tenant.userId,
      contactId: context.contactId,
      templateId: context.template.id,
      mapping: MAPPING,
      providerOverrides: { fetchImpl: context.fetchImpl },
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok || outcome.kind !== 'BLOCKED') return;
    expect(outcome.eligibility.reasons.map((reason) => reason.code)).toContain(
      'VARIABLES_UNRESOLVED',
    );
    expect(context.calls).toHaveLength(0);
  });

  it('múltiplos bloqueios são reportados juntos', async () => {
    const context = await scenario();
    await testPrisma().contactConsent.updateMany({
      where: { contactId: context.contactId },
      data: { status: ConsentStatus.REVOKED },
    });
    await testPrisma().messagingChannel.update({
      where: { id: context.channel.id },
      data: { status: ChannelStatus.DISCONNECTED },
    });

    const outcome = await sendTestMessage({
      workspaceId: context.tenant.workspaceId,
      actorUserId: context.tenant.userId,
      contactId: context.contactId,
      templateId: context.template.id,
      mapping: MAPPING,
      providerOverrides: { fetchImpl: context.fetchImpl },
    });

    if (outcome.ok || outcome.kind !== 'BLOCKED') throw new Error('esperava bloqueio');
    const codes = outcome.eligibility.reasons.map((reason) => reason.code);
    expect(codes).toContain('CONSENT_REVOKED');
    expect(codes).toContain('CHANNEL_NOT_CONNECTED');
  });
});

describe('sendTestMessage — falha do provedor', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('marca FAILED com erro sanitizado e sem inventar wamid', async () => {
    const context = await scenario({
      responses: [{ status: 401, json: metaError('Invalid OAuth access token', 190) }],
    });

    const outcome = await sendTestMessage({
      workspaceId: context.tenant.workspaceId,
      actorUserId: context.tenant.userId,
      contactId: context.contactId,
      templateId: context.template.id,
      mapping: MAPPING,
      providerOverrides: { fetchImpl: context.fetchImpl },
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok || outcome.kind !== 'FAILED') return;
    expect(outcome.retryable).toBe(false);
    expect(outcome.error).not.toContain('EAAG');

    const stored = await testPrisma().message.findUniqueOrThrow({
      where: { id: outcome.message.id },
    });
    expect(stored.status).toBe(MessageStatus.FAILED);
    expect(stored.providerMessageId).toBeNull();
    expect(stored.failedAt).not.toBeNull();
  });

  it('timeout é retentável e fica registrado', async () => {
    const context = await scenario({ responses: [{ hang: true }] });

    const outcome = await sendTestMessage({
      workspaceId: context.tenant.workspaceId,
      actorUserId: context.tenant.userId,
      contactId: context.contactId,
      templateId: context.template.id,
      mapping: MAPPING,
      providerOverrides: { fetchImpl: context.fetchImpl, timeoutMs: 50 },
    });

    if (outcome.ok || outcome.kind !== 'FAILED') throw new Error('esperava falha');
    expect(outcome.retryable).toBe(true);
    expect(outcome.message.status).toBe(MessageStatus.FAILED);
  });

  it('resposta 200 sem wamid é falha, não sucesso silencioso', async () => {
    const context = await scenario({ responses: [{ json: { messages: [] } }] });

    const outcome = await sendTestMessage({
      workspaceId: context.tenant.workspaceId,
      actorUserId: context.tenant.userId,
      contactId: context.contactId,
      templateId: context.template.id,
      mapping: MAPPING,
      providerOverrides: { fetchImpl: context.fetchImpl },
    });

    expect(outcome.ok).toBe(false);
    const stored = await testPrisma().message.findFirstOrThrow({
      where: { workspaceId: context.tenant.workspaceId },
    });
    expect(stored.status).toBe(MessageStatus.FAILED);
    expect(stored.providerMessageId).toBeNull();
  });
});

describe('sendTestMessage — idempotência e isolamento', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('segundo envio imediato do mesmo par é recusado', async () => {
    const context = await scenario({
      responses: [{ json: SEND_SUCCESS_RESPONSE }, { json: SEND_SUCCESS_RESPONSE }],
    });

    const input = {
      workspaceId: context.tenant.workspaceId,
      actorUserId: context.tenant.userId,
      contactId: context.contactId,
      templateId: context.template.id,
      mapping: MAPPING,
      providerOverrides: { fetchImpl: context.fetchImpl },
    };

    await sendTestMessage(input);
    await expect(sendTestMessage(input)).rejects.toMatchObject({ code: 'CONFLICT' });

    // Somente uma requisição chegou à Meta.
    expect(context.calls).toHaveLength(1);
  });

  it('duplo clique concorrente não gera dois envios bem-sucedidos', async () => {
    const context = await scenario({
      responses: [{ json: SEND_SUCCESS_RESPONSE }, { json: SEND_SUCCESS_RESPONSE }],
    });

    const input = {
      workspaceId: context.tenant.workspaceId,
      actorUserId: context.tenant.userId,
      contactId: context.contactId,
      templateId: context.template.id,
      mapping: MAPPING,
      providerOverrides: { fetchImpl: context.fetchImpl },
    };

    const results = await Promise.allSettled([sendTestMessage(input), sendTestMessage(input)]);
    const sent = results.filter((result) => result.status === 'fulfilled' && result.value.ok);
    const rejected = results.filter((result) => result.status === 'rejected');

    // A unique em (workspaceId, idempotencyKey) decide no banco: exatamente uma
    // das duas execuções concorrentes cria a mensagem e chama a Meta.
    //
    // Se a forma dos resultados divergir, o motivo tem de aparecer no log: uma
    // corrida rara que só se manifesta sob carga é justamente a que não se
    // consegue diagnosticar depois, com a asserção seca.
    if (sent.length !== 1 || rejected.length !== 1) {
      console.error(
        'forma inesperada do duplo clique:',
        JSON.stringify(
          results.map((result) =>
            result.status === 'rejected'
              ? { estado: 'rejeitado', erro: String(result.reason) }
              : { estado: 'cumprido', valor: result.value },
          ),
          null,
          2,
        ),
      );
    }

    // Segurança primeiro: uma chamada à Meta e uma linha de mensagem são o que
    // não pode falhar de jeito nenhum. A FORMA da falha do perdedor vem depois
    // — se algum dia divergir, o log acima diz qual foi, e estas duas linhas já
    // terão dito se a garantia se manteve.
    expect(context.calls).toHaveLength(1);
    await expect(
      testPrisma().message.count({ where: { workspaceId: context.tenant.workspaceId } }),
    ).resolves.toBe(1);

    expect(sent).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  it('contato de outro workspace não é encontrado', async () => {
    const context = await scenario();
    const outsider = await seedTenant('outsider');
    const foreignContact = await seedEligibleContact(outsider.workspaceId, '+5585988880000');

    const outcome = await sendTestMessage({
      workspaceId: context.tenant.workspaceId,
      actorUserId: context.tenant.userId,
      contactId: foreignContact,
      templateId: context.template.id,
      mapping: MAPPING,
      providerOverrides: { fetchImpl: context.fetchImpl },
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok || outcome.kind !== 'BLOCKED') return;
    expect(outcome.eligibility.reasons[0]?.code).toBe('CONTACT_NOT_FOUND');
    expect(context.calls).toHaveLength(0);
  });

  it('template de outro workspace não é encontrado', async () => {
    const context = await scenario();
    const outsider = await seedTenant('outsider2');
    const outsiderChannel = await seedChannel(outsider.workspaceId);
    const foreignTemplate = await seedTemplate(outsider.workspaceId, outsiderChannel.id);

    const outcome = await sendTestMessage({
      workspaceId: context.tenant.workspaceId,
      actorUserId: context.tenant.userId,
      contactId: context.contactId,
      templateId: foreignTemplate.id,
      mapping: MAPPING,
      providerOverrides: { fetchImpl: context.fetchImpl },
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok || outcome.kind !== 'BLOCKED') return;
    expect(outcome.eligibility.reasons.map((reason) => reason.code)).toContain(
      'TEMPLATE_NOT_FOUND',
    );
    expect(context.calls).toHaveLength(0);
  });
});
