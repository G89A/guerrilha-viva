import { describe, expect, it } from 'vitest';
import { assertWithinLimit, InMemoryRateLimiter } from '@/lib/security/rate-limit';

describe('InMemoryRateLimiter', () => {
  it('allows up to the limit and then blocks', () => {
    const limiter = new InMemoryRateLimiter(3, 1000, () => 0);

    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
  });

  it('keys are independent', () => {
    const limiter = new InMemoryRateLimiter(1, 1000, () => 0);

    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('b').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
  });

  it('opens a fresh window once the previous one elapses', () => {
    let now = 0;
    const limiter = new InMemoryRateLimiter(1, 1000, () => now);

    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);

    now = 1001;
    expect(limiter.check('a').allowed).toBe(true);
  });

  it('reset clears the counter for a key', () => {
    const limiter = new InMemoryRateLimiter(1, 1000, () => 0);

    limiter.check('a');
    limiter.reset('a');
    expect(limiter.check('a').allowed).toBe(true);
  });

  it('assertWithinLimit reports the retry delay in seconds', () => {
    expect(() => assertWithinLimit({ allowed: false, remaining: 0, resetAt: 30_000 }, 0)).toThrow(
      /30s/,
    );
    expect(() => assertWithinLimit({ allowed: true, remaining: 1, resetAt: 30_000 }, 0)).not.toThrow();
  });
});
