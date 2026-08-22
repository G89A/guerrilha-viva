import 'server-only';
import { JobStatus } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { newWorkerId, runWorkerTick } from '@/features/queue/worker';
import type { ProcessOptions } from '@/features/campaigns/send-worker';

/**
 * Drenagem manual da fila.
 *
 * POR QUE ISSO EXISTE: em hospedagem serverless (Vercel) não existe processo
 * longo, e o cron do plano gratuito roda uma vez por dia — o que é o mesmo que
 * não existir para uma campanha. Sem worker, a campanha fica "em execução" e
 * nada sai, que é a forma mais cruel de um produto parecer quebrado.
 *
 * Aqui quem dá o ciclo é a pessoa, clicando. Não é um worker disfarçado: só
 * anda enquanto alguém está olhando, e a tela diz isso com todas as letras.
 *
 * NÃO é um caminho paralelo de envio. Chama exatamente o mesmo `runWorkerTick`
 * do worker de fundo, com as mesmas garantias: reserva com `FOR UPDATE SKIP
 * LOCKED`, idempotência, recheque de elegibilidade, guardrails e limite de
 * taxa. Rodar isto junto de um worker de fundo não duplica envio; só divide o
 * trabalho.
 */

/** Orçamento por clique. Fica abaixo do teto de função da Vercel com folga. */
export const DRAIN_BUDGET_MS = 8_000;

/** Lote pequeno: melhor devolver progresso cedo do que segurar a resposta. */
export const DRAIN_BATCH_SIZE = 10;

export interface DrainResult {
  ticks: number;
  sent: number;
  skipped: number;
  rateLimited: number;
  failed: number;
  dead: number;
  webhooks: number;
  /** Jobs deste workspace ainda esperando a vez. */
  pending: number;
  /** `true` quando parou por limite de taxa, não por falta de trabalho. */
  throttled: boolean;
  durationMs: number;
}

/** Conta o que ainda espera — inclui a retentativa já agendada para depois. */
export async function pendingJobCount(workspaceId: string): Promise<number> {
  return prisma.job.count({
    where: {
      workspaceId,
      status: { in: [JobStatus.PENDING, JobStatus.FAILED, JobStatus.LEASED] },
    },
  });
}

export async function drainWorkspaceQueue(options: {
  workspaceId: string;
  budgetMs?: number;
  batchSize?: number;
  /** Costura de teste: injeta o transporte. Em produção fica ausente. */
  processOptions?: ProcessOptions;
}): Promise<DrainResult> {
  const startedAt = Date.now();
  const budgetMs = options.budgetMs ?? DRAIN_BUDGET_MS;
  const batchSize = options.batchSize ?? DRAIN_BATCH_SIZE;
  const workerId = newWorkerId();

  const result: DrainResult = {
    ticks: 0,
    sent: 0,
    skipped: 0,
    rateLimited: 0,
    failed: 0,
    dead: 0,
    webhooks: 0,
    pending: 0,
    throttled: false,
    durationMs: 0,
  };

  while (Date.now() - startedAt < budgetMs) {
    const tick = await runWorkerTick({
      workerId,
      workspaceId: options.workspaceId,
      batchSize,
      ...(options.processOptions ? { processOptions: options.processOptions } : {}),
    });

    result.ticks += 1;
    result.sent += tick.sent;
    result.skipped += tick.skipped;
    result.rateLimited += tick.rateLimited;
    result.failed += tick.failed;
    result.dead += tick.dead;
    result.webhooks += tick.webhooks;

    // Nada reservado: a fila acabou, ou o que resta está agendado para depois.
    if (tick.leased === 0) break;

    // Limite de taxa atingido: insistir só queima orçamento e devolve os mesmos
    // jobs adiados. Parar aqui é honesto — a tela avisa que falta esperar.
    if (tick.rateLimited > 0 && tick.sent === 0) {
      result.throttled = true;
      break;
    }
  }

  result.pending = await pendingJobCount(options.workspaceId);
  result.durationMs = Date.now() - startedAt;
  return result;
}
