import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ensureDirectDatabaseUrl } from '@/lib/db/direct-url';

/**
 * `DIRECT_DATABASE_URL` quando o provedor só entrega `DATABASE_URL`.
 *
 * O `schema.prisma` declara `directUrl = env("DIRECT_DATABASE_URL")`, e o Prisma
 * recusa a configuração inteira se a variável não existir — `P1012`. Provedores
 * que ligam o Postgres sozinho definem apenas `DATABASE_URL`, então o deploy
 * quebrava no build por um motivo que não aparece em lugar nenhum do produto.
 */

const RAIZ = new URL('../..', import.meta.url).pathname;

describe('ensureDirectDatabaseUrl', () => {
  it('copia da DATABASE_URL quando a direta está ausente', () => {
    const env: Record<string, string | undefined> = { DATABASE_URL: 'postgresql://u:p@h/db' };

    expect(ensureDirectDatabaseUrl(env)).toBe(true);
    expect(env.DIRECT_DATABASE_URL).toBe('postgresql://u:p@h/db');
  });

  it('NUNCA sobrescreve uma direta já definida', () => {
    // Quando a DATABASE_URL aponta para um pooler, a direta é outra de propósito.
    const env: Record<string, string | undefined> = {
      DATABASE_URL: 'postgresql://u:p@pooler/db',
      DIRECT_DATABASE_URL: 'postgresql://u:p@direto/db',
    };

    expect(ensureDirectDatabaseUrl(env)).toBe(false);
    expect(env.DIRECT_DATABASE_URL).toBe('postgresql://u:p@direto/db');
  });

  it('não inventa valor quando nem a DATABASE_URL existe', () => {
    const env: Record<string, string | undefined> = {};

    expect(ensureDirectDatabaseUrl(env)).toBe(false);
    expect(env.DIRECT_DATABASE_URL).toBeUndefined();
  });

  it('trata string vazia como ausente', () => {
    const env: Record<string, string | undefined> = {
      DATABASE_URL: 'postgresql://u:p@h/db',
      DIRECT_DATABASE_URL: '',
    };

    expect(ensureDirectDatabaseUrl(env)).toBe(true);
    expect(env.DIRECT_DATABASE_URL).toBe('postgresql://u:p@h/db');
  });
});

describe('scripts/with-db-env.mjs', () => {
  function rodar(env: Record<string, string>): string {
    return execFileSync(
      process.execPath,
      ['scripts/with-db-env.mjs', process.execPath, '-p', 'process.env.DIRECT_DATABASE_URL'],
      {
        cwd: RAIZ,
        encoding: 'utf8',
        // Ambiente mínimo e controlado: se herdasse o do processo, a
        // DIRECT_DATABASE_URL do `.env` local mascararia o caso que interessa.
        env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', ...env },
      },
    ).trim();
  }

  it('entrega a direta ao processo filho quando ela falta', () => {
    expect(rodar({ DATABASE_URL: 'postgresql://u:p@h/db' })).toContain('postgresql://u:p@h/db');
  });

  it('preserva a direta que já veio do ambiente', () => {
    const saida = rodar({
      DATABASE_URL: 'postgresql://u:p@pooler/db',
      DIRECT_DATABASE_URL: 'postgresql://u:p@direto/db',
    });
    expect(saida).toContain('postgresql://u:p@direto/db');
  });

  it('propaga o código de saída do comando', () => {
    expect(() =>
      execFileSync(process.execPath, ['scripts/with-db-env.mjs', process.execPath, '-e', 'process.exit(7)'], {
        cwd: RAIZ,
        stdio: 'ignore',
      }),
    ).toThrowError(/7/);
  });
});

describe('os comandos de build passam pelo invólucro', () => {
  // Guarda contra a regressão silenciosa: se alguém trocar de volta para
  // `prisma generate` puro, o deploy volta a quebrar só em produção.
  const scripts = (
    JSON.parse(readFileSync(`${RAIZ}/package.json`, 'utf8')) as {
      scripts: Record<string, string>;
    }
  ).scripts;

  it.each(['build', 'db:deploy', 'db:generate'])('%s usa with-db-env', (nome) => {
    expect(scripts[nome]).toContain('with-db-env.mjs');
  });
});
