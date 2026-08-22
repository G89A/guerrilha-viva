import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { logger } from '@/lib/logging/logger';
import { DEFAULT_BATCH_SIZE, runWorkerTick } from '@/features/queue/worker';

/**
 * Disparo do worker por cron, para ambientes sem processo longo (Vercel).
 *
 * Protegido por segredo compartilhado: este endpoint envia mensagens de verdade,
 * então não pode ficar aberto. Sem segredo configurado ele RECUSA — não existe
 * modo "sem autenticação".
 *
 * ACEITA GET E POST. O agendador da Vercel chama por GET; aceitar só POST fazia
 * o cron declarado em `vercel.json` responder 405 para sempre, ou seja, uma
 * funcionalidade que existia no papel e nunca rodou.
 *
 * O segredo pode vir de `WORKER_TOKEN` (nosso) ou de `CRON_SECRET` (o nome que
 * a Vercel usa no header que ela mesma envia). Qualquer um dos dois serve, e a
 * comparação é em tempo constante nos dois casos.
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

/** Segredos aceitos, na ordem de preferência. Ausente e curto demais não conta. */
function acceptedSecrets(): string[] {
  return [process.env.WORKER_TOKEN, process.env.CRON_SECRET].filter(
    (value): value is string => typeof value === 'string' && value.length >= 16,
  );
}

async function handleTick(request: NextRequest): Promise<NextResponse> {
  const expected = acceptedSecrets();
  if (expected.length === 0) {
    logger.warn('worker.tick_not_configured', {});
    return NextResponse.json(
      { error: 'worker_not_configured' },
      { status: 503, headers: NO_STORE },
    );
  }

  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';

  // `some` sobre a lista inteira: sair no primeiro acerto abriria um canal de
  // tempo entre "primeiro segredo errado" e "segundo segredo errado".
  const authorized =
    provided.length > 0 &&
    expected.map((secret) => tokenMatches(provided, secret)).some(Boolean);

  if (!authorized) {
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

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleTick(request);
}

/** O agendador da Vercel chama por GET. Mesma autenticação, mesmo ciclo. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleTick(request);
}
