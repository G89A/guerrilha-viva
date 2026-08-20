import { execFileSync } from 'node:child_process';
import { config } from 'dotenv';

config({ path: '.env', quiet: true });

/**
 * Applies migrations to the test database once per run. Failing loudly here is
 * deliberate: a silently skipped integration suite would hide exactly the
 * tenancy regressions these tests exist to catch.
 */
export default function globalSetup(): void {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Integration tests need a PostgreSQL database; ' +
        'see README.md → "Rodando os testes".',
    );
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url, DIRECT_DATABASE_URL: url },
    stdio: 'inherit',
  });
}
