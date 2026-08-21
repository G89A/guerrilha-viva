import { beforeEach, describe, expect, it } from 'vitest';
import { TemplateAvailability, TemplateStatus } from '@prisma/client';
import { syncTemplates } from '@/features/messaging/template-sync';
import { resetDatabase, testPrisma } from '../helpers/db';
import { seedChannel, seedTenant } from '../helpers/factories';
import { fakeGraph, templateEntry, type FakeResponse } from '../helpers/fake-graph';

/** Roda a sincronização com um transporte falso injetado. */
async function sync(channel: Awaited<ReturnType<typeof seedChannel>>, responses: FakeResponse[]) {
  const { fetchImpl, calls } = fakeGraph(responses);
  const report = await syncTemplates(channel, { fetchImpl });
  return { report, calls };
}

describe('syncTemplates', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('primeira sincronização cria os templates com campos normalizados', async () => {
    const tenant = await seedTenant('sync');
    const channel = await seedChannel(tenant.workspaceId);

    const { report } = await sync(channel, [{ json: { data: [templateEntry()] } }]);

    expect(report).toMatchObject({ fetched: 1, created: 1, updated: 0 });

    const stored = await testPrisma().messageTemplate.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    expect(stored.name).toBe('boas_vindas');
    expect(stored.status).toBe(TemplateStatus.APPROVED);
    expect(stored.providerStatus).toBe('APPROVED');
    expect(stored.headerText).toBe('Olá {{1}}');
    expect(stored.footerText).toBe('ECLIZIUM');
    expect(stored.variableCount).toBe(2);
    expect(stored.qualityScore).toBe('GREEN');
    expect(stored.syncedAt).not.toBeNull();
  });

  it('segunda sincronização atualiza sem duplicar', async () => {
    const tenant = await seedTenant('sync2');
    const channel = await seedChannel(tenant.workspaceId);

    await sync(channel, [{ json: { data: [templateEntry()] } }]);
    const { report } = await sync(channel, [{ json: { data: [templateEntry()] } }]);

    expect(report).toMatchObject({ created: 0, updated: 1 });
    await expect(
      testPrisma().messageTemplate.count({ where: { workspaceId: tenant.workspaceId } }),
    ).resolves.toBe(1);
  });

  it('template alterado na Meta é atualizado localmente', async () => {
    const tenant = await seedTenant('sync3');
    const channel = await seedChannel(tenant.workspaceId);

    await sync(channel, [{ json: { data: [templateEntry()] } }]);
    await sync(channel, [
      {
        json: {
          data: [
            templateEntry({
              status: 'REJECTED',
              components: [{ type: 'BODY', text: 'Corpo novo sem variáveis' }],
            }),
          ],
        },
      },
    ]);

    const stored = await testPrisma().messageTemplate.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    expect(stored.status).toBe(TemplateStatus.REJECTED);
    expect(stored.body).toBe('Corpo novo sem variáveis');
    expect(stored.variableCount).toBe(0);
  });

  it('status desconhecido vira UNKNOWN e preserva o valor bruto', async () => {
    const tenant = await seedTenant('sync4');
    const channel = await seedChannel(tenant.workspaceId);

    await sync(channel, [{ json: { data: [templateEntry({ status: 'ESTADO_INEDITO' })] } }]);

    const stored = await testPrisma().messageTemplate.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    expect(stored.status).toBe(TemplateStatus.UNKNOWN);
    expect(stored.providerStatus).toBe('ESTADO_INEDITO');
  });

  it('paginação traz todas as páginas', async () => {
    const tenant = await seedTenant('sync5');
    const channel = await seedChannel(tenant.workspaceId);

    const { report, calls } = await sync(channel, [
      {
        json: {
          data: [templateEntry({ id: 'a', name: 'um' })],
          paging: { next: 'https://x', cursors: { after: 'C1' } },
        },
      },
      { json: { data: [templateEntry({ id: 'b', name: 'dois' })] } },
    ]);

    expect(report.fetched).toBe(2);
    expect(report.created).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it('template que sumiu da Meta vira UNAVAILABLE, sem apagar o histórico', async () => {
    const tenant = await seedTenant('sync6');
    const channel = await seedChannel(tenant.workspaceId);

    await sync(channel, [
      { json: { data: [templateEntry({ id: 'a', name: 'fica' }), templateEntry({ id: 'b', name: 'some' })] } },
    ]);

    const { report } = await sync(channel, [
      { json: { data: [templateEntry({ id: 'a', name: 'fica' })] } },
    ]);

    expect(report.markedUnavailable).toBe(1);

    const gone = await testPrisma().messageTemplate.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId, name: 'some' },
    });
    expect(gone.availability).toBe(TemplateAvailability.UNAVAILABLE);
    expect(gone.unavailableSince).not.toBeNull();
    // Não foi apagado: o registro continua lá.
    await expect(
      testPrisma().messageTemplate.count({ where: { workspaceId: tenant.workspaceId } }),
    ).resolves.toBe(2);
  });

  it('template que reaparece volta a AVAILABLE', async () => {
    const tenant = await seedTenant('sync7');
    const channel = await seedChannel(tenant.workspaceId);

    await sync(channel, [{ json: { data: [templateEntry({ id: 'a' })] } }]);
    await sync(channel, [{ json: { data: [] } }]);
    const { report } = await sync(channel, [{ json: { data: [templateEntry({ id: 'a' })] } }]);

    expect(report.restored).toBe(1);
    const stored = await testPrisma().messageTemplate.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    expect(stored.availability).toBe(TemplateAvailability.AVAILABLE);
    expect(stored.unavailableSince).toBeNull();
  });

  it('sincronização de um workspace não toca os templates do outro', async () => {
    const alpha = await seedTenant('iso-a');
    const beta = await seedTenant('iso-b');
    const channelAlpha = await seedChannel(alpha.workspaceId);
    const channelBeta = await seedChannel(beta.workspaceId);

    await sync(channelAlpha, [{ json: { data: [templateEntry({ id: 'a', name: 'de_alpha' })] } }]);
    await sync(channelBeta, [{ json: { data: [templateEntry({ id: 'b', name: 'de_beta' })] } }]);

    // Alpha sincroniza de novo com uma lista vazia: só os dele são afetados.
    await sync(channelAlpha, [{ json: { data: [] } }]);

    const betaTemplate = await testPrisma().messageTemplate.findFirstOrThrow({
      where: { workspaceId: beta.workspaceId },
    });
    expect(betaTemplate.availability).toBe(TemplateAvailability.AVAILABLE);
    expect(betaTemplate.name).toBe('de_beta');
  });

  it('o mesmo providerTemplateId em workspaces diferentes coexiste', async () => {
    const alpha = await seedTenant('dup-a');
    const beta = await seedTenant('dup-b');

    await sync(await seedChannel(alpha.workspaceId), [
      { json: { data: [templateEntry({ id: 'compartilhado' })] } },
    ]);
    await sync(await seedChannel(beta.workspaceId), [
      { json: { data: [templateEntry({ id: 'compartilhado' })] } },
    ]);

    await expect(
      testPrisma().messageTemplate.count({ where: { providerTemplateId: 'compartilhado' } }),
    ).resolves.toBe(2);
  });

  it('erro do provedor propaga sem apagar o que já existia', async () => {
    const tenant = await seedTenant('sync8');
    const channel = await seedChannel(tenant.workspaceId);

    await sync(channel, [{ json: { data: [templateEntry()] } }]);
    await expect(
      sync(channel, [{ status: 500, json: { error: { message: 'indisponível' } } }]),
    ).rejects.toThrow();

    const stored = await testPrisma().messageTemplate.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    expect(stored.availability).toBe(TemplateAvailability.AVAILABLE);
  });
});
