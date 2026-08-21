import 'server-only';
import type { Job, Prisma } from '@prisma/client';
import { JobStatus, type JobType, Prisma as PrismaNS } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging/logger';
import { nextRunAt } from '@/features/queue/backoff';

/**
 * Fila de trabalho em PostgreSQL.
 *
 * O leasing usa `FOR UPDATE SKIP LOCKED`: cada worker tranca as linhas que
 * pegou e os outros PULAM essas linhas em vez de esperar. É o que permite N
 * workers drenarem a mesma fila sem coordenação externa e sem nunca processarem
 * o mesmo job duas vezes.
 *
 * A reserva tem PRAZO. Um worker que morre no meio não trava o job para sempre:
 * passado `leasedUntil`, outro worker o reclama.
 */

/** Quanto tempo um worker segura um job antes de a reserva expirar. */
export const LEASE_DURATION_MS = 60_000;

export interface EnqueueInput {
  workspaceId: string;
  type: JobType;
  payload: Prisma.InputJsonValue;
  /** Chave determinística: enfileirar a mesma intenção duas vezes não duplica. */
  idempotencyKey: string;
  runAt?: Date;
  priority?: number;
  maxAttempts?: number;
}

export interface EnqueueResult {
  job: Job;
  /** `false` quando o job já existia. */
  created: boolean;
}

export async function enqueueJob(input: EnqueueInput): Promise<EnqueueResult> {
  // `createMany` com skipDuplicates emite ON CONFLICT DO NOTHING: não estoura a
  // unique nem aborta transação, e o count diz se a linha nasceu agora.
  const inserted = await prisma.job.createMany({
    skipDuplicates: true,
    data: [
      {
        workspaceId: input.workspaceId,
        type: input.type,
        payload: input.payload,
        idempotencyKey: input.idempotencyKey,
        ...(input.runAt ? { runAt: input.runAt } : {}),
        ...(input.priority === undefined ? {} : { priority: input.priority }),
        ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
      },
    ],
  });

  const job = await prisma.job.findUniqueOrThrow({
    where: { idempotencyKey: input.idempotencyKey },
  });

  return { job, created: inserted.count > 0 };
}

/** Enfileira em lote. Devolve quantos jobs realmente nasceram. */
export async function enqueueMany(inputs: EnqueueInput[]): Promise<number> {
  if (inputs.length === 0) return 0;

  const result = await prisma.job.createMany({
    skipDuplicates: true,
    data: inputs.map((input) => ({
      workspaceId: input.workspaceId,
      type: input.type,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      ...(input.runAt ? { runAt: input.runAt } : {}),
      ...(input.priority === undefined ? {} : { priority: input.priority }),
      ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
    })),
  });

  return result.count;
}

/**
 * Reserva até `limit` jobs prontos para execução.
 *
 * A subconsulta com `FOR UPDATE SKIP LOCKED` é o coração da concorrência: dois
 * workers rodando ao mesmo tempo nunca recebem o mesmo job. Um pega as linhas,
 * o outro pula para as seguintes em vez de bloquear.
 *
 * Também recupera jobs cuja reserva expirou — worker que caiu não deixa
 * trabalho órfão.
 */
export async function leaseJobs(input: {
  workerId: string;
  limit: number;
  type?: JobType;
  workspaceId?: string;
  now?: Date;
  leaseDurationMs?: number;
}): Promise<Job[]> {
  const now = input.now ?? new Date();
  const leasedUntil = new Date(now.getTime() + (input.leaseDurationMs ?? LEASE_DURATION_MS));

  // Elegível: PENDING/FAILED cujo runAt chegou, ou LEASED com reserva vencida.
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(PrismaNS.sql`
    UPDATE jobs
       SET status = ${JobStatus.LEASED}::"JobStatus",
           leased_by = ${input.workerId},
           leased_until = ${leasedUntil},
           updated_at = ${now}
     WHERE id IN (
       SELECT id FROM jobs
        WHERE (
                (status IN (${JobStatus.PENDING}::"JobStatus", ${JobStatus.FAILED}::"JobStatus")
                 AND run_at <= ${now})
             OR (status = ${JobStatus.LEASED}::"JobStatus" AND leased_until < ${now})
              )
          ${input.type ? PrismaNS.sql`AND type = ${input.type}::"JobType"` : PrismaNS.empty}
          ${input.workspaceId ? PrismaNS.sql`AND workspace_id = ${input.workspaceId}` : PrismaNS.empty}
        ORDER BY priority DESC, run_at ASC
        LIMIT ${input.limit}
        FOR UPDATE SKIP LOCKED
     )
    RETURNING id
  `);

  if (rows.length === 0) return [];

  return prisma.job.findMany({
    where: { id: { in: rows.map((row) => row.id) } },
    orderBy: [{ priority: 'desc' }, { runAt: 'asc' }],
  });
}

