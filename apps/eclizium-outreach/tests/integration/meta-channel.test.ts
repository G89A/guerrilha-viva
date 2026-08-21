import { beforeEach, describe, expect, it } from 'vitest';
import { ChannelEnvironment, ChannelStatus, CredentialSource } from '@prisma/client';
import {
  configureChannel,
  disconnectChannel,
  findChannel,
  requireChannel,
  testChannelConnection,
  toChannelView,
} from '@/features/messaging/channel-service';
import { resolveCredentials } from '@/features/messaging/credentials';
import { resetDatabase, testPrisma } from '../helpers/db';
import { seedChannel, seedTenant } from '../helpers/factories';
import { fakeGraph, metaError, PHONE_NUMBER_RESPONSE, WABA_RESPONSE } from '../helpers/fake-graph';

const BASE = {
  displayName: 'WhatsApp Principal',
  wabaId: '222222222222222',
  phoneNumberId: '111111111111111',
  graphApiVersion: 'v21.0',
  environment: ChannelEnvironment.TEST,
};

describe('configureChannel', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('cria o canal e NÃO o marca como conectado', async () => {
    const tenant = await seedTenant('cfg');

    const channel = await configureChannel({
      workspaceId: tenant.workspaceId,
      ...BASE,
      credentialSource: CredentialSource.ENCRYPTED,
      accessToken: 'EAAG-token-real',
    });

    // Salvar credencial não é o mesmo que a integração funcionar.
    expect(channel.status).toBe(ChannelStatus.NOT_CONFIGURED);
    expect(channel.connectedAt).toBeNull();
    expect(channel.lastVerifiedAt).toBeNull();
  });

  it('nunca guarda o token em texto claro', async () => {
    const tenant = await seedTenant('cfg2');

    const channel = await configureChannel({
      workspaceId: tenant.workspaceId,
      ...BASE,
      credentialSource: CredentialSource.ENCRYPTED,
      accessToken: 'EAAG-token-super-secreto',
    });

    expect(channel.accessTokenCipher).not.toBeNull();
    expect(channel.accessTokenCipher).not.toContain('EAAG-token-super-secreto');
    expect(JSON.stringify(channel)).not.toContain('EAAG-token-super-secreto');

    // Nem mesmo lendo a linha crua do banco.
    const raw = await testPrisma().$queryRawUnsafe<Array<Record<string, unknown>>>(
      'select * from messaging_channels where id = $1',
      channel.id,
    );
    expect(JSON.stringify(raw)).not.toContain('EAAG-token-super-secreto');
  });

  it('reconfigurar sem redigitar o token mantém o cifrado existente', async () => {
    const tenant = await seedTenant('cfg3');
    const first = await configureChannel({
      workspaceId: tenant.workspaceId,
      ...BASE,
      credentialSource: CredentialSource.ENCRYPTED,
      accessToken: 'EAAG-token-original',
    });

    const second = await configureChannel({
      workspaceId: tenant.workspaceId,
      ...BASE,
      displayName: 'Nome novo',
      credentialSource: CredentialSource.ENCRYPTED,
    });

    expect(second.accessTokenCipher).toBe(first.accessTokenCipher);
    expect(second.displayName).toBe('Nome novo');
    expect(resolveCredentials(second).accessToken).toBe('EAAG-token-original');
  });

  it('exige token na primeira configuração cifrada', async () => {
    const tenant = await seedTenant('cfg4');
    await expect(
      configureChannel({
        workspaceId: tenant.workspaceId,
        ...BASE,
        credentialSource: CredentialSource.ENCRYPTED,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('reconfigurar é upsert: não cria um segundo canal', async () => {
    const tenant = await seedTenant('cfg5');
    await configureChannel({
      workspaceId: tenant.workspaceId,
      ...BASE,
      credentialSource: CredentialSource.ENCRYPTED,
      accessToken: 'EAAG-a',
    });
    await configureChannel({
      workspaceId: tenant.workspaceId,
      ...BASE,
      credentialSource: CredentialSource.ENCRYPTED,
      accessToken: 'EAAG-b',
    });

    await expect(
      testPrisma().messagingChannel.count({ where: { workspaceId: tenant.workspaceId } }),
    ).resolves.toBe(1);
  });

  it('trocar para credencial de ambiente limpa o cifrado guardado', async () => {
    const tenant = await seedTenant('cfg6');
    await configureChannel({
      workspaceId: tenant.workspaceId,
      ...BASE,
      credentialSource: CredentialSource.ENCRYPTED,
      accessToken: 'EAAG-token',
    });

    const switched = await configureChannel({
      workspaceId: tenant.workspaceId,
      ...BASE,
      credentialSource: CredentialSource.ENVIRONMENT,
    });

    expect(switched.accessTokenCipher).toBeNull();
    expect(switched.tokenFingerprint).toBeNull();
  });
});

describe('testChannelConnection', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('promove a CONNECTED e grava os dados do número', async () => {
    const tenant = await seedTenant('conn');
    const channel = await seedChannel(tenant.workspaceId, {
      status: ChannelStatus.NOT_CONFIGURED,
    });
    const { fetchImpl } = fakeGraph([
      { json: PHONE_NUMBER_RESPONSE },
      { json: WABA_RESPONSE },
      { json: { data: [] } },
    ]);

    const outcome = await testChannelConnection(channel, { fetchImpl });

    expect(outcome.ok).toBe(true);
    expect(outcome.status).toBe(ChannelStatus.CONNECTED);

    const stored = await testPrisma().messagingChannel.findUniqueOrThrow({
      where: { id: channel.id },
    });
    expect(stored.status).toBe(ChannelStatus.CONNECTED);
    expect(stored.verifiedName).toBe('ECLIZIUM Teste');
    expect(stored.displayPhoneNumber).toBe('+55 85 99999-0000');
    expect(stored.connectedAt).not.toBeNull();
    expect(stored.lastError).toBeNull();
  });

  it('token inválido marca INVALID com mensagem compreensível', async () => {
    const tenant = await seedTenant('conn2');
    const channel = await seedChannel(tenant.workspaceId);
    const { fetchImpl } = fakeGraph([
      { status: 401, json: metaError('Invalid OAuth access token', 190) },
    ]);

    const outcome = await testChannelConnection(channel, { fetchImpl });

    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe(ChannelStatus.INVALID);
    expect(outcome.message).toContain('autenticar');
    expect(outcome.message).not.toContain('EAAG');

    const stored = await testPrisma().messagingChannel.findUniqueOrThrow({
      where: { id: channel.id },
    });
    expect(stored.connectedAt).toBeNull();
    expect(stored.lastError).not.toBeNull();
  });

  it('WABA inacessível reprova sem apagar o canal', async () => {
    const tenant = await seedTenant('conn3');
    const channel = await seedChannel(tenant.workspaceId);
    const { fetchImpl } = fakeGraph([
      { json: PHONE_NUMBER_RESPONSE },
      { status: 404, json: metaError('Unsupported get request', 803) },
      { json: { data: [] } },
    ]);

    const outcome = await testChannelConnection(channel, { fetchImpl });

    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe(ChannelStatus.ERROR);
    await expect(findChannel(tenant.workspaceId)).resolves.not.toBeNull();
  });

  it('timeout vira ERROR e não derruba a ação', async () => {
    const tenant = await seedTenant('conn4');
    const channel = await seedChannel(tenant.workspaceId);
    const { fetchImpl } = fakeGraph([{ hang: true }]);

    const outcome = await testChannelConnection(channel, { fetchImpl, timeoutMs: 50 });

    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe(ChannelStatus.ERROR);
  });

  it('canal sem credencial reporta NOT_CONFIGURED, não erro genérico', async () => {
    const tenant = await seedTenant('conn5');
    const channel = await seedChannel(tenant.workspaceId, {
      credentialSource: CredentialSource.ENCRYPTED,
      accessTokenCipher: null,
    });

    const outcome = await testChannelConnection(channel);

    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe(ChannelStatus.NOT_CONFIGURED);
  });
});

describe('isolamento entre workspaces', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('o canal de um workspace não aparece para outro', async () => {
    const alpha = await seedTenant('ch-a');
    const beta = await seedTenant('ch-b');
    await seedChannel(alpha.workspaceId);

    await expect(findChannel(beta.workspaceId)).resolves.toBeNull();
    await expect(requireChannel(beta.workspaceId)).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
    });
  });

  it('cada workspace mantém sua própria WABA e número', async () => {
    const alpha = await seedTenant('ch-c');
    const beta = await seedTenant('ch-d');

    await configureChannel({
      workspaceId: alpha.workspaceId,
      ...BASE,
      wabaId: '100000000000001',
      phoneNumberId: '100000000000002',
      credentialSource: CredentialSource.ENCRYPTED,
      accessToken: 'EAAG-alpha',
    });
    await configureChannel({
      workspaceId: beta.workspaceId,
      ...BASE,
      wabaId: '200000000000001',
      phoneNumberId: '200000000000002',
      credentialSource: CredentialSource.ENCRYPTED,
      accessToken: 'EAAG-beta',
    });

    const channelAlpha = await requireChannel(alpha.workspaceId);
    const channelBeta = await requireChannel(beta.workspaceId);

    expect(channelAlpha.wabaId).toBe('100000000000001');
    expect(channelBeta.wabaId).toBe('200000000000001');
    expect(resolveCredentials(channelAlpha).accessToken).toBe('EAAG-alpha');
    expect(resolveCredentials(channelBeta).accessToken).toBe('EAAG-beta');
  });

  it('desconectar um canal não afeta o outro', async () => {
    const alpha = await seedTenant('ch-e');
    const beta = await seedTenant('ch-f');
    const channelAlpha = await seedChannel(alpha.workspaceId);
    await seedChannel(beta.workspaceId);

    await disconnectChannel(channelAlpha);

    const stored = await requireChannel(beta.workspaceId);
    expect(stored.status).toBe(ChannelStatus.CONNECTED);
  });
});

describe('toChannelView', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('nunca expõe token nem ciphertext', async () => {
    const tenant = await seedTenant('view');
    const channel = await seedChannel(tenant.workspaceId);

    const view = toChannelView(channel);
    const serialized = JSON.stringify(view);

    expect(serialized).not.toContain('EAAG-token-de-teste');
    expect(serialized).not.toContain(channel.accessTokenCipher ?? '__ausente__');
    expect(view.credentials.fingerprint).toBe('••••abc12345');
    expect(view.credentials.present).toBe(true);
  });

  it('reporta o que falta quando não há credencial', async () => {
    const tenant = await seedTenant('view2');
    const channel = await seedChannel(tenant.workspaceId, {
      credentialSource: CredentialSource.ENCRYPTED,
      accessTokenCipher: null,
    });

    const view = toChannelView(channel);
    expect(view.credentials.present).toBe(false);
    expect(view.credentials.missing).toContain('META_ACCESS_TOKEN');
  });
});
