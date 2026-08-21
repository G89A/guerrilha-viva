/**
 * Worker de envio em processo contínuo.
 *
 * Uso: `npm run worker`. Drena a fila em ciclos, dorme quando não há trabalho e
 * encerra de forma limpa em SIGINT/SIGTERM — um job reservado por um worker que
 * morre volta a ficar disponível quando a reserva expira, mas encerrar direito
 * evita essa espera.
 *
 * Em serverless, use o endpoint de cron `POST /api/internal/worker/tick`, que
 * chama exatamente o mesmo ciclo.
 */
import { config } from 'dotenv';
import { newWorkerId, runWorkerTick } from '../src/features/queue/worker';
import { logger } from '../src/lib/logging/logger';

config({ path: '.env', quiet: true });

const IDLE_SLEEP_MS = 2_000;
const BUSY_SLEEP_MS = 100;

let running = true;

function stop(signal: string): void {
  logger.info('worker.stopping', { signal });
  running = false;
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

async function main(): Promise<void> {
  const workerId = newWorkerId();
  logger.info('worker.started', { workerId });

  while (running) {
    try {
      const result = await runWorkerTick({ workerId });
      // Sem trabalho: dorme mais para não martelar o banco à toa.
      await sleep(result.leased === 0 ? IDLE_SLEEP_MS : BUSY_SLEEP_MS);
    } catch (error) {
      logger.error('worker.tick_failed', { workerId, error });
      await sleep(IDLE_SLEEP_MS);
    }
  }

  logger.info('worker.stopped', { workerId });
  process.exit(0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main();
