import { beforeEach, describe, expect, it } from 'vitest';
import {
  CampaignStatus,
  ConsentStatus,
  ContactStatus,
  JobStatus,
  MessageStatus,
  RecipientStatus,
} from '@prisma/client';
import {
  cancelCampaign,
  pauseCampaign,
  prepareCampaign,
  resumeCampaign,
  startCampaign,
} from '@/features/campaigns/campaign-service';
import { campaignQueueStatus } from '@/features/campaigns/execution-service';
import { drainQueue, runWorkerTick } from '@/features/queue/worker';
import { resetDatabase, testPrisma } from '../helpers/db';
import {
  seedCampaign,
  seedChannel,
  seedEligibleContact,
  seedTemplate,
  seedTenant,
} from '../helpers/factories';
import { fakeGraph, metaError, SEND_SUCCESS_RESPONSE, type FakeResponse } from '../helpers/fake-graph';

/**
 * Execução ponta a ponta: preparar → iniciar → worker → mensagem gravada.
 * Zero chamadas reais à Meta — o transporte é injetado.
 */

/** Responde sucesso com um wamid distinto a cada chamada. */
function successGraph(count: number) {
  return fakeGraph(
    Array.from({ length: Math.max(1, count) }, (_value, index) => ({
      json: {
        ...SEND_SUCCESS_RESPONSE,
        messages: [{ id: `wamid.EXEC_${index}` }],
      },
    })),
  );
}

async function runningCampaign(label: string, contacts = 5, responses?: FakeResponse[]) {
  const tenant = await seedTenant(label);
  const channel = await seedChannel(tenant.workspaceId, {
    // Vazão alta nos testes: aqui interessa a lógica, não o relógio.
    messagesPerSecond: 1000,
    sendBurst: 1000,
  } as never);
  const template = await seedTemplate(tenant.workspaceId, channel.id);

  for (let index = 0; index < contacts; index += 1) {
    await seedEligibleContact(tenant.workspaceId, `+5585955${String(500000 + index)}`);
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
  const started = await startCampaign({
    workspaceId: tenant.workspaceId,
    campaignId: campaign.id,
  });

  const graph = responses ? fakeGraph(responses) : successGraph(contacts + 5);
  return { tenant, channel, template, campaign, started, graph };
}

describe('enfileiramento ao iniciar', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('iniciar cria um job por destinatário elegível', async () => {
    const context = await runningCampaign('exec-enq', 5);

    expect(context.started.queued).toBe(5);
    const depth = await campaignQueueStatus(context.tenant.workspaceId, context.campaign.id);
    expect(depth.pending).toBe(5);

    // Destinatários passam a QUEUED.
    await expect(
      testPrisma().campaignRecipient.count({
        where: { campaignId: context.campaign.id, status: RecipientStatus.QUEUED },
      }),
    ).resolves.toBe(5);
  });

  it('iniciar NÃO envia nada dentro da requisição', async () => {
    const context = await runningCampaign('exec-nosend', 4);

    // Nenhuma mensagem foi criada só por iniciar.
    await expect(
      testPrisma().message.count({ where: { workspaceId: context.tenant.workspaceId } }),
    ).resolves.toBe(0);
  });
});

