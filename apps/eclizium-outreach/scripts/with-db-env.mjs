#!/usr/bin/env node
/**
 * Roda um comando com o ambiente de banco resolvido.
 *
 * Resolve dois problemas de deploy, os dois invisíveis até quebrar em produção.
 *
 * 1. DIRECT_DATABASE_URL ausente. O `schema.prisma` declara
 *    `directUrl = env("DIRECT_DATABASE_URL")` e o Prisma exige que a variável
 *    exista, mesmo quando o valor seria igual ao da DATABASE_URL. Provedores
 *    que conectam o banco automaticamente definem só DATABASE_URL, e o build
 *    morria com `P1012` — mensagem que não diz nada a quem não escreveu o
 *    arquivo. Mesma regra de `src/lib/db/direct-url.ts`, repetida aqui porque
 *    este script roda antes de qualquer coisa compilada: NUNCA sobrescreve um
 *    valor existente, porque com pooler a URL direta é outra de propósito.
 *
 * 2. Banco AINDA não existe. Na Vercel o projeto publica no instante em que é
 *    criado — antes de dar tempo de acrescentar o Postgres. Exigir banco no
 *    build faz o primeiro deploy falhar sempre, por definição, e quem está
 *    instalando conclui que o produto está quebrado.
 *
 *      --skip-if-no-database        não roda o comando; sai com 0 e avisa.
 *      --placeholder-if-no-database usa uma URL de mentira, boa só para
 *                                   comandos que NÃO conectam (`generate`).
 *
 *    A URL de mentira nunca chega a lugar nenhum: `prisma generate` só lê o
 *    schema. Quem conecta é `migrate deploy`, e esse é justamente o que a outra
 *    opção pula.
 *
 * Uso: node scripts/with-db-env.mjs [opções] prisma migrate deploy
 */
import { spawnSync } from 'node:child_process';

/** Só para satisfazer o parser do schema. Não é destino de conexão nenhum. */
const PLACEHOLDER = 'postgresql://sem-banco-ainda:0@127.0.0.1:5432/sem-banco-ainda';

const argv = process.argv.slice(2);
const pularSemBanco = argv.includes('--skip-if-no-database');
const fingirSemBanco = argv.includes('--placeholder-if-no-database');
const [command, ...args] = argv.filter((arg) => !arg.startsWith('--'));

if (!command) {
  console.error('[with-db-env] nada para executar. Uso: node scripts/with-db-env.mjs <comando>');
  process.exit(2);
}

const env = { ...process.env };
const temBanco = Boolean(env.DATABASE_URL);

if (!temBanco && pularSemBanco) {
  console.warn(
    `[with-db-env] DATABASE_URL ausente: "${[command, ...args].join(' ')}" NÃO foi executado.\n` +
      '[with-db-env] Isto é esperado no primeiro deploy, antes de o banco existir.\n' +
      '[with-db-env] Crie o banco e publique de novo: as migrations rodam nesse momento.',
  );
  process.exit(0);
}

if (!temBanco && fingirSemBanco) {
  env.DATABASE_URL = PLACEHOLDER;
  console.warn(
    '[with-db-env] DATABASE_URL ausente: usando endereço de espaço reservado apenas para ler o schema.\n' +
      '[with-db-env] Nenhuma conexão é aberta. A aplicação vai reportar banco não configurado até você criar um.',
  );
}

if (!env.DIRECT_DATABASE_URL && env.DATABASE_URL) {
  env.DIRECT_DATABASE_URL = env.DATABASE_URL;
  if (temBanco) {
    console.warn('[with-db-env] DIRECT_DATABASE_URL ausente; copiada de DATABASE_URL.');
  }
}

const result = spawnSync(command, args, { stdio: 'inherit', env, shell: false });

if (result.error) {
  console.error(`[with-db-env] falhou ao executar "${command}": ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
