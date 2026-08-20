import { describe, expect, it } from 'vitest';
import {
  hashPassword,
  MAX_PASSWORD_LENGTH,
  needsRehash,
  verifyPassword,
} from '@/lib/auth/password';

describe('password hashing', () => {
  it('verifies a correct password', async () => {
    const hash = await hashPassword('senha-super-forte-2026');
    await expect(verifyPassword('senha-super-forte-2026', hash)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('senha-super-forte-2026');
    await expect(verifyPassword('senha-super-forte-2025', hash)).resolves.toBe(false);
  });

  it('produces a different hash for the same password (random salt)', async () => {
    const [a, b] = await Promise.all([hashPassword('mesma-senha-1'), hashPassword('mesma-senha-1')]);
    expect(a).not.toBe(b);
    await expect(verifyPassword('mesma-senha-1', a)).resolves.toBe(true);
    await expect(verifyPassword('mesma-senha-1', b)).resolves.toBe(true);
  });

  it('normalises unicode so equivalent inputs match', async () => {
    // "é" as a single code point vs. "e" + combining acute.
    const hash = await hashPassword('café-secreto-1');
    await expect(verifyPassword('café-secreto-1', hash)).resolves.toBe(true);
  });

  it.each([
    ['empty', ''],
    ['not our format', 'argon2id$v=19$m=65536'],
    ['wrong field count', 'scrypt$32768$8$1$salt'],
    ['non-numeric parameters', 'scrypt$abc$8$1$c2FsdA==$aGFzaA=='],
  ])('returns false for a malformed hash (%s) instead of throwing', async (_label, stored) => {
    await expect(verifyPassword('qualquer-senha', stored)).resolves.toBe(false);
  });

  it('refuses absurd stored parameters that would exhaust memory', async () => {
    await expect(verifyPassword('x', 'scrypt$1073741824$99$99$c2FsdA==$aGFzaA==')).resolves.toBe(
      false,
    );
  });

  it('rejects oversized passwords rather than burning CPU on them', async () => {
    const huge = 'a'.repeat(MAX_PASSWORD_LENGTH + 1);
    await expect(hashPassword(huge)).rejects.toThrow(/exceeds/);
    await expect(verifyPassword(huge, 'scrypt$32768$8$1$c2FsdA==$aGFzaA==')).resolves.toBe(false);
  });

  it('flags weaker legacy parameters for rehashing', async () => {
    expect(needsRehash('scrypt$16384$8$1$c2FsdA==$aGFzaA==')).toBe(true);
    expect(needsRehash(await hashPassword('senha-atual-9'))).toBe(false);
  });
});
