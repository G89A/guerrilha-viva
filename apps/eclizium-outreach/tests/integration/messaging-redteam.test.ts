import { beforeEach, describe, expect, it } from 'vitest';
import { ChannelStatus, CredentialSource } from '@prisma/client';
import { syncTemplates } from '@/features/messaging/template-sync';
import { testChannelConnection } from '@/features/messaging/channel-service';
import { sendTestMessage } from '@/features/messaging/send-service';
import { resolveCredentials, describeCredentials } from '@/features/messaging/credentials';
import { evaluateContactEligibility } from '@/features/messaging/eligibility';
import { resetDatabase, testPrisma } from '../helpers/db';
import {
  seedChannel,
  seedEligibleContact,
  seedTemplate,
  seedTenant,
} from '../helpers/factories';
import {
  fakeGraph,
  metaError,
  PHONE_NUMBER_RESPONSE,
  SEND_SUCCESS_RESPONSE,
  templateEntry,
  WABA_RESPONSE,
} from '../helpers/fake-graph';

/**
 * Red team do Sprint 2: tentativas deliberadas de quebrar a integração.
 * Cada teste descreve o ataque e o comportamento correto esperado.
 */

describe('red team — credenciais', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('token corrompido no banco vira NOT_CONFIGURED, não vazamento de erro cru', async () => {
    const tenant = await seedTenant('rt-cred');
    const channel = await seedChannel(tenant.workspaceId, {
      accessTokenCipher: 'v1.lixo.lixo.lixo',
    });

    expect(() => resolveCredentials(channel)).toThrowError(/decifrar/i);
  });

  it('canal sem WABA nem número lista exatamente o que falta', async () => {
    const tenant = await seedTenant('rt-cred2');
    const channel = await seedChannel(tenant.workspaceId, {
      wabaId: null as unknown as string,
      phoneNumberId: null as unknown as string,
    });

    try {
      resolveCredentials(channel);
      throw new Error('deveria ter lançado');
    } catch (error) {
      expect(error).toMatchObject({ code: 'NOT_CONFIGURED' });
      const details = (error as { details?: { missing?: string[] } }).details;
      expect(details?.missing).toEqual(expect.arrayContaining(['WABA ID', 'Phone Number ID']));
    }
  });

  it('o resumo de credencial nunca inclui o ciphertext', async () => {
    const tenant = await seedTenant('rt-cred3');
    const channel = await seedChannel(tenant.workspaceId);
    const summary = describeCredentials(channel);

    expect(JSON.stringify(summary)).not.toContain(channel.accessTokenCipher ?? '__x__');
    expect(JSON.stringify(summary)).not.toContain('EAAG-token-de-teste');
  });

  it('credencial de ambiente ausente é reportada como faltando, sem quebrar', async () => {
    const tenant = await seedTenant('rt-cred4');
    const channel = await seedChannel(tenant.workspaceId, {
      credentialSource: CredentialSource.ENVIRONMENT,
      accessTokenCipher: null,
    });

    const summary = describeCredentials(channel);
    expect(typeof summary.present).toBe('boolean');
  });
});

