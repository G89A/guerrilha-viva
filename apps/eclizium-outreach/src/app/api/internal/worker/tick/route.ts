import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { logger } from '@/lib/logging/logger';
import { DEFAULT_BATCH_SIZE, runWorkerTick } from '@/features/queue/worker';

/**
 * Disparo do worker por cron, para ambientes sem processo longo (Vercel).
 *
 * Protegido por segredo compartilhado: este endpoint envia mensagens de verdade,
 * então não pode ficar aberto. Sem `WORKER_TOKEN` configurado ele RECUSA — não
 * existe modo "sem autenticação".
 *
 * Em deploy próprio, prefira `npm run worker`, que roda o mesmo ciclo em
 * processo contínuo.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store' } as const;

/** Comparação em tempo constante: evita vazar o segredo pelo tempo de resposta. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const expected = process.env.WORKER_TOKEN;
  if (!expected || expected.length < 16) {
    logger.warn('worker.tick_not_configured', {});
    return NextResponse.json(
      { error: 'worker_not_configured' },
      { status: 503, headers: NO_STORE },
    );
  }

  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!provided || !tokenMatches(provided, expected)) {
    logger.warn('worker.tick_rejected', {});
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }

  const batchParam = Number(request.nextUrl.searchParams.get('batch'));
  const batchSize =
    Number.isFinite(batchParam) && batchParam > 0
      ? Math.min(200, Math.floor(batchParam))
      : DEFAULT_BATCH_SIZE;

  const result = await runWorkerTick({ batchSize });
  return NextResponse.json(result, { status: 200, headers: NO_STORE });
}
