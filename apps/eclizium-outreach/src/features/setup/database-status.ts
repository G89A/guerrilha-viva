/**
 * O banco existe neste deploy?
 *
 * Serve para uma coisa só: a diferença entre "aplicação quebrada" e "aplicação
 * de pé, esperando o banco". Sem esta distinção, quem acabou de publicar vê um
 * erro de servidor cru e conclui, com razão, que o produto não funciona.
 *
 * O caso é real e comum: a Vercel publica no instante em que o projeto é criado,
 * antes de dar tempo de acrescentar o Postgres. O build passa (ver
 * `scripts/with-db-env.mjs`) e a aplicação sobe sem banco nenhum.
 */

/**
 * Endereço de espaço reservado usado no build quando não há banco. Precisa ser
 * idêntico ao de `scripts/with-db-env.mjs` — há teste garantindo que os dois não
 * saiam de sincronia.
 */
export const PLACEHOLDER_DATABASE_URL =
  'postgresql://sem-banco-ainda:0@127.0.0.1:5432/sem-banco-ainda';

export function databaseConfigured(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const url = env.DATABASE_URL;
  if (!url || url.length === 0) return false;

  // O espaço reservado do build não conta como banco: ele existe só para o
  // Prisma conseguir ler o schema, e não aponta para lugar nenhum.
  return url !== PLACEHOLDER_DATABASE_URL;
}
