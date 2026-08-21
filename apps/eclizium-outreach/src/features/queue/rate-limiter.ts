import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';

/**
 * Token bucket de vazão, compartilhado entre processos.
 *
 * POR QUE NO BANCO: o `InMemoryRateLimiter` da Sprint 0 conta por processo. Com
 * vários workers — ou várias instâncias serverless — o teto efetivo vira
 * `limite × instâncias`, o que não serve para envio. Aqui o estado é uma linha,
 * e todos os workers disputam o MESMO balde.
 *
 * PARA QUE SERVE: respeitar o limite de vazão do provider e proteger a
 * reputação do número. É um teto explícito, configurável e determinístico.
 *
 * PARA QUE NÃO SERVE: este mecanismo não existe para "parecer humano", mascarar
 * automação, escapar de antispam ou evitar detecção. Não introduza atraso
 * aleatório com essa intenção aqui.
 */

export interface TokenRequest {
  key: string;
  workspaceId: string;
  ratePerSecond: number;
  burst: number;
  /** Quantos tokens consumir. Um envio custa 1. */
  cost?: number;
  now?: Date;
}

export type TokenOutcome =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterMs: number };

/**
 * Tenta consumir tokens.
 *
 * O recálculo e o débito acontecem em UMA instrução SQL, com a linha travada:
 * dois workers pedindo ao mesmo tempo não conseguem ambos passar quando só há
 * token para um.
 */
export async function consumeToken(request: TokenRequest): Promise<TokenOutcome> {
  const now = request.now ?? new Date();
  const cost = request.cost ?? 1;
  const rate = Math.max(0.001, request.ratePerSecond);
  const burst = Math.max(cost, request.burst);

  // Cria o balde cheio na primeira vez. `skipDuplicates` evita corrida entre
  // dois workers criando o mesmo balde.
  await prisma.rateLimitBucket.createMany({
    skipDuplicates: true,
    data: [
      {
        key: request.key,
        workspaceId: request.workspaceId,
        tokens: burst,
        refilledAt: now,
        ratePerSecond: rate,
        burst,
      },
    ],
  });

  // Recarrega proporcional ao tempo decorrido, limita ao teto e debita — tudo
  // numa instrução. O UPDATE só casa se houver saldo, então o débito é atômico.
  const updated = await prisma.$queryRaw<Array<{ tokens: number }>>(Prisma.sql`
    UPDATE rate_limit_buckets
       SET tokens = LEAST(${burst}::double precision,
                          tokens + EXTRACT(EPOCH FROM (${now}::timestamp - refilled_at)) * ${rate}::double precision)
                    - ${cost}::double precision,
           refilled_at = ${now},
           rate_per_second = ${rate},
           burst = ${burst},
           updated_at = ${now}
     WHERE key = ${request.key}
       AND LEAST(${burst}::double precision,
                 tokens + EXTRACT(EPOCH FROM (${now}::timestamp - refilled_at)) * ${rate}::double precision)
           >= ${cost}::double precision
    RETURNING tokens
  `);

  if (updated.length > 0) {
    return { allowed: true, remaining: Math.max(0, updated[0]?.tokens ?? 0) };
  }

  // Sem saldo: calcula quanto falta para o próximo token ficar disponível.
  const bucket = await prisma.rateLimitBucket.findUnique({ where: { key: request.key } });
  if (!bucket) return { allowed: false, retryAfterMs: Math.ceil((cost / rate) * 1000) };

  const elapsedSeconds = Math.max(0, (now.getTime() - bucket.refilledAt.getTime()) / 1000);
  const available = Math.min(burst, bucket.tokens + elapsedSeconds * rate);
  const missing = Math.max(0, cost - available);

  return { allowed: false, retryAfterMs: Math.ceil((missing / rate) * 1000) };
}

/** Devolve tokens quando a operação nem chegou a acontecer. */
export async function refundToken(key: string, cost = 1, now: Date = new Date()): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE rate_limit_buckets
       SET tokens = LEAST(burst, tokens + ${cost}::double precision), updated_at = ${now}
     WHERE key = ${key}
  `);
}

export function channelBucketKey(channelId: string): string {
  return `channel:${channelId}`;
}