export async function completeJob(jobId: string): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.DONE,
      completedAt: new Date(),
      leasedBy: null,
      leasedUntil: null,
      lastError: null,
      lastErrorCode: null,
    },
  });
}

export interface FailJobInput {
  jobId: string;
  error: string;
  errorCode?: string | null;
  /** Falha não retentável vai direto para a dead-letter. */
  retryable: boolean;
  now?: Date;
}

export interface FailJobResult {
  status: JobStatus;
  attempts: number;
  nextRunAt: Date | null;
}

/**
 * Registra a falha e decide o destino do job.
 *
 * Não retentável — credencial inválida, payload recusado — morre na primeira:
 * repetir não conserta e só gasta cota. Retentável volta com backoff, até
 * esgotar as tentativas e cair na dead-letter.
 */
export async function failJob(input: FailJobInput): Promise<FailJobResult> {
  const now = input.now ?? new Date();

  const job = await prisma.job.findUniqueOrThrow({ where: { id: input.jobId } });
  const attempts = job.attempts + 1;
  const exhausted = attempts >= job.maxAttempts;
  const dead = !input.retryable || exhausted;

  const scheduled = dead ? null : nextRunAt(attempts, now);

  await prisma.job.update({
    where: { id: input.jobId },
    data: {
      status: dead ? JobStatus.DEAD : JobStatus.FAILED,
      attempts,
      lastError: input.error.slice(0, 1000),
      lastErrorCode: input.errorCode ?? null,
      leasedBy: null,
      leasedUntil: null,
      ...(scheduled ? { runAt: scheduled } : {}),
      ...(dead ? { completedAt: now } : {}),
    },
  });

  if (dead) {
    logger.warn('queue.job_dead', {
      jobId: input.jobId,
      workspaceId: job.workspaceId,
      type: job.type,
      attempts,
      reason: input.retryable ? 'tentativas esgotadas' : 'falha não retentável',
      errorCode: input.errorCode ?? null,
    });
  }

  return {
    status: dead ? JobStatus.DEAD : JobStatus.FAILED,
    attempts,
    nextRunAt: scheduled,
  };
}

/** Cancela jobs pendentes de um alvo — usado ao pausar ou cancelar campanha. */
export async function cancelPendingJobs(
  workspaceId: string,
  idempotencyPrefix: string,
): Promise<number> {
  const result = await prisma.job.updateMany({
    where: {
      workspaceId,
      idempotencyKey: { startsWith: idempotencyPrefix },
      status: { in: [JobStatus.PENDING, JobStatus.FAILED] },
    },
    data: { status: JobStatus.DEAD, completedAt: new Date(), lastError: 'Cancelado pelo operador.' },
  });
  return result.count;
}

/**
 * Remove jobs ainda não concluídos de um alvo.
 *
 * Usado ao pausar: diferente de `cancelPendingJobs`, libera a chave de
 * idempotência, então retomar consegue recriar o trabalho. Só toca no que ainda
 * não terminou — DONE e DEAD ficam como registro.
 */
export async function deletePendingJobs(
  workspaceId: string,
  idempotencyPrefix: string,
): Promise<number> {
  const result = await prisma.job.deleteMany({
    where: {
      workspaceId,
      idempotencyKey: { startsWith: idempotencyPrefix },
      status: { in: [JobStatus.PENDING, JobStatus.FAILED, JobStatus.LEASED] },
    },
  });
  return result.count;
}

export interface QueueDepth {
  pending: number;
  leased: number;
  done: number;
  failed: number;
  dead: number;
}

export async function queueDepth(
  workspaceId: string,
  idempotencyPrefix?: string,
): Promise<QueueDepth> {
  const grouped = await prisma.job.groupBy({
    by: ['status'],
    where: {
      workspaceId,
      ...(idempotencyPrefix ? { idempotencyKey: { startsWith: idempotencyPrefix } } : {}),
    },
    _count: { _all: true },
  });

  const depth: QueueDepth = { pending: 0, leased: 0, done: 0, failed: 0, dead: 0 };
  const field: Record<JobStatus, keyof QueueDepth> = {
    [JobStatus.PENDING]: 'pending',
    [JobStatus.LEASED]: 'leased',
    [JobStatus.DONE]: 'done',
    [JobStatus.FAILED]: 'failed',
    [JobStatus.DEAD]: 'dead',
  };

  for (const row of grouped) depth[field[row.status]] = row._count._all;
  return depth;
}
