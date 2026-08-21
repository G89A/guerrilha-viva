import { beforeEach, describe, expect, it } from 'vitest';
import { JobStatus, JobType, WebhookEventStatus } from '@prisma/client';
import { ingestEvent, processStoredEvent, requeueEvent, webhookJobKey } from '@/features/webhooks/processor';
import { parseWebhookPayload } from '@/features/webhooks/parser';
import { drainQueue, runWorkerTick } from '@/features/queue/worker';
import { resetDatabase, testPrisma } from '../helpers/db';
import { seedChannel, seedTenant } from '../helpers/factories';
import { PHONE_NUMBER_ID, statusPayload, textMessagePayload } from '../helpers/webhook-fixtures';

function eventsOf(payload: unknown) {
  const parsed = parseWebhookPayload(JSON.stringify(payload));
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.events;
}

async function ingest(payload: unknown) {
  const results = [];
  for (const event of eventsOf(payload)) {
    results.push(await ingestEvent(event, { signatureValid: true }));
  }
  return results;
}

async function tenantWithChannel(label: string) {
  const tenant = await seedTenant(label);
  const channel = await seedChannel(tenant.workspaceId, { phoneNumberId: PHONE_NUMBER_ID });
  return { tenant, channel };
}

describe('recepção enfileira, não processa', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('a rota persiste e enfileira sem aplicar efeito', async () => {
    const { tenant } = await tenantWithChannel('wq-1');
    const [outcome] = await ingest(textMessagePayload({ wamid: 'wamid.Q1', body: 'oi' }));

    expect(outcome?.result).toBe('QUEUED');

    // Nada aplicado ainda: sem contato, sem conversa, sem mensagem.
    await expect(testPrisma().message.count()).resolves.toBe(0);
    await expect(testPrisma().contact.count()).resolves.toBe(0);

    const job = await testPrisma().job.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId, type: JobType.WEBHOOK_EVENT },
    });
    expect(job.status).toBe(JobStatus.PENDING);
    expect(job.idempotencyKey).toBe(webhookJobKey(outcome?.eventId ?? ''));
  });

  it('o job de webhook tem prioridade acima do disparo de campanha', async () => {
    const { tenant } = await tenantWithChannel('wq-prio');
    await ingest(textMessagePayload({ wamid: 'wamid.Q2', body: 'oi' }));

    const job = await testPrisma().job.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId, type: JobType.WEBHOOK_EVENT },
    });
    expect(job.priority).toBeGreaterThan(0);
  });

  it('o worker aplica o efeito e conclui o job', async () => {
    const { tenant } = await tenantWithChannel('wq-2');
    await ingest(textMessagePayload({ wamid: 'wamid.Q3', body: 'bom dia' }));

    const tick = await drainQueue({ workerId: 'w-1' });
    expect(tick.webhooks).toBe(1);

    const message = await testPrisma().message.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    expect(message.body).toBe('bom dia');

    const event = await testPrisma().webhookEvent.findFirstOrThrow({});
    expect(event.status).toBe(WebhookEventStatus.PROCESSED);

    // Concluído fica como DONE (histórico curto), não some na hora.
    const done = await testPrisma().job.findFirstOrThrow({});
    expect(done.status).toBe(JobStatus.DONE);
  });

  it('entrega repetida não cria segundo job nem segundo efeito', async () => {
    await tenantWithChannel('wq-3');
    const payload = textMessagePayload({ wamid: 'wamid.Q4', body: 'repetida' });

    const first = await ingest(payload);
    const second = await ingest(payload);

    expect(first[0]?.result).toBe('QUEUED');
    expect(second[0]?.result).toBe('DUPLICATE');
    await expect(
      testPrisma().job.count({ where: { type: JobType.WEBHOOK_EVENT } }),
    ).resolves.toBe(1);

    await drainQueue({ workerId: 'w-2' });
    await expect(testPrisma().message.count()).resolves.toBe(1);
  });

  it('número desconhecido é ignorado sem enfileirar nada', async () => {
    await seedTenant('wq-4');
    const [outcome] = await ingest(
      textMessagePayload({ wamid: 'wamid.Q5', body: 'oi', phoneNumberId: '999999999999999' }),
    );

    expect(outcome?.result).toBe('IGNORED');
    await expect(testPrisma().job.count()).resolves.toBe(0);

    const event = await testPrisma().webhookEvent.findFirstOrThrow({});
    expect(event.status).toBe(WebhookEventStatus.IGNORED);
  });
});

