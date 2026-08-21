import { beforeEach, describe, expect, it } from 'vitest';
import { JobStatus, JobType } from '@prisma/client';
import {
  cancelPendingJobs,
  completeJob,
  enqueueJob,
  enqueueMany,
  failJob,
  leaseJobs,
  queueDepth,
} from '@/features/queue/job-store';
import { resetDatabase, testPrisma } from '../helpers/db';
import { seedTenant } from '../helpers/factories';

async function seedJobs(workspaceId: string, count: number, prefix = 'job') {
  return enqueueMany(
    Array.from({ length: count }, (_value, index) => ({
      workspaceId,
      type: JobType.CAMPAIGN_SEND,
      payload: { campaignId: 'c1', recipientId: `r${index}` },
      idempotencyKey: `${prefix}:${index}`,
    })),
  );
}

describe('enfileiramento', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('cria o job e devolve created', async () => {
    const tenant = await seedTenant('q-enq');
    const result = await enqueueJob({
      workspaceId: tenant.workspaceId,
      type: JobType.CAMPAIGN_SEND,
      payload: { campaignId: 'c1', recipientId: 'r1' },
      idempotencyKey: 'chave-1',
    });

    expect(result.created).toBe(true);
    expect(result.job.status).toBe(JobStatus.PENDING);
    expect(result.job.attempts).toBe(0);
  });

  it('a mesma chave não cria dois jobs', async () => {
    const tenant = await seedTenant('q-idem');
    const input = {
      workspaceId: tenant.workspaceId,
      type: JobType.CAMPAIGN_SEND,
      payload: { campaignId: 'c1', recipientId: 'r1' },
      idempotencyKey: 'chave-repetida',
    };

    const first = await enqueueJob(input);
    const second = await enqueueJob(input);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    await expect(testPrisma().job.count()).resolves.toBe(1);
  });

  it('enfileiramento concorrente da mesma chave cria um job só', async () => {
    const tenant = await seedTenant('q-race');
    const input = {
      workspaceId: tenant.workspaceId,
      type: JobType.CAMPAIGN_SEND,
      payload: { campaignId: 'c1', recipientId: 'r1' },
      idempotencyKey: 'chave-corrida',
    };

    await Promise.all(Array.from({ length: 10 }, () => enqueueJob(input)));
    await expect(testPrisma().job.count()).resolves.toBe(1);
  });

  it('enqueueMany ignora duplicatas e conta só os novos', async () => {
    const tenant = await seedTenant('q-many');
    await expect(seedJobs(tenant.workspaceId, 5)).resolves.toBe(5);
    // Reenfileirar o mesmo lote não cria nada.
    await expect(seedJobs(tenant.workspaceId, 5)).resolves.toBe(0);
    await expect(testPrisma().job.count()).resolves.toBe(5);
  });
});

