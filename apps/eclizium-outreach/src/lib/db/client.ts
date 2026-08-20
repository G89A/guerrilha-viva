import 'server-only';
import { type Prisma, PrismaClient } from '@prisma/client';

declare global {
  var __eclizium_prisma__: PrismaClient | undefined;
}

function resolveLogLevels(): Prisma.LogDefinition[] {
  switch (process.env.NODE_ENV) {
    case 'development':
      return [
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ];
    case 'test':
      // Several suites assert on constraint violations on purpose; Prisma's own
      // error output would bury the actual test results.
      return [];
    default:
      return [{ emit: 'stdout', level: 'error' }];
  }
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({ log: resolveLogLevels() });
}

/**
 * Single Prisma client per process. In development Next.js re-evaluates modules
 * on every hot reload, so the instance is parked on `globalThis` to avoid
 * exhausting the connection pool.
 */
export const prisma: PrismaClient = globalThis.__eclizium_prisma__ ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__eclizium_prisma__ = prisma;
}

export type { PrismaClient };
