import { describe, expect, it } from 'vitest';
import { CSV_MAX_ROWS, detectDelimiter, parseCsv } from '@/features/contacts/csv/parse';

function ok(raw: string) {
  const result = parseCsv(raw);
  if (!result.ok) throw new Error(`esperava sucesso, veio ${result.error.code}`);
  return result.document;
}

function errorCode(raw: string) {
  const result = parseCsv(raw);
  return result.ok ? null : result.error.code;
}

describe('parseCsv', () => {
  it('lê cabeçalho e linhas com vírgula', () => {
    const document = ok('nome,telefone\nJoão,85999999999\nMaria,85988888888');
    expect(document.headers).toEqual(['nome', 'telefone']);
    expect(document.rows).toEqual([
      ['João', '85999999999'],
      ['Maria', '85988888888'],
    ]);
  });

  it.each([
    [';', 'nome;telefone\nJoão;85999999999'],
    ['\t', 'nome\ttelefone\nJoão\t85999999999'],
  ])('detecta o separador %j', (delimiter, raw) => {
    const document = ok(raw);
    expect(document.delimiter).toBe(delimiter);
    expect(document.headers).toEqual(['nome', 'telefone']);
  });

  it('respeita aspas com separador dentro do campo', () => {
    const document = ok('nome,empresa\n"Silva, João","ACME, Ltda"');
    expect(document.rows[0]).toEqual(['Silva, João', 'ACME, Ltda']);
  });

  it('interpreta aspas escapadas', () => {
    const document = ok('nome\n"Ele disse ""oi"""');
    expect(document.rows[0]?.[0]).toBe('Ele disse "oi"');
  });

  it('aceita quebra de linha dentro de campo entre aspas', () => {
    const document = ok('nome,obs\nJoão,"linha 1\nlinha 2"');
    expect(document.rows).toHaveLength(1);
    expect(document.rows[0]?.[1]).toBe('linha 1\nlinha 2');
  });

  it('lida com CRLF', () => {
    const document = ok('nome,telefone\r\nJoão,85999999999\r\n');
    expect(document.rows).toEqual([['João', '85999999999']]);
  });

  it('remove BOM do início', () => {
    const document = ok('﻿nome,telefone\nJoão,85999999999');
    expect(document.headers[0]).toBe('nome');
  });

  it('preserva acentos e caracteres especiais', () => {
    const document = ok('nome,cidade\nJosé Ção,São Paulo — Zona Sul');
    expect(document.rows[0]).toEqual(['José Ção', 'São Paulo — Zona Sul']);
  });

  it('preenche linhas com colunas faltando e as reporta', () => {
    const document = ok('a,b,c\n1,2,3\n4,5');
    expect(document.rows[1]).toEqual(['4', '5', '']);
    expect(document.ragged).toEqual([3]);
  });

  it('nomeia colunas de cabeçalho vazio', () => {
    const document = ok('nome,,telefone\nJoão,x,85999999999');
    expect(document.headers[1]).toBe('coluna_2');
  });

  it.each([
    ['arquivo vazio', '', 'EMPTY_FILE'],
    ['só espaços', '   \n  ', 'EMPTY_FILE'],
    ['só cabeçalho', 'nome,telefone', 'NO_DATA_ROWS'],
    ['cabeçalhos duplicados', 'nome,nome\n1,2', 'DUPLICATE_HEADERS'],
  ])('rejeita %s', (_label, raw, code) => {
    expect(errorCode(raw)).toBe(code);
  });

  it('trata cabeçalhos duplicados sem diferenciar caixa', () => {
    expect(errorCode('Nome,NOME\n1,2')).toBe('DUPLICATE_HEADERS');
  });

  it('rejeita arquivo acima do limite de linhas', () => {
    const raw = ['telefone', ...Array.from({ length: CSV_MAX_ROWS + 1 }, (_, i) => `8599999${i}`)].join(
      '\n',
    );
    expect(errorCode(raw)).toBe('TOO_MANY_ROWS');
  });

  it('rejeita arquivo com colunas demais', () => {
    const raw = `${Array.from({ length: 61 }, (_, i) => `c${i}`).join(',')}\n1`;
    expect(errorCode(raw)).toBe('TOO_MANY_COLUMNS');
  });

  it('não executa conteúdo: fórmula permanece texto', () => {
    const document = ok('nome\n=SUM(A1:A9)');
    expect(document.rows[0]?.[0]).toBe('=SUM(A1:A9)');
  });

  it('ignora linhas em branco no meio do arquivo', () => {
    const document = ok('nome,telefone\nJoão,1\n\nMaria,2\n');
    expect(document.rows).toHaveLength(2);
  });
});

describe('detectDelimiter', () => {
  it('escolhe o separador que produz mais colunas', () => {
    expect(detectDelimiter('a;b;c;d')).toBe(';');
    expect(detectDelimiter('a,b,c,d')).toBe(',');
  });

  it('cai na vírgula quando não há separador algum', () => {
    expect(detectDelimiter('coluna-unica')).toBe(',');
  });
});