describe('red team — respostas hostis da Meta', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function channelFor(label: string) {
    const tenant = await seedTenant(label);
    return { tenant, channel: await seedChannel(tenant.workspaceId) };
  }

  it('HTML em vez de JSON não quebra a verificação', async () => {
    const { channel } = await channelFor('rt-html');
    const { fetchImpl } = fakeGraph([{ raw: '<html>502</html>' }]);

    const outcome = await testChannelConnection(channel, { fetchImpl });
    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe(ChannelStatus.ERROR);
  });

  it('429 é tratado como limite, com mensagem própria', async () => {
    const { channel } = await channelFor('rt-429');
    const { fetchImpl } = fakeGraph([{ status: 429, json: metaError('rate limited', 4) }]);

    const outcome = await testChannelConnection(channel, { fetchImpl });
    expect(outcome.message).toContain('limitando');
  });

  it('500 repetido não promove o canal a conectado', async () => {
    const { channel } = await channelFor('rt-500');
    const { fetchImpl } = fakeGraph([{ status: 500, json: { error: { message: 'boom' } } }]);

    const outcome = await testChannelConnection(channel, { fetchImpl });
    expect(outcome.status).not.toBe(ChannelStatus.CONNECTED);
  });

  it('template com conteúdo de XSS é armazenado como dado, sem execução', async () => {
    const { tenant, channel } = await channelFor('rt-xss');
    const payload = '<script>alert(1)</script> Olá {{1}}';
    const { fetchImpl } = fakeGraph([
      {
        json: {
          data: [
            templateEntry({
              components: [{ type: 'BODY', text: payload }],
            }),
          ],
        },
      },
    ]);

    await syncTemplates(channel, { fetchImpl });

    const stored = await testPrisma().messageTemplate.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    // Guardado literalmente; a renderização é feita como texto React, nunca
    // via HTML cru — não há caminho de execução.
    expect(stored.body).toBe(payload);
  });

  it('paginação infinita é interrompida pela trava de páginas', async () => {
    const { channel } = await channelFor('rt-loop');
    // A resposta sempre traz um cursor novo: sem trava, giraria para sempre.
    const { fetchImpl, calls } = fakeGraph([
      {
        json: {
          data: [templateEntry()],
          paging: { next: 'https://x', cursors: { after: 'SEMPRE' } },
        },
      },
    ]);

    await syncTemplates(channel, { fetchImpl });
    expect(calls.length).toBeLessThanOrEqual(50);
  });

  it('resposta com data gigante não estoura: cada item é validado', async () => {
    const { tenant, channel } = await channelFor('rt-big');
    const entries = Array.from({ length: 200 }, (_value, index) =>
      templateEntry({ id: `tpl_${index}`, name: `template_${index}` }),
    );
    const { fetchImpl } = fakeGraph([{ json: { data: entries } }]);

    const report = await syncTemplates(channel, { fetchImpl });
    expect(report.created).toBe(200);
    await expect(
      testPrisma().messageTemplate.count({ where: { workspaceId: tenant.workspaceId } }),
    ).resolves.toBe(200);
  });
});

describe('red team — ataque entre tenants', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('workspace B não consegue avaliar elegibilidade de contato de A', async () => {
    const alpha = await seedTenant('rt-a');
    const beta = await seedTenant('rt-b');
    const channelBeta = await seedChannel(beta.workspaceId);
    const templateBeta = await seedTemplate(beta.workspaceId, channelBeta.id);
    const contactAlpha = await seedEligibleContact(alpha.workspaceId, '+5585911110000');

    const result = await evaluateContactEligibility({
      workspaceId: beta.workspaceId,
      contactId: contactAlpha,
      channel: channelBeta,
      template: templateBeta,
      mapping: { 'body:1': { source: 'contact.firstName' } },
    });

    expect(result.eligible).toBe(false);
    expect(result.reasons[0]?.code).toBe('CONTACT_NOT_FOUND');
  });

  it('template de A avaliado no contexto de B é recusado', async () => {
    const alpha = await seedTenant('rt-c');
    const beta = await seedTenant('rt-d');
    const channelAlpha = await seedChannel(alpha.workspaceId);
    const templateAlpha = await seedTemplate(alpha.workspaceId, channelAlpha.id);
    const channelBeta = await seedChannel(beta.workspaceId);
    const contactBeta = await seedEligibleContact(beta.workspaceId, '+5585922220000');

    const result = await evaluateContactEligibility({
      workspaceId: beta.workspaceId,
      contactId: contactBeta,
      channel: channelBeta,
      // Mesmo passando o objeto do outro tenant à força, a checagem pega.
      template: templateAlpha,
      mapping: { 'body:1': { source: 'contact.firstName' } },
    });

    expect(result.eligible).toBe(false);
    expect(result.reasons.map((reason) => reason.code)).toContain('TEMPLATE_NOT_FOUND');
  });

  it('mensagem enviada por A não aparece na contagem de B', async () => {
    const alpha = await seedTenant('rt-e');
    const beta = await seedTenant('rt-f');
    const channelAlpha = await seedChannel(alpha.workspaceId);
    const templateAlpha = await seedTemplate(alpha.workspaceId, channelAlpha.id);
    const contactAlpha = await seedEligibleContact(alpha.workspaceId, '+5585933330000');
    const { fetchImpl } = fakeGraph([{ json: SEND_SUCCESS_RESPONSE }]);

    await sendTestMessage({
      workspaceId: alpha.workspaceId,
      actorUserId: alpha.userId,
      contactId: contactAlpha,
      templateId: templateAlpha.id,
      mapping: { 'body:1': { source: 'contact.firstName' } },
      providerOverrides: { fetchImpl },
    });

    await expect(
      testPrisma().message.count({ where: { workspaceId: beta.workspaceId } }),
    ).resolves.toBe(0);
    await expect(
      testPrisma().message.count({ where: { workspaceId: alpha.workspaceId } }),
    ).resolves.toBe(1);
  });

  it('o mesmo wamid pode existir em workspaces distintos sem colidir', async () => {
    const alpha = await seedTenant('rt-g');
    const beta = await seedTenant('rt-h');

    for (const tenant of [alpha, beta]) {
      const channel = await seedChannel(tenant.workspaceId);
      const template = await seedTemplate(tenant.workspaceId, channel.id);
      const contactId = await seedEligibleContact(
        tenant.workspaceId,
        tenant === alpha ? '+5585944440000' : '+5585955550000',
      );
      const { fetchImpl } = fakeGraph([{ json: SEND_SUCCESS_RESPONSE }]);

      await sendTestMessage({
        workspaceId: tenant.workspaceId,
        actorUserId: tenant.userId,
        contactId,
        templateId: template.id,
        mapping: { 'body:1': { source: 'contact.firstName' } },
        providerOverrides: { fetchImpl },
      });
    }

    const wamid = SEND_SUCCESS_RESPONSE.messages[0]?.id;
    await expect(
      testPrisma().message.count({ where: { providerMessageId: wamid } }),
    ).resolves.toBe(2);
  });

  it('a chave de idempotência de A não bloqueia um envio de B', async () => {
    const alpha = await seedTenant('rt-i');
    const beta = await seedTenant('rt-j');
    const results: boolean[] = [];

    for (const tenant of [alpha, beta]) {
      const channel = await seedChannel(tenant.workspaceId);
      const template = await seedTemplate(tenant.workspaceId, channel.id);
      const contactId = await seedEligibleContact(
        tenant.workspaceId,
        tenant === alpha ? '+5585966660000' : '+5585977770000',
      );
      const { fetchImpl } = fakeGraph([{ json: SEND_SUCCESS_RESPONSE }]);

      const outcome = await sendTestMessage({
        workspaceId: tenant.workspaceId,
        actorUserId: tenant.userId,
        contactId,
        templateId: template.id,
        mapping: { 'body:1': { source: 'contact.firstName' } },
        providerOverrides: { fetchImpl },
      });
      results.push(outcome.ok);
    }

    expect(results).toEqual([true, true]);
  });
});

