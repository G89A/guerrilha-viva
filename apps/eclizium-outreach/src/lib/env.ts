import 'server-only';
import { z } from 'zod';

/**
 * Server-side environment. This module is `server-only`: importing it from a
 * client component is a build error, which is what keeps provider secrets out
 * of the browser bundle.
 */

const base64Secret = z
  .string()
  .min(24, 'AUTH_SECRET must be at least 24 characters of high-entropy material');

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_DATABASE_URL: z.string().optional(),

  AUTH_SECRET: base64Secret,
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

/**
 * Parses and caches the server environment. Throws a single aggregated error
 * listing every missing/invalid variable rather than failing one at a time.
 */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid server environment:\n${details}`);
  }

  cached = parsed.data;
  return cached;
}

/** Test-only: drops the memoised value so a suite can re-parse `process.env`. */
export function resetServerEnvCache(): void {
  cached = null;
}

// ---------------------------------------------------------------------------
// Meta WhatsApp Business Cloud API
//
// These are read separately and are allowed to be absent: the product must
// report an honest NOT_CONFIGURED state instead of pretending to be wired up.
// ---------------------------------------------------------------------------

const metaEnvSchema = z.object({
  META_ACCESS_TOKEN: z.string().min(1),
  META_PHONE_NUMBER_ID: z.string().min(1),
  META_WABA_ID: z.string().min(1),
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(1),
  META_APP_SECRET: z.string().min(1),
  META_GRAPH_API_VERSION: z.string().min(1).default('v21.0'),
});

export type MetaEnv = z.infer<typeof metaEnvSchema>;

export type MetaEnvState =
  | { configured: true; env: MetaEnv }
  | { configured: false; missing: string[] };

/**
 * Reports whether the Meta WhatsApp integration is fully configured, and if
 * not, exactly which variables are missing. Never returns secret values to
 * callers that only asked about configuration state.
 */
export function getMetaEnvState(
  source: Readonly<Record<string, string | undefined>> = process.env,
): MetaEnvState {
  const parsed = metaEnvSchema.safeParse(source);
  if (parsed.success) {
    return { configured: true, env: parsed.data };
  }

  const missing = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))].sort();
  return { configured: false, missing };
}
