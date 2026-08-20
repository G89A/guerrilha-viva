import { config } from 'dotenv';

// Load `.env` so integration suites find TEST_DATABASE_URL, then point Prisma at
// the dedicated test database. Never let a test run against the dev database.
config({ path: '.env', quiet: true });

// `NODE_ENV` is typed read-only by Next's ambient types; tests legitimately set it.
(process.env as Record<string, string>).NODE_ENV = 'test';

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DIRECT_DATABASE_URL = process.env.TEST_DATABASE_URL;
}

process.env.AUTH_SECRET ??= 'test-only-secret-value-not-for-production';
process.env.APP_URL ??= 'http://localhost:3000';
process.env.LOG_LEVEL = 'error';
