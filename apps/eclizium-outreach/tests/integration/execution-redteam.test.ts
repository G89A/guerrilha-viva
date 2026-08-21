import { beforeEach, describe, expect, it } from 'vitest';
import { CampaignStatus, JobStatus, JobType, RecipientStatus } from '@prisma/client';
import { prepareCampaign, startCampaign } from '@/features/campaigns/campaign-service';
import { queueExecutionService, sendJobKey } from '@/features/campaigns/execution-service';
import { enqueueJob, leaseJobs } from '@/features/queue/job-store';
import { drainQueue, runWorkerTick } from '@/features/queue/worker';
import { processSendJob, parseSendPayload } from '@/features/campaigns/send-worker';
import { consumeToken, channelBucketKey } from '@/features/queue/rate-limiter';
import { resetDatabase, testPrisma } from '../helpers/db';
import {
  seedCampaign,
  seedChannel,
  seedEligibleContact,
  seedTemplate,
  seedTenant,
} from '../helpers/factories';
import { fakeGraph, SEND_SUCCESS_RESPONSE } from '../helpers/fake-graph';

/** Red team da execução. Cada teste descreve o ataque e o comportamento certo. */

function graph(count = 50) {
  return fakeGraph(
    Array.from({ length: count }, (_value, index) => ({
      json: { ...SEND_SUCCESS_RESPONSE, messages: [{ id: `wamid.RT_${index}` }] },
    })),
  );
}

async function runningCampaign(label: string, contacts = 3) {
  const tenant = await seedTenant(label);
  const channel = await seedChannel(tenant.workspaceId, {
    messagesPerSecond: 1000,
    sendBurst: 1000,
  } as never);
  const template = await seedTemplate(tenant.workspaceId, channel.id);
  for (let index = 0; index < contacts; index += 1) {
    await seedEligibleContact(tenant.workspaceId, `+5585922${String(200000 + index)}`);
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

describe('red team — payload de job hostil', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it.each([
    ['vazio', {}],
    ['sem recipientId', { campaignId: 'c1' }],
    ['tipos errados', { campaignId: 1, recipientId: [] }],
    ['null', null],
    ['string', 'nao-e-objeto'],
  ])('rejeita payload %s sem quebrar', (_label, payload) => {
    expect(parseSendPayload(payload)).toBeNull();
  });

  it('payload inválido mata o job na primeira, sem retry', async () => {
    const tenant = await seedTenant('rt-payload');
    await enqueueJob({
      workspaceId: tenant.workspaceId,
      type: JobType.CAMPAIGN_SEND,
      payload: { lixo: true },
      idempotencyKey: 'lixo-1',
    });

    await runWorkerTick({});

    const job = await testPrisma().job.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    expect(job.status).toBe(JobStatus.DEAD);
    expect(job.attempts).toBe(1);
  });

  it('job apontando para destinatário de outro workspace não envia nada', async () => {
    const alvo = await runningCampaign('rt-cross-a', 2);
    const atacante = await seedTenant('rt-cross-b');

    const recipient = await testPrisma().campaignRecipient.findFirstOrThrow({
      where: { campaignId: alvo.campaign.id },
    });

    // Job forjado no workspace do atacante apontando para dado alheio.
    const { job } = await enqueueJob({
      workspaceId: atacante.workspaceId,
      type: JobType.CAMPAIGN_SEND,
      payload: { campaignId: alvo.campaign.id, recipientId: recipient.id },
      idempotencyKey: 'forjado-1',
    });

    const transporte = graph();
    const outcome = await processSendJob(job, {
      providerOverrides: { fetchImpl: transporte.fetchImpl },
    });

    expect(outcome.result).toBe('SKIPPED');
    expect(transporte.calls).toHaveLength(0);
  });
});

describe('red team — nada envia duas vezes', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('reenfileirar durante a execução não gera segundo envio', async () => {
    const context = await runningCampaign('rt-dup', 2);
    const transporte = graph();

    // Reenfileirar ANTES de drenar: as chaves já existem, nada novo entra.
    const reenfileirado = await queueExecutionService.enqueueCampaign(
      context.tenant.workspaceId,
      context.campaign.id,
    );
    expect(reenfileirado.queued).toBe(0);

    await drainQueue({
      processOptions: { providerOverrides: { fetchImpl: transporte.fetchImpl } },
    });

    expect(transporte.calls).toHaveLength(2);
    await expect(
      testPrisma().message.count({ where: { campaignId: context.campaign.id } }),
    ).resolves.toBe(2);
  });

  it('campanha concluída recusa novo enfileiramento', async () => {
    const context = await runningCampaign('rt-dup2', 2);
    const transporte = graph();

    await drainQueue({
      processOptions: { providerOverrides: { fetchImpl: transporte.fetchImpl } },
    });

    // A campanha fecha sozinha ao esvaziar a fila; reenfileirar é recusado.
    await expect(
      queueExecutionService.enqueueCampaign(context.tenant.workspaceId, context.campaign.id),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(transporte.calls).toHaveLength(2);
  });

  it('processar o MESMO job duas vezes não duplica a mensagem', async () => {
    const context = await runningCampaign('rt-samejob', 1);
    const [job] = await leaseJobs({ workerId: 'w1', limit: 1 });
    const transporte = graph();

    await processSendJob(job!, {
      providerOverrides: { fetchImpl: transporte.fetchImpl },
    });
    // Segunda execução do mesmo job: já enviado, deve pular.
    const segunda = await processSendJob(job!, {
      providerOverrides: { fetchImpl: transporte.fetchImpl },
    });

    expect(segunda.result).toBe('SKIPPED');
    expect(transporte.calls).toHaveLength(1);
    await expect(
      testPrisma().message.count({ where: { campaignId: context.campaign.id } }),
    ).resolves.toBe(1);
  });

  it('job duplicado com chave diferente ainda não duplica a mensagem', async () => {
    const context = await runningCampaign('rt-dupkey', 1);
    const recipient = await testPrisma().campaignRecipient.findFirstOrThrow({
      where: { campaignId: context.campaign.id },
    });
    const transporte = graph();

    // Um job legítimo e outro forjado com chave diferente para o mesmo alvo.
    await enqueueJob({
      workspaceId: context.tenant.workspaceId,
      type: JobType.CAMPAIGN_SEND,
      payload: { campaignId: context.campaign.id, recipientId: recipient.id },
      idempotencyKey: `${sendJobKey(context.campaign.id, recipient.id)}:copia`,
    });

    await drainQueue({
      processOptions: { providerOverrides: { fetchImpl: transporte.fetchImpl } },
    });

    // A unique de Message.idempotencyKey é a última barreira.
    await expect(
      testPrisma().message.count({ where: { campaignId: context.campaign.id } }),
    ).resolves.toBe(1);
    expect(transporte.calls.length).toBeLessThanOrEqual(2);
  });
});

describe('red team — campanha ressuscitada', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('job antigo de campanha cancelada não envia', async () => {
    const context = await runningCampaign('rt-zombie', 3);

    await testPrisma().campaign.update({
      where: { id: context.campaign.id },
      data: { status: CampaignStatus.CANCELLED, cancelledAt: new Date() },
    });

    const transporte = graph();
    await drainQueue({
      processOptions: { providerOverrides: { fetchImpl: transporte.fetchImpl } },
    });

    expect(transporte.calls).toHaveLength(0);
  });

  it('campanha concluída não é reaberta pelo worker', async () => {
    const context = await runningCampaign('rt-done', 2);
    const transporte = graph();
    await drainQueue({
      processOptions: { providerOverrides: { fetchImpl: transporte.fetchImpl } },
    });

    const campaign = await testPrisma().campaign.findUniqueOrThrow({
      where: { id: context.campaign.id },
    });
    expect(campaign.status).toBe(CampaignStatus.COMPLETED);

    // Novo ciclo não muda nada.
    await runWorkerTick({
      processOptions: { providerOverrides: { fetchImpl: transporte.fetchImpl } },
    });
    const depois = await testPrisma().campaign.findUniqueOrThrow({
      where: { id: context.campaign.id },
    });
    expect(depois.status).toBe(CampaignStatus.COMPLETED);
  });
});