describe('estados terminais e reprocessamento', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('evento já aplicado não é reaplicado por um job reentregue', async () => {
    const { tenant } = await tenantWithChannel('wq-5');
    const [outcome] = await ingest(textMessagePayload({ wamid: 'wamid.Q6', body: 'uma vez' }));
    await drainQueue({ workerId: 'w-3' });

    const again = await processStoredEvent(outcome?.eventId ?? '');
    expect(again.result).toBe('DUPLICATE');

    await expect(
      testPrisma().message.count({ where: { workspaceId: tenant.workspaceId } }),
    ).resolves.toBe(1);
  });

  it('evento com falha pode ser reenfileirado', async () => {
    const { tenant } = await tenantWithChannel('wq-6');
    const [outcome] = await ingest(textMessagePayload({ wamid: 'wamid.Q7', body: 'falhou' }));
    const eventId = outcome?.eventId ?? '';

    // Simula o estado depois de esgotar as tentativas: evento FAILED, job morto
    // e apagado.
    await testPrisma().job.deleteMany({});
    await testPrisma().webhookEvent.update({
      where: { id: eventId },
      data: { status: WebhookEventStatus.FAILED, errorMessage: 'falha antiga' },
    });

    const requeued = await requeueEvent(tenant.workspaceId, eventId);
    expect(requeued.requeued).toBe(true);

    await drainQueue({ workerId: 'w-4' });
    const event = await testPrisma().webhookEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(event.status).toBe(WebhookEventStatus.PROCESSED);
    await expect(testPrisma().message.count()).resolves.toBe(1);
  });

  it('reenfileirar evento já concluído é recusado com motivo', async () => {
    const { tenant } = await tenantWithChannel('wq-7');
    const [outcome] = await ingest(textMessagePayload({ wamid: 'wamid.Q8', body: 'pronto' }));
    await drainQueue({ workerId: 'w-5' });

    const result = await requeueEvent(tenant.workspaceId, outcome?.eventId ?? '');
    expect(result.requeued).toBe(false);
    expect(result.reason).toMatch(/concluído/i);
  });

  it('reenfileirar evento de OUTRO workspace não encontra nada', async () => {
    await tenantWithChannel('wq-8');
    const [outcome] = await ingest(textMessagePayload({ wamid: 'wamid.Q9', body: 'alheio' }));
    const outsider = await seedTenant('wq-8-out');

    const result = await requeueEvent(outsider.workspaceId, outcome?.eventId ?? '');
    expect(result.requeued).toBe(false);
    expect(result.reason).toMatch(/não encontrado/i);
  });

  it('payload irreconstruível é ignorado, não retentado para sempre', async () => {
    const { tenant } = await tenantWithChannel('wq-9');
    const [outcome] = await ingest(textMessagePayload({ wamid: 'wamid.Q10', body: 'x' }));
    const eventId = outcome?.eventId ?? '';

    await testPrisma().webhookEvent.update({
      where: { id: eventId },
      data: { payload: { lixo: true } },
    });

    const result = await processStoredEvent(eventId);
    expect(result.result).toBe('IGNORED');

    const event = await testPrisma().webhookEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(event.status).toBe(WebhookEventStatus.IGNORED);
    expect(event.workspaceId).toBe(tenant.workspaceId);
  });

  it('canal movido para outro workspace faz o evento ser ignorado', async () => {
    const { tenant, channel } = await tenantWithChannel('wq-10');
    const [outcome] = await ingest(textMessagePayload({ wamid: 'wamid.Q11', body: 'mudou' }));
    const outsider = await seedTenant('wq-10-out');

    await testPrisma().messagingChannel.update({
      where: { id: channel.id },
      data: { workspaceId: outsider.workspaceId },
    });

    const result = await processStoredEvent(outcome?.eventId ?? '');
    expect(result.result).toBe('IGNORED');
    // Nada foi aplicado em nenhum dos dois tenants.
    await expect(
      testPrisma().message.count({ where: { workspaceId: tenant.workspaceId } }),
    ).resolves.toBe(0);
    await expect(
      testPrisma().message.count({ where: { workspaceId: outsider.workspaceId } }),
    ).resolves.toBe(0);
  });

  it('job de webhook sem eventId morre sem retentar para sempre', async () => {
    const { tenant } = await tenantWithChannel('wq-11');
    await testPrisma().job.create({
      data: {
        workspaceId: tenant.workspaceId,
        type: JobType.WEBHOOK_EVENT,
        payload: {},
        idempotencyKey: 'webhook-event:vazio',
        maxAttempts: 1,
      },
    });

    const tick = await runWorkerTick({ workerId: 'w-6' });
    expect(tick.dead).toBe(1);
  });

  it('evento que não existe mais não derruba o ciclo', async () => {
    const { tenant } = await tenantWithChannel('wq-12');
    await testPrisma().job.create({
      data: {
        workspaceId: tenant.workspaceId,
        type: JobType.WEBHOOK_EVENT,
        payload: { eventId: 'cmxxxxxxxxxxxxxxxxxxxxxx' },
        idempotencyKey: 'webhook-event:sumiu',
      },
    });

    const tick = await runWorkerTick({ workerId: 'w-7' });
    expect(tick.webhooks).toBe(1);
    const job = await testPrisma().job.findFirstOrThrow({});
    expect(job.status).toBe(JobStatus.DONE);
  });
});