describe('leasing com SKIP LOCKED', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('reserva jobs e marca quem os pegou', async () => {
    const tenant = await seedTenant('q-lease');
    await seedJobs(tenant.workspaceId, 3);

    const leased = await leaseJobs({ workerId: 'w1', limit: 10 });

    expect(leased).toHaveLength(3);
    expect(leased.every((job) => job.status === JobStatus.LEASED)).toBe(true);
    expect(leased.every((job) => job.leasedBy === 'w1')).toBe(true);
    expect(leased.every((job) => job.leasedUntil !== null)).toBe(true);
  });

  it('respeita o limite do lote', async () => {
    const tenant = await seedTenant('q-limit');
    await seedJobs(tenant.workspaceId, 10);

    await expect(leaseJobs({ workerId: 'w1', limit: 4 })).resolves.toHaveLength(4);
  });

  it('DOIS WORKERS NUNCA PEGAM O MESMO JOB', async () => {
    const tenant = await seedTenant('q-two');
    await seedJobs(tenant.workspaceId, 20);

    const [a, b] = await Promise.all([
      leaseJobs({ workerId: 'w1', limit: 20 }),
      leaseJobs({ workerId: 'w2', limit: 20 }),
    ]);

    const ids = [...a.map((job) => job.id), ...b.map((job) => job.id)];
    // Nenhuma sobreposição, e nenhum job perdido.
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(20);
  });

  it('dez workers simultâneos dividem a fila sem sobreposição', async () => {
    const tenant = await seedTenant('q-ten');
    await seedJobs(tenant.workspaceId, 50);

    const lotes = await Promise.all(
      Array.from({ length: 10 }, (_value, index) =>
        leaseJobs({ workerId: `w${index}`, limit: 10 }),
      ),
    );

    const ids = lotes.flat().map((job) => job.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(50);
  });

  it('job já reservado não é pego de novo enquanto a reserva vale', async () => {
    const tenant = await seedTenant('q-held');
    await seedJobs(tenant.workspaceId, 2);

    await leaseJobs({ workerId: 'w1', limit: 2 });
    await expect(leaseJobs({ workerId: 'w2', limit: 2 })).resolves.toHaveLength(0);
  });

  it('reserva expirada é reclamada — worker morto não trava a fila', async () => {
    const tenant = await seedTenant('q-expired');
    await seedJobs(tenant.workspaceId, 2);

    // Worker pega e "morre".
    await leaseJobs({ workerId: 'morto', limit: 2, leaseDurationMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 30));

    const reclaimed = await leaseJobs({ workerId: 'vivo', limit: 2 });
    expect(reclaimed).toHaveLength(2);
    expect(reclaimed.every((job) => job.leasedBy === 'vivo')).toBe(true);
  });

  it('job agendado para o futuro não é reservado antes da hora', async () => {
    const tenant = await seedTenant('q-future');
    await enqueueJob({
      workspaceId: tenant.workspaceId,
      type: JobType.CAMPAIGN_SEND,
      payload: {},
      idempotencyKey: 'futuro',
      runAt: new Date(Date.now() + 60_000),
    });

    await expect(leaseJobs({ workerId: 'w1', limit: 5 })).resolves.toHaveLength(0);

    // Já na hora, é pego.
    const later = await leaseJobs({
      workerId: 'w1',
      limit: 5,
      now: new Date(Date.now() + 61_000),
    });
    expect(later).toHaveLength(1);
  });

  it('não atravessa workspaces quando filtrado', async () => {
    const alpha = await seedTenant('q-a');
    const beta = await seedTenant('q-b');
    await seedJobs(alpha.workspaceId, 3, 'alpha');
    await seedJobs(beta.workspaceId, 3, 'beta');

    const leased = await leaseJobs({ workerId: 'w1', limit: 10, workspaceId: alpha.workspaceId });
    expect(leased).toHaveLength(3);
    expect(leased.every((job) => job.workspaceId === alpha.workspaceId)).toBe(true);
  });

  it('prioridade maior é atendida primeiro', async () => {
    const tenant = await seedTenant('q-prio');
    await enqueueJob({
      workspaceId: tenant.workspaceId, type: JobType.CAMPAIGN_SEND,
      payload: {}, idempotencyKey: 'baixa', priority: 0,
    });
    await enqueueJob({
      workspaceId: tenant.workspaceId, type: JobType.CAMPAIGN_SEND,
      payload: {}, idempotencyKey: 'alta', priority: 10,
    });

    const [first] = await leaseJobs({ workerId: 'w1', limit: 1 });
    expect(first?.idempotencyKey).toBe('alta');
  });
});

