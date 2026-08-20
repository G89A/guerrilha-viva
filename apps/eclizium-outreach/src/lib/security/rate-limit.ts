import { AppError } from '@/lib/errors/app-error';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window counter kept in process memory.
 *
 * SCOPE LIMITATION — read before relying on this: the counter is per Node
 * process. On Vercel each concurrent lambda instance keeps its own window, so
 * the effective ceiling is `limit * instances`. It raises the cost of a brute
 * force attempt but is NOT a distributed rate limiter. A shared store
 * (Postgres or Redis) replaces this in SPRINT 5, where provider-facing send
 * rates make correctness mandatory. See docs/adr/0004-rate-limiting.md.
 */
export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  check(key: string): RateLimitResult {
    const timestamp = this.now();
    this.evictExpired(timestamp);

    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= timestamp) {
      const resetAt = timestamp + this.windowMs;
      this.buckets.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: this.limit - 1, resetAt };
    }

    if (bucket.count >= this.limit) {
      return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
    }

    bucket.count += 1;
    return { allowed: true, remaining: this.limit - bucket.count, resetAt: bucket.resetAt };
  }

  /** Clears a key after a successful attempt so honest users are not penalised. */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  private evictExpired(timestamp: number): void {
    if (this.buckets.size < 1000) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= timestamp) this.buckets.delete(key);
    }
  }
}

/** Throws RATE_LIMITED with a human-readable retry hint. */
export function assertWithinLimit(result: RateLimitResult, now: number = Date.now()): void {
  if (result.allowed) return;
  const seconds = Math.max(1, Math.ceil((result.resetAt - now) / 1000));
  throw new AppError('RATE_LIMITED', `Muitas tentativas. Tente novamente em ${seconds}s.`);
}

/** Login throttle: 10 attempts per 15 minutes, keyed by email + client IP. */
export const loginRateLimiter = new InMemoryRateLimiter(10, 15 * 60 * 1000);

/** Signup throttle: 5 accounts per hour per client IP. */
export const registrationRateLimiter = new InMemoryRateLimiter(5, 60 * 60 * 1000);
