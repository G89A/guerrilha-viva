import { beforeEach, describe, expect, it } from 'vitest';
import { JobStatus, RecipientStatus } from '@prisma/client';
import { prepareCampaign, startCampaign } from '@/features/campaigns/campaign-service';
import { drainQueue, runWorkerTick } from '@/features/queue/worker';
import { consumeToken, channelBucketKey } from '@/features/queue/rate-limiter';
import { resetDatabase, testPrisma } from '../helpers/db';
import {
  seedCampaign,
  seedChannel,
  seedEligibleContact,
  seedTemplate,
  seedTenant,
} from '../helpers/factories';
import { SEND_SUCCESS_RESPONSE } from '../helpers/fake-graph';

/**
 * A garantia central da Sprint 5: por mais workers que rodem em paralelo,
 * NENHUM destinatário recebe duas mensagens.
 */

/** Transporte que conta chamadas e devolve um wamid distinto para cada uma. */
function countingGraph() {
  let counter = 0;
  const calls: string[] = [];

  const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
    counter += 1;
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
    calls.push(String(body.to ?? 'sem-destino'));
    void url;

    return new Response(
      JSON.stringify({
        ...SEND_SUCCESS_RESPONSE,
        messages: [{ id: `wamid.CONC_${counter}` }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  return { fetchImpl, calls, get count() { return counter; } };
}

async function runningCampaign(label: string, contacts: number) {
  const tenant = await seedTenant(label);
  const channel = await seedChannel(tenant.workspaceId, {
    messagesPerSecond: 1000,
    sendBurst: 1000,
  } as never);
  const template = await seedTemplate(tenant.workspaceId, channel.id);

  for (let index = 0; index < contacts; index += 1) {
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

  return { tenant, channel, campaign };
}

describe('workers concorrentes', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it.each([2, 6, 10])(
    '%i workers simultâneos não enviam nada em duplicado',
    async (workers) => {
      const contacts = 20;
      const context = await runningCampaign(`conc-${workers}`, contacts);
      const graph = countingGraph();

      await Promise.all(
        Array.from({ length: workers }, (_value, index) =>
          drainQueue({
            workerId: `w${index}`,
            batchSize: 5,
            processOptions: { providerOverrides: { fetchImpl: graph.fetchImpl } },
          }),
        ),
      );

      // Exatamente uma chamada por contato.
      expect(graph.count).toBe(contacts);
      expect(new Set(graph.calls).size).toBe(contacts);

      const messages = await testPrisma().message.findMany({
        where: { campaignId: context.campaign.id },
        select: { contactId: true },
      });
      expect(messages).toHaveLength(contacts);
      // Nenhum contato aparece duas vezes.
      expect(new Set(messages.map((message) => message.contactId)).size).toBe(contacts);

      const recipients = await testPrisma().campaignRecipient.findMany({
        where: { campaignId: context.campaign.id },
      });
      expect(recipients.every((recipient) => recipient.status === RecipientStatus.SENT)).toBe(true);
    },
    120_000,
  );

  it('50 ticks simultâneos numa campanha pequena não duplicam', async () => {
    const context = await runningCampaign('conc-50', 8);
    const graph = countingGraph();

    await Promise.all(
      Array.from({ length: 50 }, (_value, index) =>
        runWorkerTick({
          workerId: `w${index}`,
          batchSize: 8,
          processOptions: { providerOverrides: { fetchImpl: graph.fetchImpl } },
        }),
      ),
    );

    expect(graph.count).toBeLessThanOrEqual(8);
    await expect(
      testPrisma().message.count({ where: { campaignId: context.campaign.id } }),
    ).resolves.toBeLessThanOrEqual(8);
  }, 120_000);

  it('nenhum job fica preso em LEASED depois da drenagem', async () => {
    const context = await runningCampaign('conc-leased', 10);
    const graph = countingGraph();

    await Promise.all(
      Array.from({ length: 4 }, (_value, index) =>
        drainQueue({
          workerId: `w${index}`,
          processOptions: { providerOverrides: { fetchImpl: graph.fetchImpl } },
        }),
      ),
    );

    const leased = await testPrisma().job.count({
      where: { workspaceId: context.tenant.workspaceId, status: JobStatus.LEASED },
    });
    expect(leased).toBe(0);
  }, 120_000);
});

describe('vazão sob concorrência', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('o teto é respeitado mesmo com pedidos simultâneos', async () => {
    const tenant = await seedTenant('rate-conc');
    const key = channelBucketKey('canal-teste');
    const now = new Date();

    // Balde com exatamente 5 tokens e recarga desprezível na janela do teste.
    const pedidos = await Promise.all(
      Array.from({ length: 20 }, () =>
        consumeToken({
          key,
          workspaceId: tenant.workspaceId,
          ratePerSecond: 0.001,
          burst: 5,
          now,
        }),
      ),
    );

    const permitidos = pedidos.filter((outcome) => outcome.allowed).length;
    // Nunca mais que o burst: o débito é atômico no banco.
    expect(permitidos).toBeLessThanOrEqual(5);
    expect(permitidos).toBeGreaterThan(0);
  });

  it('recusa informa quanto esperar', async () => {
    const tenant = await seedTenant('rate-wait');
    const key = channelBucketKey('canal-espera');
    const now = new Date();

    await consumeToken({ key, workspaceId: tenant.workspaceId, ratePerSecond: 1, burst: 1, now });
    const negado = await consumeToken({
      key, workspaceId: tenant.workspaceId, ratePerSecond: 1, burst: 1, now,
    });

    expect(negado.allowed).toBe(false);
    if (negado.allowed) return;
    expect(negado.retryAfterMs).toBeGreaterThan(0);
  });

  it('o balde recarrega com o tempo', async () => {
    const tenant = await seedTenant('rate-refill');
    const key = channelBucketKey('canal-recarga');
    const start = new Date();

    await consumeToken({ key, workspaceId: tenant.workspaceId, ratePerSecond: 10, burst: 1, now: start });
    await expect(
      consumeToken({ key, workspaceId: tenant.workspaceId, ratePerSecond: 10, burst: 1, now: start }),
    ).resolves.toMatchObject({ allowed: false });

    // Meio segundo depois, com 10 tokens/s, há saldo de novo.
    const later = new Date(start.getTime() + 500);
    await expect(
      consumeToken({ key, workspaceId: tenant.workspaceId, ratePerSecond: 10, burst: 1, now: later }),
    ).resolves.toMatchObject({ allowed: true });
  });

  it('baldes de canais diferentes não interferem', async () => {
    const tenant = await seedTenant('rate-iso');
    const now = new Date();

    await consumeToken({
      key: channelBucketKey('canal-a'), workspaceId: tenant.workspaceId,
      ratePerSecond: 0.001, burst: 1, now,
    });

    // O canal B tem o próprio saldo.
    await expect(
      consumeToken({
        key: channelBucketKey('canal-b'), workspaceId: tenant.workspaceId,
        ratePerSecond: 0.001, burst: 1, now,
      }),
    ).resolves.toMatchObject({ allowed: true });
  });

  it('vazão baixa segura o envio sem perder trabalho', async () => {
    const tenant = await seedTenant('rate-worker');
    const channel = await seedChannel(tenant.workspaceId, {
      // Dois tokens e recarga lenta: só dois saem no primeiro ciclo.
      messagesPerSecond: 0.01,
      sendBurst: 2,
    } as never);
    const template = await seedTemplate(tenant.workspaceId, channel.id);
    for (let index = 0; index < 6; index += 1) {
      await seedEligibleContact(tenant.workspaceId, `+5585933${String(300000 + index)}`);
    }
    const campaign = await seedCampaign(tenant.workspaceId, {
      channelId: channel.id,
      templateId: template.id,
    });
    await prepareCampaign({
      workspaceId: tenant.workspaceId,
      campaignId: campaign.id,
      actorUserId: tenant.userId,
    });
    await startCampaign({ workspaceId: tenant.workspaceId, campaignId: campaign.id });

    const graph = countingGraph();
    const result = await runWorkerTick({
      processOptions: { providerOverrides: { fetchImpl: graph.fetchImpl } },
    });

    expect(graph.count).toBeLessThanOrEqual(2);
    expect(result.rateLimited).toBeGreaterThan(0);

    // Quem não saiu continua na fila, não foi perdido nem marcado como falha.
    const jobs = await testPrisma().job.findMany({
      where: { workspaceId: tenant.workspaceId },
    });
    const aguardando = jobs.filter((job) => job.status === JobStatus.PENDING);
    expect(aguardando.length).toBeGreaterThan(0);
    expect(jobs.every((job) => job.attempts === 0)).toBe(true);
  }, 60_000);
});
