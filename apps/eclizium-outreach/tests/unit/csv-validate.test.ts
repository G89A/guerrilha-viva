import { describe, expect, it } from 'vitest';
import { classifyRows } from '@/features/contacts/csv/validate';
import { escapeCsvCell, toCsv } from '@/features/contacts/csv/export';

const mapping = { phone: 0, firstName: 1, email: 2 } as const;

function classify(rows: string[][], existing?: Set<string>) {
  return classifyRows({
    rows,
    mapping,
    phoneRegion: 'BR',
    ...(existing ? { existingPhones: existing } : {}),
  });
}

describe('classifyRows', () => {
  it('marca linha completa como VALID e normaliza o telefone', () => {
    const result = classify([['85 99999-9999', 'João', 'joao@example.com']]);
    expect(result.rows[0]?.status).toBe('VALID');
    expect(result.rows[0]?.phoneE164).toBe('+5585999999999');
  });

  it('numera as linhas contando o cabeçalho como linha 1', () => {
    const result = classify([
      ['85999999999', 'A', ''],
      ['85988888888', 'B', ''],
    ]);
    expect(result.rows.map((row) => row.lineNumber)).toEqual([2, 3]);
  });

  it('marca telefone inválido como INVALID com motivo', () => {
    const result = classify([['abc', 'João', '']]);
    expect(result.rows[0]?.status).toBe('INVALID');
    expect(result.rows[0]?.reason).toBeTruthy();
  });

  it('marca telefone ausente como INVALID', () => {
    const result = classify([['', 'João', '']]);
    expect(result.rows[0]?.status).toBe('INVALID');
  });

  it('marca e-mail inválido como INVALID mesmo com telefone bom', () => {
    const result = classify([['85999999999', 'João', 'nao-e-email']]);
    expect(result.rows[0]?.status).toBe('INVALID');
    expect(result.rows[0]?.reason).toContain('E-mail');
  });

  it('detecta duplicidade dentro do arquivo, apontando a primeira ocorrência', () => {
    const result = classify([
      ['85999999999', 'João', ''],
      ['(85) 99999-9999', 'João de novo', ''],
    ]);
    expect(result.rows[0]?.status).toBe('VALID');
    expect(result.rows[1]?.status).toBe('DUPLICATE_IN_FILE');
    expect(result.rows[1]?.reason).toContain('linha 2');
  });

  it('detecta duplicidade contra o banco', () => {
    const result = classify(
      [['85999999999', 'João', '']],
      new Set(['+5585999999999']),
    );
    expect(result.rows[0]?.status).toBe('DUPLICATE_IN_DATABASE');
  });

  it('trata duplicidade no arquivo antes da duplicidade no banco', () => {
    const result = classify(
      [
        ['85999999999', 'A', ''],
        ['85999999999', 'B', ''],
      ],
      new Set(['+5585999999999']),
    );
    expect(result.rows[0]?.status).toBe('DUPLICATE_IN_DATABASE');
    expect(result.rows[1]?.status).toBe('DUPLICATE_IN_FILE');
  });

  it('nenhuma linha some: o total bate com a entrada', () => {
    const rows = [
      ['85999999999', 'ok', ''],
      ['lixo', 'inválida', ''],
      ['85999999999', 'dup arquivo', ''],
      ['85977777777', 'dup banco', ''],
    ];
    const result = classify(rows, new Set(['+5585977777777']));

    expect(result.summary).toEqual({
      total: 4,
      valid: 1,
      invalid: 1,
      duplicateInFile: 1,
      duplicateInDatabase: 1,
    });
    expect(result.rows).toHaveLength(rows.length);
  });

  it('lida com arquivo sem nenhuma linha', () => {
    const result = classify([]);
    expect(result.summary.total).toBe(0);
  });
});

describe('escapeCsvCell', () => {
  it.each([
    ['=SUM(A1)', "'=SUM(A1)"],
    ['+1234', "'+1234"],
    ['-1234', "'-1234"],
    ['@import', "'@import"],
  ])('neutraliza fórmula %j', (input, expected) => {
    expect(escapeCsvCell(input)).toBe(expected);
  });

  it('escapa aspas e envolve campos com separador', () => {
    expect(escapeCsvCell('Silva, João')).toBe('"Silva, João"');
    expect(escapeCsvCell('disse "oi"')).toBe('"disse ""oi"""');
    expect(escapeCsvCell('linha1\nlinha2')).toBe('"linha1\nlinha2"');
  });

  it('deixa texto comum intacto', () => {
    expect(escapeCsvCell('João')).toBe('João');
    expect(escapeCsvCell(42)).toBe('42');
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
  });

  it('neutraliza fórmula mesmo quando o campo também precisa de aspas', () => {
    const cell = escapeCsvCell('=HYPERLINK("http://evil","clique")');
    expect(cell.startsWith('"\'=')).toBe(true);
  });
});

describe('toCsv', () => {
  it('gera cabeçalho e linhas com CRLF', () => {
    expect(toCsv(['a', 'b'], [[1, 2]])).toBe('a,b\r\n1,2');
  });

  it('protege dados vindos de importação ao exportar', () => {
    const csv = toCsv(['nome'], [['=cmd|calc']]);
    expect(csv).toContain("'=cmd|calc");
  });
});
