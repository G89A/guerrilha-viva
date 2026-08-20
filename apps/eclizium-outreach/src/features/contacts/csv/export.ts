/**
 * Serialização de CSV com proteção contra fórmula.
 *
 * Uma célula começando com `=`, `+`, `-`, `@`, TAB ou CR é executada como
 * fórmula por Excel, LibreOffice e Google Sheets ao abrir o arquivo. Como os
 * dados vêm de importação de terceiros, prefixamos com apóstrofo antes de
 * exportar — o valor continua legível e deixa de ser executável.
 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function escapeCsvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  const neutralized = FORMULA_PREFIX.test(text) ? `'${text}` : text;

  return /[",\n\r;]/.test(neutralized) ? `"${neutralized.replace(/"/g, '""')}"` : neutralized;
}

export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) lines.push(row.map(escapeCsvCell).join(','));
  return lines.join('\r\n');
}
