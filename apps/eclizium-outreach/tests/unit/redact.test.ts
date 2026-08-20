import { describe, expect, it } from 'vitest';
import { REDACTED, redact } from '@/lib/logging/redact';

describe('redact', () => {
  it('masks values under sensitive keys regardless of casing or separators', () => {
    const output = redact({
      META_ACCESS_TOKEN: 'EAAG-real-token',
      passwordHash: 'scrypt$...',
      apiKey: 'sk-123',
      'x-api-key': 'sk-456',
      authorization: 'Bearer abc',
      name: 'Ana',
    }) as Record<string, unknown>;

    expect(output.META_ACCESS_TOKEN).toBe(REDACTED);
    expect(output.passwordHash).toBe(REDACTED);
    expect(output.apiKey).toBe(REDACTED);
    expect(output['x-api-key']).toBe(REDACTED);
    expect(output.authorization).toBe(REDACTED);
    expect(output.name).toBe('Ana');
  });

  it('masks secrets nested inside objects and arrays', () => {
    const output = redact({
      provider: { channels: [{ accessToken: 'secret', displayName: 'Canal' }] },
    }) as { provider: { channels: Array<Record<string, unknown>> } };

    expect(output.provider.channels[0]?.accessToken).toBe(REDACTED);
    expect(output.provider.channels[0]?.displayName).toBe('Canal');
  });

  it('masks an entire subtree when the container key is itself sensitive', () => {
    const output = redact({ provider: { credentials: [{ accessToken: 'secret' }] } }) as {
      provider: Record<string, unknown>;
    };

    expect(output.provider.credentials).toBe(REDACTED);
  });

  it('does not throw on circular structures', () => {
    const node: Record<string, unknown> = { name: 'root' };
    node.self = node;

    const output = redact(node) as Record<string, unknown>;
    expect(output.self).toBe('[CIRCULAR]');
  });

  it('caps recursion depth', () => {
    let deep: Record<string, unknown> = { value: 'leaf' };
    for (let index = 0; index < 12; index += 1) deep = { child: deep };

    expect(JSON.stringify(redact(deep))).toContain('[MAX_DEPTH]');
  });

  it('serialises Error and Date instances', () => {
    const output = redact({ when: new Date('2026-01-01T00:00:00Z'), boom: new Error('nope') }) as {
      when: string;
      boom: { message: string };
    };

    expect(output.when).toBe('2026-01-01T00:00:00.000Z');
    expect(output.boom.message).toBe('nope');
  });
});
