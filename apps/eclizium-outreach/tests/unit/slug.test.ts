import { describe, expect, it } from 'vitest';
import { slugify, withSuffix } from '@/features/workspaces/slug';

describe('slugify', () => {
  it.each([
    ['Acme Outreach', 'acme-outreach'],
    ['Campanhas São Paulo', 'campanhas-sao-paulo'],
    ['  Espaços   demais  ', 'espacos-demais'],
    ['Símbolos!!! @#$ aqui', 'simbolos-aqui'],
    ['Ação & Reação', 'acao-reacao'],
    ['---', ''],
  ])('turns %j into %j', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('never exceeds the column budget or ends with a hyphen', () => {
    const slug = slugify('a'.repeat(120));
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('keeps suffixed slugs within the budget', () => {
    const slug = withSuffix(slugify('b'.repeat(120)), 12);
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith('-12')).toBe(true);
  });
});
