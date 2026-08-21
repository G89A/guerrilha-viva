import 'server-only';
import { randomUUID } from 'node:crypto';
import { JobType } from '@prisma/client';
import { logger } from '@/lib/logging/logger';
import {
  completeJob,
  failJob,
  leaseJobs,
  LEASE_DURATION_MS,
} from '@/features/queue/job-store';
import { processSendJob, type ProcessOptions } from '@/features/campaigns/send-worker';
import { reconcileCampaignMetrics } from '@/features/campaigns/metrics';
import { prisma } from '@/lib/db/client';
import { CampaignStatus, RecipientStatus } from '@prisma/client';

/**
 * Ciclo do worker.
 *
 * Um "tick" reserva um lote, processa cada job e devolve o que aconteceu. É
 * chamado por dois caminhos:
 *   - `scripts/worker.ts`, processo longo para deploy próprio;
 *   - `POST /api/internal/worker/tick`, para cron em ambiente serverless.
 *
 * Ambos usam a MESMA função, então o comportamento não diverge entre deploys.
 */

export interface TickOptions {
  workerId?: string;
  batchSize?: number;
  workspaceId?: string;
  now?: Date;
  processOptions?: ProcessOptions;
}

export interface TickResult {
  leased: number;
  sent: number;
  skipped: number;
  rateLimited: number;
  failed: number;
  dead: number;
  durationMs: number;
}

export const DEFAULT_BATCH_SIZE = 25;

export function newWorkerId(): string {
  return `worker-${randomUUID().slice(0, 8)}`;
}

export async function runWorkerTick(options: TickOptions = {}): Promise<TickResult> {
  const startedAt = Date.now();
  const workerId = options.workerId ?? newWorkerId();
  const now = options.now ?? new Date();

  const jobs = await leaseJobs({
    workerId,
    limit: options.batchSize ?? DEFAULT_BATCH_SIZE,
    type: JobType.CAMPAIGN_SEND,
    ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
    now,
    leaseDurationMs: LEASE_DURATION_MS,
  });

  const result: TickResult = {
    leased: jobs.length,
    sent: 0,
    skipped: 0,
    rateLimited: 0,
    failed: 0,
    dead: 0,
    durationMs: 0,
  };

  const touchedCampaigns = new Set<string>();

  for (const job of jobs) {
    try {
      const outcome = await processSendJob(job, options.processOptions ?? {});

      if (outcome.result === 'SENT') {
        await completeJob(job.id);
        result.sent += 1;
      } else if (outcome.result === 'SKIPPED') {
        if (outcome.permanent) {
          // Pulado não é falha: o job cumpriu seu papel ao decidir não enviar.
          await completeJob(job.id);
        } else {
          // Motivo temporário (campanha pausada): remove o job sem queimar a
          // chave de idempotência, para que retomar consiga recriá-lo.
          await prisma.job.delete({ where: { id: job.id } });
        }
        result.skipped += 1;
      } else if (outcome.result === 'RATE_LIMITED') {
        // Reagenda sem gastar tentativa — falta de vazão não é erro do job.
        await prisma.job.update({
          where: { id: job.id },
          data: {
            status: 'PENDING',
            runAt: new Date(now.getTime() + Math.max(250, outcome.retryAfterMs)),
            leasedBy: null,
            leasedUntil: null,
          },
        });
        result.rateLimited += 1;
      } else {
        const failure = await failJob({
          jobId: job.id,
          error: outcome.error,
          errorCode: outcome.errorCode,
          retryable: outcome.retryable,
          now,
        });
        if (failure.status === 'DEAD') result.dead += 1;
        else result.failed += 1;
      }
    } catch (error) {
      // Falha inesperada no próprio worker: registra e devolve o job.
      const message = error instanceof Error ? error.message : 'Falha inesperada no worker.';
      const failure = await failJob({
        jobId: job.id,
        error: message,
        errorCode: 'WORKER_ERROR',
        retryable: true,
        now,
      });
      if (failure.status === 'DEAD') result.dead += 1;
      else result.failed += 1;

      logger.error('queue.worker_error', { jobId: job.id, workspaceId: job.workspaceId, error });
    }

    const campaignId = (job.payload as { campaignId?: string })?.campaignId;
    if (campaignId) touchedCampaigns.add(`${job.workspaceId}:${campaignId}`);
  }

  // Reconcilia as métricas das campanhas tocadas e fecha as que acabaram.
  for (const entry of touchedCampaigns) {
    const [workspaceId, campaignId] = entry.split(':') as [string, string];
    await reconcileCampaignMetrics(workspaceId, campaignId);
    await completeCampaignIfDrained(workspaceId, campaignId);
  }

  result.durationMs = Date.now() - startedAt;

  if (jobs.length > 0) {
    logger.info('queue.tick', { workerId, ...result });
  }

  return result;
}

/**
 * Fecha a campanha quando não sobrou destinatário para processar.
 *
 * Compare-and-set: só transiciona a partir de RUNNING, então uma campanha
 * pausada no meio não é fechada por engano.
 */
export async function completeCampaignIfDrained(
  workspaceId: string,
  campaignId: string,
): Promise<boolean> {
  const remaining = await prisma.campaignRecipient.count({
    where: {
      campaignId,
      workspaceId,
      status: {
        in: [RecipientStatus.ELIGIBLE, RecipientStatus.QUEUED, RecipientStatus.SENDING],
      },
    },
  });

  if (remaining > 0) return false;

  const result = await prisma.campaign.updateMany({
    where: { id: campaignId, workspaceId, status: CampaignStatus.RUNNING },
    data: { status: CampaignStatus.COMPLETED, completedAt: new Date() },
  });

  if (result.count > 0) {
    logger.info('campaign.completed', { workspaceId, campaignId });
  }

  return result.count > 0;
}

/**
 * Drena a fila até esvaziar ou bater o teto de ciclos.
 *
 * O teto existe para que um erro de programação não vire laço infinito. Usado
 * pelo processo standalone e pelos testes.
 */
export async function drainQueue(
  options: TickOptions & { maxTicks?: number } = {},
): Promise<TickResult> {
  const maxTicks = options.maxTicks ?? 100;
  const total: TickResult = {
    leased: 0, sent: 0, skipped: 0, rateLimited: 0, failed: 0, dead: 0, durationMs: 0,
  };
  const startedAt = Date.now();

  for (let tick = 0; tick < maxTicks; tick += 1) {
    const result = await runWorkerTick(options);
    total.leased += result.leased;
    total.sent += result.sent;
    total.skipped += result.skipped;
    total.rateLimited += result.rateLimited;
    total.failed += result.failed;
    total.dead += result.dead;

    // Só sobraram jobs esperando vazão: insistir agora não adianta.
    if (result.leased === 0) break;
    if (result.leased === result.rateLimited) break;
  }

  total.durationMs = Date.now() - startedAt;
  return total;
}