describe('worker envia', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('drena a fila e grava as mensagens com o wamid do provider', async () => {
    const context = await runningCampaign('exec-drain', 5);

    const result = await drainQueue({
      processOptions: { providerOverrides: { fetchImpl: context.graph.fetchImpl } },
    });

    expect(result.sent).toBe(5);
    expect(context.graph.calls).toHaveLength(5);

    const messages = await testPrisma().message.findMany({
      where: { campaignId: context.campaign.id },
    });
    expect(messages).toHaveLength(5);
    expect(messages.every((message) => message.status === MessageStatus.SENT)).toBe(true);
    expect(messages.every((message) => message.providerMessageId?.startsWith('wamid.'))).toBe(true);

    const recipients = await testPrisma().campaignRecipient.findMany({
      where: { campaignId: context.campaign.id },
    });
    expect(recipients.every((recipient) => recipient.status === RecipientStatus.SENT)).toBe(true);
    expect(recipients.every((recipient) => recipient.sentAt !== null)).toBe(true);
  });

  it('a campanha fecha sozinha quando a fila esvazia', async () => {
    const context = await runningCampaign('exec-complete', 3);

    await drainQueue({
      processOptions: { providerOverrides: { fetchImpl: context.graph.fetchImpl } },
    });

    const campaign = await testPrisma().campaign.findUniqueOrThrow({
      where: { id: context.campaign.id },
    });
    expect(campaign.status).toBe(CampaignStatus.COMPLETED);
    expect(campaign.completedAt).not.toBeNull();
  });

  it('as métricas refletem os envios', async () => {
    const context = await runningCampaign('exec-metrics', 4);
    await drainQueue({
      processOptions: { providerOverrides: { fetchImpl: context.graph.fetchImpl } },
    });

    const campaign = await testPrisma().campaign.findUniqueOrThrow({
      where: { id: context.campaign.id },
    });
    expect(campaign.totalRecipients).toBe(4);
  });

  it('rodar o worker de novo não reenvia nada', async () => {
    const context = await runningCampaign('exec-again', 3);
    await drainQueue({
      processOptions: { providerOverrides: { fetchImpl: context.graph.fetchImpl } },
    });
    const chamadasPrimeira = context.graph.calls.length;

    await drainQueue({
      processOptions: { providerOverrides: { fetchImpl: context.graph.fetchImpl } },
    });

    expect(context.graph.calls).toHaveLength(chamadasPrimeira);
    await expect(
      testPrisma().message.count({ where: { campaignId: context.campaign.id } }),
    ).resolves.toBe(3);
  });
});

describe('reverificação antes do envio', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('CONSENTIMENTO REVOGADO depois de preparar bloqueia o envio', async () => {
    const context = await runningCampaign('exec-revoke', 3);

    // O contato revoga DEPOIS de a campanha já estar enfileirada.
    const alvo = await testPrisma().campaignRecipient.findFirstOrThrow({
      where: { campaignId: context.campaign.id },
    });
    await testPrisma().contactConsent.updateMany({
      where: { contactId: alvo.contactId },
      data: { status: ConsentStatus.REVOKED },
    });

    await drainQueue({
      processOptions: { providerOverrides: { fetchImpl: context.graph.fetchImpl } },
    });

    // Só dois foram enviados; o que revogou não recebeu.
    expect(context.graph.calls).toHaveLength(2);

    const bloqueado = await testPrisma().campaignRecipient.findUniqueOrThrow({
      where: { id: alvo.id },
    });
    expect(bloqueado.status).not.toBe(RecipientStatus.SENT);
    expect(bloqueado.eligibilityReasons).toContain('CONSENT_REVOKED');
  });

  it('OPT-OUT depois de preparar bloqueia o envio', async () => {
    const context = await runningCampaign('exec-optout', 3);

    const alvo = await testPrisma().campaignRecipient.findFirstOrThrow({
      where: { campaignId: context.campaign.id },
      include: { contact: true },
    });
    await testPrisma().suppressionEntry.create({
      data: {
        workspaceId: context.tenant.workspaceId,
        contactId: alvo.contactId,
        phoneE164: alvo.contact.phoneE164,
        reason: 'OPT_OUT',
      },
    });

    await drainQueue({
      processOptions: { providerOverrides: { fetchImpl: context.graph.fetchImpl } },
    });

    expect(context.graph.calls).toHaveLength(2);
    const bloqueado = await testPrisma().campaignRecipient.findUniqueOrThrow({
      where: { id: alvo.id },
    });
    expect(bloqueado.status).toBe(RecipientStatus.SUPPRESSED);
  });

  it('contato ARQUIVADO depois de preparar bloqueia o envio', async () => {
    const context = await runningCampaign('exec-archived', 3);

    const alvo = await testPrisma().campaignRecipient.findFirstOrThrow({
      where: { campaignId: context.campaign.id },
    });
    await testPrisma().contact.update({
      where: { id: alvo.contactId },
      data: { status: ContactStatus.ARCHIVED, archivedAt: new Date() },
    });

    await drainQueue({
      processOptions: { providerOverrides: { fetchImpl: context.graph.fetchImpl } },
    });

    expect(context.graph.calls).toHaveLength(2);
  });

  it('CAMPANHA PAUSADA no meio: o worker para de enviar', async () => {
    const context = await runningCampaign('exec-paused', 6);

    await pauseCampaign({
      workspaceId: context.tenant.workspaceId,
      campaignId: context.campaign.id,
    });

    await drainQueue({
      processOptions: { providerOverrides: { fetchImpl: context.graph.fetchImpl } },
    });

    // Pausar tira os jobs da fila; nada foi enviado.
    expect(context.graph.calls).toHaveLength(0);
    await expect(
      testPrisma().message.count({ where: { campaignId: context.campaign.id } }),
    ).resolves.toBe(0);
  });

  it('campanha CANCELADA no meio não envia mais nada', async () => {
    const context = await runningCampaign('exec-cancel', 5);

    await cancelCampaign({
      workspaceId: context.tenant.workspaceId,
      campaignId: context.campaign.id,
    });
    await drainQueue({
      processOptions: { providerOverrides: { fetchImpl: context.graph.fetchImpl } },
    });

    expect(context.graph.calls).toHaveLength(0);
  });

  it('retomar reenfileira e o envio continua', async () => {
    const context = await runningCampaign('exec-resume', 4);

    await pauseCampaign({
      workspaceId: context.tenant.workspaceId,
      campaignId: context.campaign.id,
    });
    const resumed = await resumeCampaign({
      workspaceId: context.tenant.workspaceId,
      campaignId: context.campaign.id,
    });
    expect(resumed.queued).toBeGreaterThan(0);

    await drainQueue({
      processOptions: { providerOverrides: { fetchImpl: context.graph.fetchImpl } },
    });
    expect(context.graph.calls).toHaveLength(4);
  });
});

