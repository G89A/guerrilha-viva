import {
  TemplateCategory,
  TemplateHeaderFormat,
  TemplateStatus,
} from '@prisma/client';

/**
 * Tradução dos valores brutos da Meta para os enums internos.
 *
 * O valor bruto continua salvo em `providerStatus`/`providerCategory`. Um
 * estado que a Meta introduza amanhã vira UNKNOWN aqui e continua legível lá,
 * em vez de derrubar a sincronização.
 */

const STATUS_MAP: Record<string, TemplateStatus> = {
  APPROVED: TemplateStatus.APPROVED,
  PENDING: TemplateStatus.PENDING,
  IN_APPEAL: TemplateStatus.PENDING,
  PENDING_DELETION: TemplateStatus.PENDING,
  REJECTED: TemplateStatus.REJECTED,
  PAUSED: TemplateStatus.PAUSED,
  DISABLED: TemplateStatus.DISABLED,
  DELETED: TemplateStatus.DISABLED,
};

export function normalizeTemplateStatus(raw: string | null | undefined): TemplateStatus {
  if (!raw) return TemplateStatus.UNKNOWN;
  return STATUS_MAP[raw.trim().toUpperCase()] ?? TemplateStatus.UNKNOWN;
}

const CATEGORY_MAP: Record<string, TemplateCategory> = {
  MARKETING: TemplateCategory.MARKETING,
  UTILITY: TemplateCategory.UTILITY,
  TRANSACTIONAL: TemplateCategory.UTILITY,
  AUTHENTICATION: TemplateCategory.AUTHENTICATION,
  OTP: TemplateCategory.AUTHENTICATION,
};

export function normalizeTemplateCategory(raw: string | null | undefined): TemplateCategory {
  if (!raw) return TemplateCategory.UNKNOWN;
  return CATEGORY_MAP[raw.trim().toUpperCase()] ?? TemplateCategory.UNKNOWN;
}

const HEADER_FORMAT_MAP: Record<string, TemplateHeaderFormat> = {
  TEXT: TemplateHeaderFormat.TEXT,
  IMAGE: TemplateHeaderFormat.IMAGE,
  VIDEO: TemplateHeaderFormat.VIDEO,
  DOCUMENT: TemplateHeaderFormat.DOCUMENT,
  LOCATION: TemplateHeaderFormat.LOCATION,
};

export function normalizeHeaderFormat(
  raw: string | null | undefined,
): TemplateHeaderFormat | null {
  if (!raw) return null;
  return HEADER_FORMAT_MAP[raw.trim().toUpperCase()] ?? TemplateHeaderFormat.UNKNOWN;
}

export interface TemplateVariable {
  /** Chave posicional como aparece no texto: "1", "2", … */
  key: string;
  component: 'header' | 'body';
}

const PLACEHOLDER = /\{\{\s*(\d{1,2})\s*\}\}/g;

/**
 * Extrai os placeholders `{{n}}` de header e body, em ordem numérica e sem
 * repetição. Nada aqui presume o significado de `{{1}}` — o mapeamento para um
 * campo do contato é uma decisão explícita do operador.
 */
export function extractVariables(input: {
  headerText?: string | null;
  body: string;
}): TemplateVariable[] {
  const found = new Map<string, TemplateVariable>();

  const scan = (text: string | null | undefined, component: 'header' | 'body'): void => {
    if (!text) return;
    for (const match of text.matchAll(PLACEHOLDER)) {
      const key = match[1];
      if (!key) continue;
      const id = `${component}:${key}`;
      if (!found.has(id)) found.set(id, { key, component });
    }
  };

  scan(input.headerText, 'header');
  scan(input.body, 'body');

  return [...found.values()].sort((a, b) => {
    if (a.component !== b.component) return a.component === 'header' ? -1 : 1;
    return Number(a.key) - Number(b.key);
  });
}

/** Quantidade de variáveis do corpo — as que o envio precisa preencher. */
export function bodyVariableCount(variables: TemplateVariable[]): number {
  return variables.filter((variable) => variable.component === 'body').length;
}