describe('conclusão e falha', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function oneJob(label: string) {
    const tenant = await seedTenant(label);
    const { job } = await enqueueJob({
      workspaceId: tenant.workspaceId,
      type: JobType.CAMPAIGN_SEND,
      payload: {},
      idempotencyKey: `${label}-job`,
    });
    return { tenant, job };
  }

  it('completeJob marca DONE e solta a reserva', async () => {
    const { job } = await oneJob('q-done');
    await leaseJobs({ workerId: 'w1', limit: 1 });
    await completeJob(job.id);

    const stored = await testPrisma().job.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.status).toBe(JobStatus.DONE);
    expect(stored.leasedBy).toBeNull();
    expect(stored.completedAt).not.toBeNull();
  });

  it('falha retentável reagenda com backoff e conta a tentativa', async () => {
    const { job } = await oneJob('q-retry');
    const now = new Date();

    const result = await failJob({
      jobId: job.id, error: 'timeout', errorCode: 'TIMEOUT', retryable: true, now,
    });

    expect(result.status).toBe(JobStatus.FAILED);
    expect(result.attempts).toBe(1);
    expect(result.nextRunAt).not.toBeNull();

    const stored = await testPrisma().job.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.runAt.getTime()).toBeGreaterThanOrEqual(now.getTime());
    expect(stored.lastErrorCode).toBe('TIMEOUT');
    expect(stored.leasedBy).toBeNull();
  });

  it('falha NÃO retentável morre na primeira, sem gastar tentativas', async () => {
    const { job } = await oneJob('q-fatal');

    const result = await failJob({
      jobId: job.id,
      error: 'credencial inválida',
      errorCode: 'AUTHENTICATION',
      retryable: false,
    });

    expect(result.status).toBe(JobStatus.DEAD);
    expect(result.attempts).toBe(1);
    expect(result.nextRunAt).toBeNull();
  });

  it('esgotar as tentativas leva à dead-letter', async () => {
    const tenant = await seedTenant('q-dead');
    const { job } = await enqueueJob({
      workspaceId: tenant.workspaceId,
      type: JobType.CAMPAIGN_SEND,
      payload: {},
      idempotencyKey: 'dead-job',
      maxAttempts: 3,
    });

    const statuses = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      statuses.push(
        (await failJob({ jobId: job.id, error: 'falhou', retryable: true })).status,
      );
    }

    expect(statuses).toEqual([JobStatus.FAILED, JobStatus.FAILED, JobStatus.DEAD]);

    const stored = await testPrisma().job.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.attempts).toBe(3);
    // Morto não volta a ser reservado.
    await expect(
      leaseJobs({ workerId: 'w1', limit: 5, now: new Date(Date.now() + 3_600_000) }),
    ).resolves.toHaveLength(0);
  });

  it('job FAILED volta a ser reservado quando chega a hora', async () => {
    const { job } = await oneJob('q-back');
    await failJob({ jobId: job.id, error: 'temporário', retryable: true });

    const later = await leaseJobs({
      workerId: 'w1',
      limit: 5,
      now: new Date(Date.now() + 3_600_000),
    });
    expect(later.map((entry) => entry.id)).toContain(job.id);
  });
});

describe('cancelamento e profundidade', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('cancela pendentes por prefixo sem tocar nos concluídos', async () => {
    const tenant = await seedTenant('q-cancel');
    await seedJobs(tenant.workspaceId, 4, 'campanha-x');
    await seedJobs(tenant.workspaceId, 2, 'campanha-y');

    const jobs = await testPrisma().job.findMany({
      where: { idempotencyKey: { startsWith: 'campanha-x' } },
      take: 1,
    });
    await completeJob(jobs[0]!.id);

    const cancelled = await cancelPendingJobs(tenant.workspaceId, 'campanha-x');
    expect(cancelled).toBe(3);

    const depth = await queueDepth(tenant.workspaceId, 'campanha-x');
    expect(depth).toMatchObject({ pending: 0, dead: 3, done: 1 });

    // A outra campanha não foi tocada.
    await expect(queueDepth(tenant.workspaceId, 'campanha-y')).resolves.toMatchObject({
      pending: 2,
    });
  });

  it('profundidade conta por status', async () => {
    const tenant = await seedTenant('q-depth');
    await seedJobs(tenant.workspaceId, 5);
    await leaseJobs({ workerId: 'w1', limit: 2 });

    const depth = await queueDepth(tenant.workspaceId);
    expect(depth.pending).toBe(3);
    expect(depth.leased).toBe(2);
  });
});
