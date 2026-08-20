import { normalizePhone } from '@/features/contacts/phone';
import { mappedValue, type ColumnMapping } from '@/features/contacts/csv/mapping';

export type RowStatus = 'VALID' | 'INVALID' | 'DUPLICATE_IN_FILE' | 'DUPLICATE_IN_DATABASE';

export interface ClassifiedRow {
  /** Número da linha no arquivo original, contando o cabeçalho como linha 1. */
  lineNumber: number;
  status: RowStatus;
  reason: string | null;
  phoneE164: string | null;
  values: {
    phone: string | null;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    company: string | null;
    segment: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    notes: string | null;
  };
}

export interface ClassificationSummary {
  total: number;
  valid: number;
  invalid: number;
  duplicateInFile: number;
  duplicateInDatabase: number;
}

export interface ClassifyOptions {
  rows: string[][];
  mapping: ColumnMapping;
  phoneRegion: string;
  /** E.164 já existentes no workspace. Vazio na etapa de preview no cliente. */
  existingPhones?: ReadonlySet<string>;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Classifica cada linha do arquivo. Nenhuma linha é descartada em silêncio:
 * toda linha sai daqui com um status e, quando aplicável, o motivo.
 *
 * A mesma função roda no preview (sem `existingPhones`) e na importação (com),
 * para que o número mostrado ao usuário e o gravado tenham a mesma origem.
 */
export function classifyRows(options: ClassifyOptions): {
  rows: ClassifiedRow[];
  summary: ClassificationSummary;
} {
  const existing = options.existingPhones ?? new Set<string>();
  const seenInFile = new Map<string, number>();
  const classified: ClassifiedRow[] = [];

  options.rows.forEach((row, index) => {
    const values = {
      phone: mappedValue(row, options.mapping, 'phone'),
      firstName: mappedValue(row, options.mapping, 'firstName'),
      lastName: mappedValue(row, options.mapping, 'lastName'),
      email: mappedValue(row, options.mapping, 'email'),
      company: mappedValue(row, options.mapping, 'company'),
      segment: mappedValue(row, options.mapping, 'segment'),
      city: mappedValue(row, options.mapping, 'city'),
      state: mappedValue(row, options.mapping, 'state'),
      country: mappedValue(row, options.mapping, 'country'),
      notes: mappedValue(row, options.mapping, 'notes'),
    };

    const lineNumber = index + 2;

    const phoneResult = normalizePhone(values.phone, options.phoneRegion);
    if (!phoneResult.ok) {
      classified.push({
        lineNumber,
        status: 'INVALID',
        reason: phoneResult.message,
        phoneE164: null,
        values,
      });
      return;
    }

    if (values.email && !EMAIL_PATTERN.test(values.email)) {
      classified.push({
        lineNumber,
        status: 'INVALID',
        reason: 'E-mail inválido.',
        phoneE164: phoneResult.phone.e164,
        values,
      });
      return;
    }

    const phoneE164 = phoneResult.phone.e164;

    const firstSeenAt = seenInFile.get(phoneE164);
    if (firstSeenAt !== undefined) {
      classified.push({
        lineNumber,
        status: 'DUPLICATE_IN_FILE',
        reason: `Telefone repetido na linha ${firstSeenAt}.`,
        phoneE164,
        values,
      });
      return;
    }
    seenInFile.set(phoneE164, lineNumber);

    if (existing.has(phoneE164)) {
      classified.push({
        lineNumber,
        status: 'DUPLICATE_IN_DATABASE',
        reason: 'Já existe um contato com este telefone.',
        phoneE164,
        values,
      });
      return;
    }

    classified.push({ lineNumber, status: 'VALID', reason: null, phoneE164, values });
  });

  return { rows: classified, summary: summarize(classified) };
}

export function summarize(rows: ClassifiedRow[]): ClassificationSummary {
  return {
    total: rows.length,
    valid: rows.filter((row) => row.status === 'VALID').length,
    invalid: rows.filter((row) => row.status === 'INVALID').length,
    duplicateInFile: rows.filter((row) => row.status === 'DUPLICATE_IN_FILE').length,
    duplicateInDatabase: rows.filter((row) => row.status === 'DUPLICATE_IN_DATABASE').length,
  };
}

export const ROW_STATUS_LABELS: Record<RowStatus, string> = {
  VALID: 'Válida',
  INVALID: 'Inválida',
  DUPLICATE_IN_FILE: 'Duplicada no arquivo',
  DUPLICATE_IN_DATABASE: 'Já existe no banco',
};
