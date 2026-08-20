/**
 * Key names whose values must never reach a log sink. Matching is
 * case-insensitive and substring-based so `metaAccessToken`, `META_ACCESS_TOKEN`
 * and `access_token` are all caught.
 */
const SENSITIVE_KEY_FRAGMENTS = [
  'password',
  'passwordhash',
  'secret',
  'token',
  'authorization',
  'cookie',
  'apikey',
  'api_key',
  'credential',
  'signature',
  'session',
] as const;

export const REDACTED = '[REDACTED]';

const MAX_DEPTH = 6;

function isSensitiveKey(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[-_]/g, '');
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) =>
    normalised.includes(fragment.replace(/[-_]/g, '')),
  );
}

/**
 * Recursively replaces sensitive values with `[REDACTED]`. Cycles are broken
 * with a marker, and depth is capped so a pathological object cannot stall the
 * logger.
 */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[MAX_DEPTH]';

  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1, seen));
  }

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = isSensitiveKey(key) ? REDACTED : redact(item, depth + 1, seen);
  }
  return output;
}
