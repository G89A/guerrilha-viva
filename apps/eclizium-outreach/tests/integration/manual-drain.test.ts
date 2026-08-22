import { beforeEach, describe, expect, it } from 'vitest';
import { JobStatus, MessageStatus, RecipientStatus } from '@prisma/client';
import { prepareCampaign, startCampaign } from '@/features/campaigns/campaign-service';
import { drainWorkspaceQueue, pendingJobCount } from '@/features/queue/manual-drain';
import { resetDatabase, testPrisma } from '../helpers/db';
import {
  seedCampaign,
  seedChannel,
  seedEligibleContact,
  seedTemplate,
  seedTenant,
} from '../helpers/factories';
import { fakeGraph, SEND_SUCCESS_RESPONSE } from '../helpers/fake-graph';

/**
 * Drenagem manual: o botão "processar agora", para deploy sem worker de fundo.
 *
 * O que estes testes protegem não é o botão — é a promessa de que ele NÃO é um
 * caminho de envio paralelo. Mesmas garantias do worker: isolamento por
 * workspace, nada duplicado sob concorrência, e a contagem do que falta sendo
 * verdade.
 */

function successGraph(count: number) {
  return fakeGraph(
    Array.from({ length: Math.max(1, count) }, (_value, index) => ({
      json: { ...SEND_SUCCESS_RESPONSE, messages: [{ id: `wamid.DRAIN_${index}` }] },
    })),
  );
}

async function campanhaIniciada(label: string, contatos: number) {
  const tenant = await seedTenant(label);
  const channel = await seedChannel(tenant.workspaceId, {
    messagesPerSecond: 1000,
    sendBurst: 1000,
  } as never);
  const template = await seedTemplate(tenant.workspaceId, channel.id);

  for (let index = 0; index < contatos; index += 1) {
    await seedEligibleContact(tenant.workspaceId, `+5585944${String(400000 + index)}`);
  }

  const campaign = await seedCampaign(tenant.workspaceId, {
    channelId: channel.id,
    templateId: template.id,
    createdById: tenant.userId,
  });

  await prepareCampaign({
    workspaceId: tenant.workspaceId,
    campaignId: campaign.id,
    actorUserId: tenant.userId,
  });
  await startCampaign({ workspaceId: tenant.workspaceId, campaignId: campaign.id });

  return { tenant, channel, template, campaign };
}

describe('drenagem manual da fila', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('esvazia a fila e grava as mensagens que realmente saíram', async () => {
    const ctx = await campanhaIniciada('drain1', 4);
    const graph = successGraph(10);

    const result = await drainWorkspaceQueue({
      workspaceId: ctx.tenant.workspaceId,
      processOptions: { providerOverrides: { fetchImpl: graph.fetchImpl } },
    });

    expect(result.sent).toBe(4);
    expect(result.pending).toBe(0);
    expect(graph.calls).toHaveLength(4);

    await expect(
      testPrisma().message.count({
        where: { workspaceId: ctx.tenant.workspaceId, status: MessageStatus.SENT },
      }),
    ).resolves.toBe(4);

    await expect(
      testPrisma().campaignRecipient.count({
        where: { campaignId: ctx.campaign.id, status: RecipientStatus.SENT },
      }),
    ).resolves.toBe(4);
  });

  it('para sozinha quando não há nada na fila, sem laço infinito', async () => {
    const tenant = await seedTenant('drain2');

    const result = await drainWorkspaceQueue({ workspaceId: tenant.workspaceId });

    expect(result.ticks).toBe(1);
    expect(result.sent).toBe(0);
    expect(result.pending).toBe(0);
    expect(result.durationMs).toBeLessThan(8_000);
  });

  it('NÃO processa job de outro workspace', async () => {
    const alvo = await campanhaIniciada('drain3a', 3);
    const vizinho = await campanhaIniciada('drain3b', 3);
    const graph = successGraph(20);

    const result = await drainWorkspaceQueue({
      workspaceId: alvo.tenant.workspaceId,
      processOptions: { providerOverrides: { fetchImpl: graph.fetchImpl } },
    });

    expect(result.sent).toBe(3);

    // O vizinho continua intocado: nenhuma mensagem, fila cheia.
    await expect(
      testPrisma().message.count({ where: { workspaceId: vizinho.tenant.workspaceId } }),
    ).resolves.toBe(0);
    await expect(pendingJobCount(vizinho.tenant.workspaceId)).resolves.toBe(3);
  });

  it('a contagem do que falta é a do banco, não uma estimativa', async () => {
    const ctx = await campanhaIniciada('drain4', 5);
    await expect(pendingJobCount(ctx.tenant.workspaceId)).resolves.toBe(5);

    const graph = successGraph(20);
    await drainWorkspaceQueue({
      workspaceId: ctx.tenant.workspaceId,
      batchSize: 2,
      processOptions: { providerOverrides: { fetchImpl: graph.fetchImpl } },
    });

    await expect(pendingJobCount(ctx.tenant.workspaceId)).resolves.toBe(0);
    await expect(
      testPrisma().job.count({
        where: { workspaceId: ctx.tenant.workspaceId, status: JobStatus.DONE },
      }),
    ).resolves.toBe(5);
  });

  it('respeita o orçamento de tempo e devolve o que sobrou', async () => {
    const ctx = await campanhaIniciada('drain5', 6);
    const graph = successGraph(20);

    // Orçamento zero: nem um ciclo cabe, e a fila continua inteira.
    const result = await drainWorkspaceQueue({
      workspaceId: ctx.tenant.workspaceId,
      budgetMs: 0,
      processOptions: { providerOverrides: { fetchImpl: graph.fetchImpl } },
    });

    expect(result.ticks).toBe(0);
    expect(result.sent).toBe(0);
    expect(result.pending).toBe(6);
    expect(graph.calls).toHaveLength(0);
  });

  it('6 drenagens simultâneas não enviam nada duas vezes', async () => {
    const ctx = await campanhaIniciada('drain6', 8);
    const graph = successGraph(60);

    const resultados = await Promise.all(
      Array.from({ length: 6 }, () =>
        drainWorkspaceQueue({
          workspaceId: ctx.tenant.workspaceId,
          processOptions: { providerOverrides: { fetchImpl: graph.fetchImpl } },
        }),
      ),
    );

    const enviados = resultados.reduce((total, resultado) => total + resultado.sent, 0);
    expect(enviados).toBe(8);
    expect(graph.calls).toHaveLength(8);

    await expect(
      testPrisma().message.count({ where: { workspaceId: ctx.tenant.workspaceId } }),
    ).resolves.toBe(8);

    // Nenhum job preso em LEASED depois que todas terminaram.
    await expect(
      testPrisma().job.count({
        where: { workspaceId: ctx.tenant.workspaceId, status: JobStatus.LEASED },
      }),
    ).resolves.toBe(0);
  });
});
