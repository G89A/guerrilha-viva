/** Campos de contato que uma coluna do CSV pode alimentar. */
export const MAPPABLE_FIELDS = [
  'phone',
  'firstName',
  'lastName',
  'email',
  'company',
  'segment',
  'city',
  'state',
  'country',
  'notes',
] as const;

export type MappableField = (typeof MAPPABLE_FIELDS)[number];

export type ColumnMapping = Partial<Record<MappableField, number>>;

export const FIELD_LABELS: Record<MappableField, string> = {
  phone: 'Telefone',
  firstName: 'Nome',
  lastName: 'Sobrenome',
  email: 'E-mail',
  company: 'Empresa',
  segment: 'Segmento',
  city: 'Cidade',
  state: 'Estado',
  country: 'País',
  notes: 'Observações',
};

/** Sinônimos por campo, normalizados (sem acento, minúsculos, sem separadores). */
const SYNONYMS: Record<MappableField, string[]> = {
  phone: ['telefone', 'celular', 'fone', 'whatsapp', 'whats', 'phone', 'mobile', 'numero', 'tel'],
  firstName: ['nome', 'primeironome', 'firstname', 'name', 'contato'],
  lastName: ['sobrenome', 'ultimonome', 'lastname', 'surname'],
  email: ['email', 'mail', 'correio', 'eletronico'],
  company: ['empresa', 'company', 'organizacao', 'organization', 'negocio'],
  segment: ['segmento', 'segment', 'setor', 'categoria', 'nicho'],
  city: ['cidade', 'city', 'municipio'],
  state: ['estado', 'state', 'uf', 'provincia'],
  country: ['pais', 'country'],
  notes: ['observacoes', 'observacao', 'notas', 'nota', 'notes', 'comentario', 'obs'],
};

export function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Sugere um mapeamento a partir dos cabeçalhos. É apenas um ponto de partida
 * para a etapa 3 do wizard: o usuário confirma ou corrige, e o servidor só
 * confia no mapeamento confirmado.
 */
export function suggestMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<number>();

  for (const field of MAPPABLE_FIELDS) {
    const synonyms = SYNONYMS[field];

    // Correspondência exata primeiro; só depois a parcial, para que "nome" não
    // seja capturado por "sobrenome".
    let index = headers.findIndex(
      (header, position) => !used.has(position) && synonyms.includes(normalizeHeader(header)),
    );

    if (index === -1) {
      index = headers.findIndex(
        (header, position) =>
          !used.has(position) &&
          synonyms.some((synonym) => normalizeHeader(header).includes(synonym)),
      );
    }

    if (index !== -1) {
      mapping[field] = index;
      used.add(index);
    }
  }

  return mapping;
}

export function mappedValue(
  row: string[],
  mapping: ColumnMapping,
  field: MappableField,
): string | null {
  const index = mapping[field];
  if (index === undefined) return null;
  const value = row[index];
  return value && value.length > 0 ? value : null;
}