describe('falhas do provider', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('falha NÃO retentável mata o job na primeira e marca FAILED', async () => {
    const context = await runningCampaign('exec-fatal', 2, [
      { status: 400, json: metaError('Template does not exist', 132001) },
    ]);

    await drainQueue({
      processOptions: { providerOverrides: { fetchImpl: context.graph.fetchImpl } },
    });

    const jobs = await testPrisma().job.findMany({
      where: { workspaceId: context.tenant.workspaceId },
    });
    expect(jobs.every((job) => job.status === JobStatus.DEAD)).toBe(true);
    expect(jobs.every((job) => job.attempts === 1)).toBe(true);

    const recipients = await testPrisma().campaignRecipient.findMany({
      where: { campaignId: context.campaign.id },
    });
    expect(recipients.every((recipient) => recipient.status === RecipientStatus.FAILED)).toBe(true);
    expect(recipients.every((recipient) => recipient.failureReason !== null)).toBe(true);
  });

  it('falha retentável reagenda em vez de matar', async () => {
    const context = await runningCampaign('exec-retry', 2, [
      { status: 503, json: { error: { message: 'indisponível' } } },
    ]);

    await runWorkerTick({
      processOptions: { providerOverrides: { fetchImpl: context.graph.fetchImpl } },
    });

    const jobs = await testPrisma().job.findMany({
      where: { workspaceId: context.tenant.workspaceId },
    });
    expect(jobs.every((job) => job.status === JobStatus.FAILED)).toBe(true);
    expect(jobs.every((job) => job.attempts === 1)).toBe(true);
    // Reagendado para o futuro.
    expect(jobs.every((job) => job.runAt.getTime() >= Date.now() - 1000)).toBe(true);

    // O destinatário volta a ELIGIBLE: ainda pode sair na próxima tentativa.
    const recipients = await testPrisma().campaignRecipient.findMany({
      where: { campaignId: context.campaign.id },
    });
    expect(recipients.every((recipient) => recipient.status === RecipientStatus.ELIGIBLE)).toBe(
      true,
    );
  });

  it('nenhuma mensagem é gravada quando o envio falha', async () => {
    const context = await runningCampaign('exec-nomsg', 2, [
      { status: 401, json: metaError('Invalid token', 190) },
    ]);

    await drainQueue({
      processOptions: { providerOverrides: { fetchImpl: context.graph.fetchImpl } },
    });

    await expect(
      testPrisma().message.count({ where: { campaignId: context.campaign.id } }),
    ).resolves.toBe(0);
  });
});
