import { describe, expect, it } from 'vitest';
import { randomToken, safeEqual, sha256 } from '@/lib/security/crypto';

describe('randomToken', () => {
  it('produces URL-safe output with no padding', () => {
    for (let index = 0; index < 50; index += 1) {
      expect(randomToken(32)).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('does not repeat across many draws', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => randomToken(32)));
    expect(tokens.size).toBe(500);
  });

  it('honours the requested byte length', () => {
    // base64url of 32 bytes is 43 characters once padding is dropped.
    expect(randomToken(32)).toHaveLength(43);
    expect(randomToken(16)).toHaveLength(22);
  });
});

describe('sha256', () => {
  it('is deterministic and hex encoded', () => {
    expect(sha256('abc')).toBe(sha256('abc'));
    expect(sha256('abc')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for different inputs', () => {
    expect(sha256('abc')).not.toBe(sha256('abd'));
  });

  it('matches the known digest of a fixed input', () => {
    expect(sha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('safeEqual', () => {
  it('matches identical strings', () => {
    expect(safeEqual('token-abc', 'token-abc')).toBe(true);
  });

  it('rejects different strings of equal length', () => {
    expect(safeEqual('token-abc', 'token-abd')).toBe(false);
  });

  it('rejects different lengths without throwing', () => {
    expect(safeEqual('short', 'much-longer-value')).toBe(false);
    expect(safeEqual('', 'x')).toBe(false);
  });

  it('matches two empty strings', () => {
    expect(safeEqual('', '')).toBe(true);
  });
});