describe('red team — vazão', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('taxa zero ou negativa não trava nem libera tudo', async () => {
    const tenant = await seedTenant('rt-rate-zero');
    const outcome = await consumeToken({
      key: channelBucketKey('c-zero'),
      workspaceId: tenant.workspaceId,
      ratePerSecond: 0,
      burst: 1,
    });
    expect(typeof outcome.allowed).toBe('boolean');
  });

  it('burst menor que o custo não deixa o pedido impossível travar o balde', async () => {
    const tenant = await seedTenant('rt-rate-burst');
    const outcome = await consumeToken({
      key: channelBucketKey('c-burst'),
      workspaceId: tenant.workspaceId,
      ratePerSecond: 1,
      burst: 0,
      cost: 5,
    });
    expect(outcome.allowed).toBe(true);
  });

  it('o balde de um workspace não afeta o de outro', async () => {
    const alpha = await seedTenant('rt-rate-a');
    const beta = await seedTenant('rt-rate-b');
    const now = new Date();

    await consumeToken({
      key: channelBucketKey('canal-alpha'), workspaceId: alpha.workspaceId,
      ratePerSecond: 0.001, burst: 1, now,
    });

    await expect(
      consumeToken({
        key: channelBucketKey('canal-beta'), workspaceId: beta.workspaceId,
        ratePerSecond: 0.001, burst: 1, now,
      }),
    ).resolves.toMatchObject({ allowed: true });
  });
});

describe('red team — worker resiliente', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('destinatário apagado no meio não derruba o ciclo', async () => {
    const context = await runningCampaign('rt-deleted', 3);
    await testPrisma().campaignRecipient.deleteMany({
      where: { campaignId: context.campaign.id },
    });

    const transporte = graph();
    const result = await runWorkerTick({
      processOptions: { providerOverrides: { fetchImpl: transporte.fetchImpl } },
    });

    expect(result.skipped).toBe(3);
    expect(transporte.calls).toHaveLength(0);
  });

  it('canal removido no meio não derruba o ciclo', async () => {
    const context = await runningCampaign('rt-nochannel', 2);
    await testPrisma().campaign.update({
      where: { id: context.campaign.id },
      data: { channelId: null },
    });

    const transporte = graph();
    const result = await runWorkerTick({
      processOptions: { providerOverrides: { fetchImpl: transporte.fetchImpl } },
    });

    expect(result.skipped).toBe(2);
    expect(transporte.calls).toHaveLength(0);
  });

  it('fila vazia é um ciclo sem efeito', async () => {
    await seedTenant('rt-empty');
    const result = await runWorkerTick({});
    expect(result).toMatchObject({ leased: 0, sent: 0, failed: 0 });
  });

  it('destinatário já enviado não é reenviado nem que o job volte', async () => {
    const context = await runningCampaign('rt-resent', 1);
    const recipient = await testPrisma().campaignRecipient.findFirstOrThrow({
      where: { campaignId: context.campaign.id },
    });
    await testPrisma().campaignRecipient.update({
      where: { id: recipient.id },
      data: { status: RecipientStatus.SENT, sentAt: new Date() },
    });

    const transporte = graph();
    await drainQueue({
      processOptions: { providerOverrides: { fetchImpl: transporte.fetchImpl } },
    });

    expect(transporte.calls).toHaveLength(0);
  });
});
