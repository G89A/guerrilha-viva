/**
 * Parser de CSV sem dependência externa, isomórfico.
 *
 * Suporta RFC 4180: aspas duplas, aspas escapadas (`""`), separadores e
 * quebras de linha dentro de campos, CRLF e BOM. Detecta o delimitador entre
 * vírgula, ponto e vírgula e tabulação — planilhas brasileiras exportam com
 * ponto e vírgula com frequência.
 *
 * O conteúdo do CSV é sempre tratado como dado. Nada aqui é avaliado.
 */

export const CSV_MAX_BYTES = 2 * 1024 * 1024;
export const CSV_MAX_ROWS = 5_000;
export const CSV_MAX_COLUMNS = 60;
export const CSV_MAX_CELL_LENGTH = 4_000;

export type CsvErrorCode =
  | 'EMPTY_FILE'
  | 'TOO_LARGE'
  | 'TOO_MANY_ROWS'
  | 'TOO_MANY_COLUMNS'
  | 'NO_HEADER'
  | 'NO_DATA_ROWS'
  | 'DUPLICATE_HEADERS';

export interface CsvParseError {
  code: CsvErrorCode;
  message: string;
}

export interface CsvDocument {
  headers: string[];
  /** Cada linha tem exatamente `headers.length` posições. */
  rows: string[][];
  delimiter: string;
  /** Linhas cujo número de colunas divergia do cabeçalho, já ajustadas. */
  ragged: number[];
}

export type CsvParseResult =
  | { ok: true; document: CsvDocument }
  | { ok: false; error: CsvParseError };

const MESSAGES: Record<CsvErrorCode, string> = {
  EMPTY_FILE: 'O arquivo está vazio.',
  TOO_LARGE: `Arquivo maior que ${CSV_MAX_BYTES / (1024 * 1024)} MB.`,
  TOO_MANY_ROWS: `O arquivo excede ${CSV_MAX_ROWS} linhas.`,
  TOO_MANY_COLUMNS: `O arquivo excede ${CSV_MAX_COLUMNS} colunas.`,
  NO_HEADER: 'Não foi possível ler o cabeçalho do arquivo.',
  NO_DATA_ROWS: 'O arquivo tem cabeçalho, mas nenhuma linha de dados.',
  DUPLICATE_HEADERS: 'O cabeçalho tem colunas com o mesmo nome.',
};

function fail(code: CsvErrorCode): CsvParseResult {
  return { ok: false, error: { code, message: MESSAGES[code] } };
}

/** Escolhe o delimitador que produz mais colunas na primeira linha lógica. */
export function detectDelimiter(sample: string): string {
  const candidates = [',', ';', '\t'];
  let best = ',';
  let bestCount = 0;

  for (const candidate of candidates) {
    const cells = splitRows(sample, candidate)[0]?.length ?? 0;
    if (cells > bestCount) {
      bestCount = cells;
      best = candidate;
    }
  }
  return best;
}

/** Máquina de estados sobre o texto inteiro; não usa split por linha. */
function splitRows(input: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char === '\r') {
      // Consumido junto com o \n seguinte (CRLF) ou ignorado (CR solto).
    } else {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

export function parseCsv(raw: string): CsvParseResult {
  if (raw.length === 0) return fail('EMPTY_FILE');
  // `length` é uma aproximação de bytes suficiente para barrar abuso; o limite
  // real do corpo da requisição é aplicado antes, no servidor.
  if (raw.length > CSV_MAX_BYTES) return fail('TOO_LARGE');

  const text = raw.replace(/^﻿/, '');
  if (text.trim().length === 0) return fail('EMPTY_FILE');

  const delimiter = detectDelimiter(text.slice(0, 8_000));
  const all = splitRows(text, delimiter).filter(
    (row) => row.length > 1 || (row[0] ?? '').trim().length > 0,
  );

  const headerRow = all[0];
  if (!headerRow || headerRow.length === 0) return fail('NO_HEADER');
  if (headerRow.length > CSV_MAX_COLUMNS) return fail('TOO_MANY_COLUMNS');

  const headers = headerRow.map((header, index) => {
    const trimmed = header.trim().slice(0, 120);
    return trimmed.length > 0 ? trimmed : `coluna_${index + 1}`;
  });

  const seen = new Set<string>();
  for (const header of headers) {
    const key = header.toLowerCase();
    if (seen.has(key)) return fail('DUPLICATE_HEADERS');
    seen.add(key);
  }

  const body = all.slice(1);
  if (body.length === 0) return fail('NO_DATA_ROWS');
  if (body.length > CSV_MAX_ROWS) return fail('TOO_MANY_ROWS');

  const ragged: number[] = [];
  const rows = body.map((row, index) => {
    if (row.length !== headers.length) ragged.push(index + 2);
    return headers.map((_header, column) =>
      (row[column] ?? '').trim().slice(0, CSV_MAX_CELL_LENGTH),
    );
  });

  return { ok: true, document: { headers, rows, delimiter, ragged } };
}
