import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getMetaEnvState } from '@/lib/env';
import { logger } from '@/lib/logging/logger';

// Prisma requires the Node.js runtime; it does not run on the edge.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Liveness/readiness probe. Reports dependency state without leaking values:
 * the messaging block says configured/not, never which credentials exist.
 */
export async function GET(): Promise<NextResponse> {
  const meta = getMetaEnvState();

  let database: 'up' | 'down' = 'up';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    database = 'down';
    logger.error('health.database_unreachable', { error });
  }

  const body = {
    status: database === 'up' ? 'ok' : 'degraded',
    checks: {
      database,
      messaging: meta.configured ? 'CONFIGURED' : 'NOT_CONFIGURED',
    },
    timestamp: new Date().toISOString(),
  } as const;

  return NextResponse.json(body, {
    status: database === 'up' ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}