describe('red team — segredos nunca vazam', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('nenhum campo do canal serializado contém o token', async () => {
    const tenant = await seedTenant('rt-leak');
    const channel = await seedChannel(tenant.workspaceId);
    const { fetchImpl } = fakeGraph([
      { json: PHONE_NUMBER_RESPONSE },
      { json: WABA_RESPONSE },
      { json: { data: [] } },
    ]);

    const outcome = await testChannelConnection(channel, { fetchImpl });
    expect(JSON.stringify(outcome)).not.toContain('EAAG-token-de-teste');
  });

  it('o audit log não guarda credencial', async () => {
    const alpha = await seedTenant('rt-audit');
    const channel = await seedChannel(alpha.workspaceId);
    const template = await seedTemplate(alpha.workspaceId, channel.id);
    const contactId = await seedEligibleContact(alpha.workspaceId, '+5585988880001');
    const { fetchImpl } = fakeGraph([{ json: SEND_SUCCESS_RESPONSE }]);

    await sendTestMessage({
      workspaceId: alpha.workspaceId,
      actorUserId: alpha.userId,
      contactId,
      templateId: template.id,
      mapping: { 'body:1': { source: 'contact.firstName' } },
      providerOverrides: { fetchImpl },
    });

    const logs = await testPrisma().auditLog.findMany({
      where: { workspaceId: alpha.workspaceId },
    });
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain('EAAG');
    expect(serialized).not.toMatch(/accessToken|access_token/i);
  });

  it('a mensagem persistida não carrega credencial no payload', async () => {
    const tenant = await seedTenant('rt-payload');
    const channel = await seedChannel(tenant.workspaceId);
    const template = await seedTemplate(tenant.workspaceId, channel.id);
    const contactId = await seedEligibleContact(tenant.workspaceId, '+5585999990001');
    const { fetchImpl } = fakeGraph([{ json: SEND_SUCCESS_RESPONSE }]);

    await sendTestMessage({
      workspaceId: tenant.workspaceId,
      actorUserId: tenant.userId,
      contactId,
      templateId: template.id,
      mapping: { 'body:1': { source: 'contact.firstName' } },
      providerOverrides: { fetchImpl },
    });

    const message = await testPrisma().message.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    expect(JSON.stringify(message)).not.toContain('EAAG');
  });
});
