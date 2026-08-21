import type { TemplateVariable } from '@/features/messaging/template-normalize';

/**
 * Mapeamento explícito de variáveis do template para dados do contato.
 *
 * Nada é presumido: `{{1}}` NÃO significa "primeiro nome" por convenção. O
 * operador escolhe a origem de cada placeholder, e um valor literal é sempre
 * uma opção.
 */

export const VARIABLE_SOURCES = [
  'contact.firstName',
  'contact.lastName',
  'contact.fullName',
  'contact.company',
  'contact.city',
  'contact.segment',
  'literal',
] as const;

export type VariableSource = (typeof VARIABLE_SOURCES)[number];

export const VARIABLE_SOURCE_LABELS: Record<VariableSource, string> = {
  'contact.firstName': 'Nome',
  'contact.lastName': 'Sobrenome',
  'contact.fullName': 'Nome completo',
  'contact.company': 'Empresa',
  'contact.city': 'Cidade',
  'contact.segment': 'Segmento',
  literal: 'Texto fixo',
};

export interface VariableBinding {
  source: VariableSource;
  /** Usado quando `source === 'literal'`. */
  value?: string;
}

/** Mapa `{ "1": { source: "contact.firstName" } }`, por componente. */
export type VariableMapping = Record<string, VariableBinding>;

export interface RenderableContact {
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  city: string | null;
  segment: string | null;
}

export type ResolveResult =
  | { ok: true; values: string[] }
  | { ok: false; missing: string[] };

function readSource(contact: RenderableContact, binding: VariableBinding): string | null {
  switch (binding.source) {
    case 'contact.firstName':
      return contact.firstName;
    case 'contact.lastName':
      return contact.lastName;
    case 'contact.fullName': {
      const full = [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
      return full.length > 0 ? full : null;
    }
    case 'contact.company':
      return contact.company;
    case 'contact.city':
      return contact.city;
    case 'contact.segment':
      return contact.segment;
    case 'literal': {
      const value = binding.value?.trim();
      return value && value.length > 0 ? value : null;
    }
    default:
      return null;
  }
}

/**
 * Resolve os parâmetros posicionais de um componente.
 *
 * Um placeholder sem origem, ou cujo campo do contato está vazio, entra em
 * `missing` — o envio é bloqueado em vez de mandar "undefined" ou um espaço
 * em branco para o destinatário.
 */
export function resolveVariables(
  variables: TemplateVariable[],
  mapping: VariableMapping,
  contact: RenderableContact,
  component: 'header' | 'body',
): ResolveResult {
  const relevant = variables
    .filter((variable) => variable.component === component)
    .sort((a, b) => Number(a.key) - Number(b.key));

  const values: string[] = [];
  const missing: string[] = [];

  for (const variable of relevant) {
    const binding = mapping[`${component}:${variable.key}`] ?? mapping[variable.key];
    const resolved = binding ? readSource(contact, binding) : null;

    if (resolved === null) {
      missing.push(`{{${variable.key}}}`);
      continue;
    }
    values.push(resolved);
  }

  return missing.length > 0 ? { ok: false, missing } : { ok: true, values };
}

/**
 * Substitui `{{n}}` pelos valores, para o preview. Placeholders sem valor
 * permanecem visíveis como `{{n}}` — o operador precisa enxergar o buraco.
 */
export function renderTemplateText(text: string, values: string[]): string {
  return text.replace(/\{\{\s*(\d{1,2})\s*\}\}/g, (match, rawIndex: string) => {
    const value = values[Number(rawIndex) - 1];
    return value === undefined ? match : value;
  });
}

/** Sugestão inicial de mapeamento — ponto de partida, nunca aplicada sozinha. */
export function suggestMapping(variables: TemplateVariable[]): VariableMapping {
  const preferred: VariableSource[] = [
    'contact.firstName',
    'contact.company',
    'contact.city',
    'contact.segment',
  ];

  const mapping: VariableMapping = {};
  variables.forEach((variable, index) => {
    mapping[`${variable.component}:${variable.key}`] = {
      source: preferred[index] ?? 'literal',
      value: '',
    };
  });
  return mapping;
}
