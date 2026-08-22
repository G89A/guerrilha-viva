/**
 * Ponto de partida do servidor Next.
 *
 * Serve para uma coisa só: permitir que o worker de envio rode DENTRO do
 * processo da aplicação, em deploys de instância única.
 *
 * POR QUE ISSO EXISTE: enfileirar não é enviar. Sem worker, a campanha fica
 * "em execução" e nada sai — e quem não tem como subir um segundo processo
 * conclui, com razão, que o produto está quebrado.
 *
 * É OPT-IN e nunca liga sozinho. Em serverless (Vercel) não deve ser usado:
 * lá não existe processo longo, e o caminho certo é o cron chamando
 * `POST /api/internal/worker/tick`.
 *
 * Rodar vários workers ao mesmo tempo é seguro — a reserva de job usa
 * `FOR UPDATE SKIP LOCKED` e há teste com dez workers simultâneos. Então ligar
 * isto junto de um worker separado não duplica envio; só divide o trabalho.
 */

import {
  shouldRunInProcessWorker,
  WORKER_BUSY_SLEEP_MS,
  WORKER_IDLE_SLEEP_MS,
} from '@/lib/config/worker';

export async function register(): Promise<void> {
  // `nodejs` exclui o runtime edge, onde não há processo longo nem Prisma.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (!shouldRunInProcessWorker()) return;

  const { newWorkerId, runWorkerTick } = await import('@/features/queue/worker');
  const { logger } = await import('@/lib/logging/logger');

  const workerId = newWorkerId();
  logger.info('worker.in_process_started', { workerId });

  let running = true;
  const stop = (signal: string): void => {
    running = false;
    logger.info('worker.in_process_stopping', { workerId, signal });
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  void (async () => {
    while (running) {
      let processed = 0;
      try {
        const result = await runWorkerTick({ workerId });
        processed = result.leased;
      } catch (error) {
        // Um ciclo que falha não pode derrubar o servidor web junto.
        logger.error('worker.in_process_tick_failed', { workerId, error });
      }

      await new Promise((resolve) =>
        setTimeout(resolve, processed > 0 ? WORKER_BUSY_SLEEP_MS : WORKER_IDLE_SLEEP_MS),
      );
    }
  })();
}
