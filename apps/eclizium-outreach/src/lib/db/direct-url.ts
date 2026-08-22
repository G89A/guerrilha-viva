/**
 * `DIRECT_DATABASE_URL` quando o provedor só entrega `DATABASE_URL`.
 *
 * O `schema.prisma` declara `directUrl = env("DIRECT_DATABASE_URL")`, e o Prisma
 * EXIGE que a variável exista — mesmo que a URL seja idêntica à outra. Sem ela o
 * comando morre com `P1012: Environment variable not found`, que não diz nada a
 * quem não escreveu o arquivo.
 *
 * Provedores que ligam o banco sozinho (a integração Postgres da Vercel, por
 * exemplo) definem `DATABASE_URL` e nada mais. O deploy quebraria no build, e a
 * causa seria invisível.
 *
 * A cópia é segura: `directUrl` só é usado por migrations e introspecção. Quando
 * a `DATABASE_URL` aponta para um pooler (PgBouncer, o pooler do Neon), a URL
 * direta continua valendo a pena e deve ser definida à mão — por isso a função
 * NUNCA sobrescreve um valor já existente.
 */
export function ensureDirectDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.DIRECT_DATABASE_URL && env.DIRECT_DATABASE_URL.length > 0) return false;
  if (!env.DATABASE_URL || env.DATABASE_URL.length === 0) return false;

  env.DIRECT_DATABASE_URL = env.DATABASE_URL;
  return true;
}
