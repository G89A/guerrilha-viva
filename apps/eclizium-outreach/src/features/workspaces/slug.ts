/**
 * Builds a URL-safe slug from arbitrary user text. Accent folding matters here:
 * "Campanhas São Paulo" must become "campanhas-sao-paulo", not "campanhas-so-paulo".
 */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
}

/** Appends a numeric suffix while keeping the slug within its length budget. */
export function withSuffix(slug: string, suffix: number): string {
  const tail = `-${suffix}`;
  return `${slug.slice(0, 48 - tail.length)}${tail}`;
}
