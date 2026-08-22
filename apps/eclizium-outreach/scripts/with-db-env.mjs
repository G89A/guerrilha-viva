#!/usr/bin/env node
/**
 * Roda um comando com o ambiente de banco completo.
 *
 * Existe por causa de um detalhe do Prisma: `schema.prisma` declara
 * `directUrl = env("DIRECT_DATABASE_URL")` e o Prisma exige que a variável
 * exista, mesmo quando o valor seria igual ao da `DATABASE_URL`. Provedores que
 * conectam o banco automaticamente (a integração Postgres da Vercel, por
 * exemplo) definem só `DATABASE_URL` — e o build morre com um `P1012` que não
 * explica nada a quem não escreveu o arquivo.
 *
 * Mesma regra de `src/lib/db/direct-url.ts`, repetida aqui porque este script
 * roda antes de qualquer coisa compilada: NUNCA sobrescreve um valor existente.
 *
 * Uso: node scripts/with-db-env.mjs prisma migrate deploy
 */
import { spawnSync } from 'node:child_process';

const env = { ...process.env };

if (!env.DIRECT_DATABASE_URL && env.DATABASE_URL) {
  env.DIRECT_DATABASE_URL = env.DATABASE_URL;
  console.log('[with-db-env] DIRECT_DATABASE_URL ausente; copiada de DATABASE_URL.');
}

const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error('[with-db-env] nada para executar. Uso: node scripts/with-db-env.mjs <comando>');
  process.exit(2);
}

const result = spawnSync(command, args, { stdio: 'inherit', env, shell: false });

if (result.error) {
  console.error(`[with-db-env] falhou ao executar "${command}": ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