describe('concorrência — recepção e processamento simultâneos', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it.each([6, 20, 50])(
    '%i entregas simultâneas da MESMA mensagem geram um efeito só',
    async (times) => {
      await tenantWithChannel(`wq-c${times}`);
      const payload = textMessagePayload({ wamid: 'wamid.CONC', body: 'simultânea' });
      const [event] = eventsOf(payload);
      if (!event) throw new Error('sem evento');

      const results = await Promise.all(
        Array.from({ length: times }, () => ingestEvent(event, { signatureValid: true })),
      );

      // Exatamente uma recepção vence; as demais são duplicatas.
      expect(results.filter((result) => result.result === 'QUEUED')).toHaveLength(1);
      await expect(testPrisma().webhookEvent.count()).resolves.toBe(1);
      await expect(testPrisma().job.count()).resolves.toBe(1);

      await drainQueue({ workerId: 'w-conc' });
      await expect(testPrisma().message.count()).resolves.toBe(1);
      await expect(testPrisma().conversation.count()).resolves.toBe(1);
    },
    60_000,
  );

  it.each([6, 20])(
    '%i mensagens distintas do MESMO contato novo criam um contato só',
    async (times) => {
      await tenantWithChannel(`wq-n${times}`);

      await Promise.all(
        Array.from({ length: times }, (_value, index) =>
          ingest(textMessagePayload({ wamid: `wamid.N${index}`, body: `msg ${index}` })),
        ),
      );

      await drainQueue({ workerId: 'w-novo' });

      await expect(testPrisma().contact.count()).resolves.toBe(1);
      await expect(testPrisma().conversation.count()).resolves.toBe(1);
      await expect(testPrisma().message.count()).resolves.toBe(times);
    },
    60_000,
  );

  it('10 workers disputando os mesmos eventos não duplicam efeito', async () => {
    await tenantWithChannel('wq-w10');

    for (let index = 0; index < 12; index += 1) {
      await ingest(textMessagePayload({ wamid: `wamid.W${index}`, body: `m${index}` }));
    }

    await Promise.all(
      Array.from({ length: 10 }, (_value, index) =>
        drainQueue({ workerId: `worker-${index}`, batchSize: 3 }),
      ),
    );

    await expect(testPrisma().message.count()).resolves.toBe(12);
    await expect(
      testPrisma().job.count({ where: { status: { not: JobStatus.DONE } } }),
    ).resolves.toBe(0);
  }, 60_000);

  it('processar o MESMO evento em paralelo aplica o efeito uma vez', async () => {
    await tenantWithChannel('wq-same');
    const [outcome] = await ingest(textMessagePayload({ wamid: 'wamid.SAME', body: 'única' }));
    const eventId = outcome?.eventId ?? '';

    const results = await Promise.all(
      Array.from({ length: 6 }, () => processStoredEvent(eventId)),
    );

    expect(results.filter((result) => result.result === 'PROCESSED')).toHaveLength(1);
    await expect(testPrisma().message.count()).resolves.toBe(1);
  });

  it('status e mensagem da mesma entrega não se atrapalham', async () => {
    const { tenant, channel } = await tenantWithChannel('wq-mix');
    await ingest(textMessagePayload({ wamid: 'wamid.MIX', body: 'entrada' }));
    await drainQueue({ workerId: 'w-mix' });

    const contact = await testPrisma().contact.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    await testPrisma().message.create({
      data: {
        workspaceId: tenant.workspaceId,
        channelId: channel.id,
        contactId: contact.id,
        direction: 'OUTBOUND',
        status: 'SENT',
        providerMessageId: 'wamid.OUT',
        body: 'saída',
      },
    });

    await Promise.all([
      ingest(statusPayload({ wamid: 'wamid.OUT', status: 'delivered' })),
      ingest(statusPayload({ wamid: 'wamid.OUT', status: 'read' })),
    ]);
    await drainQueue({ workerId: 'w-mix2' });

    const outbound = await testPrisma().message.findFirstOrThrow({
      where: { providerMessageId: 'wamid.OUT' },
    });
    expect(outbound.status).toBe('READ');
  });
});
