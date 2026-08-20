import { describe, expect, it } from 'vitest';
import { mappedValue, normalizeHeader, suggestMapping } from '@/features/contacts/csv/mapping';

describe('normalizeHeader', () => {
  it.each([
    ['Telefone', 'telefone'],
    ['TELEFONE', 'telefone'],
    ['  Telefone  ', 'telefone'],
    ['Endereço', 'endereco'],
    ['E-mail', 'email'],
    ['Primeiro Nome', 'primeironome'],
  ])('normaliza %j para %j', (input, expected) => {
    expect(normalizeHeader(input)).toBe(expected);
  });
});

describe('suggestMapping', () => {
  it('reconhece cabeçalhos em português', () => {
    const mapping = suggestMapping(['Nome', 'Telefone', 'Empresa', 'Cidade']);
    expect(mapping).toMatchObject({ firstName: 0, phone: 1, company: 2, city: 3 });
  });

  it('reconhece cabeçalhos em inglês', () => {
    const mapping = suggestMapping(['first name', 'phone', 'company', 'city']);
    expect(mapping).toMatchObject({ firstName: 0, phone: 1, company: 2, city: 3 });
  });

  it('não confunde Nome com Sobrenome', () => {
    const mapping = suggestMapping(['Sobrenome', 'Nome']);
    expect(mapping.lastName).toBe(0);
    expect(mapping.firstName).toBe(1);
  });

  it('nunca aponta dois campos para a mesma coluna', () => {
    const mapping = suggestMapping(['contato', 'celular', 'whatsapp', 'telefone']);
    const used = Object.values(mapping);
    expect(new Set(used).size).toBe(used.length);
  });

  it('deixa de fora campos sem coluna correspondente', () => {
    const mapping = suggestMapping(['telefone']);
    expect(mapping.phone).toBe(0);
    expect(mapping.company).toBeUndefined();
    expect(mapping.city).toBeUndefined();
  });

  it('não inventa mapeamento para cabeçalhos irreconhecíveis', () => {
    expect(suggestMapping(['xpto', 'zzz'])).toEqual({});
  });
});

describe('mappedValue', () => {
  const mapping = { phone: 1, firstName: 0 } as const;

  it('lê a coluna mapeada', () => {
    expect(mappedValue(['João', '8599'], mapping, 'firstName')).toBe('João');
    expect(mappedValue(['João', '8599'], mapping, 'phone')).toBe('8599');
  });

  it('devolve null para campo não mapeado ou célula vazia', () => {
    expect(mappedValue(['João', '8599'], mapping, 'company')).toBeNull();
    expect(mappedValue(['', '8599'], mapping, 'firstName')).toBeNull();
  });

  it('devolve null quando a linha é mais curta que o índice', () => {
    expect(mappedValue(['João'], mapping, 'phone')).toBeNull();
  });
});
