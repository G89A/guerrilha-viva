import { describe, expect, it } from 'vitest';
import { TemplateCategory, TemplateHeaderFormat, TemplateStatus } from '@prisma/client';
import {
  bodyVariableCount,
  extractVariables,
  normalizeHeaderFormat,
  normalizeTemplateCategory,
  normalizeTemplateStatus,
} from '@/features/messaging/template-normalize';

describe('normalizeTemplateStatus', () => {
  it.each([
    ['APPROVED', TemplateStatus.APPROVED],
    ['PENDING', TemplateStatus.PENDING],
    ['IN_APPEAL', TemplateStatus.PENDING],
    ['REJECTED', TemplateStatus.REJECTED],
    ['PAUSED', TemplateStatus.PAUSED],
    ['DISABLED', TemplateStatus.DISABLED],
    ['DELETED', TemplateStatus.DISABLED],
  ])('mapeia %s', (raw, expected) => {
    expect(normalizeTemplateStatus(raw)).toBe(expected);
  });

  it('aceita variação de caixa e espaços', () => {
    expect(normalizeTemplateStatus('  approved ')).toBe(TemplateStatus.APPROVED);
  });

  it('um status novo da Meta vira UNKNOWN em vez de quebrar', () => {
    expect(normalizeTemplateStatus('ESTADO_QUE_NAO_EXISTE_AINDA')).toBe(TemplateStatus.UNKNOWN);
    expect(normalizeTemplateStatus(null)).toBe(TemplateStatus.UNKNOWN);
    expect(normalizeTemplateStatus('')).toBe(TemplateStatus.UNKNOWN);
  });

  it('nunca promove um status desconhecido a APPROVED', () => {
    for (const raw of ['APROVADO', 'OK', 'ACTIVE', 'LIVE', 'approved_maybe']) {
      expect(normalizeTemplateStatus(raw)).not.toBe(TemplateStatus.APPROVED);
    }
  });
});

describe('normalizeTemplateCategory', () => {
  it.each([
    ['MARKETING', TemplateCategory.MARKETING],
    ['UTILITY', TemplateCategory.UTILITY],
    ['TRANSACTIONAL', TemplateCategory.UTILITY],
    ['AUTHENTICATION', TemplateCategory.AUTHENTICATION],
    ['OTP', TemplateCategory.AUTHENTICATION],
    ['CATEGORIA_NOVA', TemplateCategory.UNKNOWN],
    [null, TemplateCategory.UNKNOWN],
  ])('mapeia %s', (raw, expected) => {
    expect(normalizeTemplateCategory(raw)).toBe(expected);
  });
});

describe('normalizeHeaderFormat', () => {
  it.each([
    ['TEXT', TemplateHeaderFormat.TEXT],
    ['IMAGE', TemplateHeaderFormat.IMAGE],
    ['VIDEO', TemplateHeaderFormat.VIDEO],
    ['DOCUMENT', TemplateHeaderFormat.DOCUMENT],
    ['LOCATION', TemplateHeaderFormat.LOCATION],
    ['CARROSSEL_FUTURO', TemplateHeaderFormat.UNKNOWN],
  ])('mapeia %s', (raw, expected) => {
    expect(normalizeHeaderFormat(raw)).toBe(expected);
  });

  it('devolve null quando não há header', () => {
    expect(normalizeHeaderFormat(null)).toBeNull();
    expect(normalizeHeaderFormat('')).toBeNull();
  });
});

describe('extractVariables', () => {
  it('extrai placeholders do corpo em ordem numérica', () => {
    const variables = extractVariables({ body: 'Oi {{2}}, aqui é {{1}}.' });
    expect(variables.map((variable) => variable.key)).toEqual(['1', '2']);
    expect(variables.every((variable) => variable.component === 'body')).toBe(true);
  });

  it('separa header de body', () => {
    const variables = extractVariables({ headerText: 'Olá {{1}}', body: 'Sobre {{1}} e {{2}}' });
    expect(variables).toEqual([
      { key: '1', component: 'header' },
      { key: '1', component: 'body' },
      { key: '2', component: 'body' },
    ]);
  });

  it('não repete o mesmo placeholder usado duas vezes', () => {
    expect(extractVariables({ body: '{{1}} e de novo {{1}}' })).toHaveLength(1);
  });

  it('tolera espaços dentro das chaves', () => {
    expect(extractVariables({ body: '{{ 1 }}' }).map((v) => v.key)).toEqual(['1']);
  });

  it.each([
    ['sem placeholders', 'Mensagem fixa'],
    ['chave simples', 'Olá {1}'],
    ['chave não numérica', 'Olá {{nome}}'],
    ['vazio', ''],
  ])('devolve lista vazia para %s', (_label, body) => {
    expect(extractVariables({ body })).toEqual([]);
  });

  it('conta apenas as variáveis do corpo', () => {
    const variables = extractVariables({ headerText: '{{1}}', body: '{{1}} {{2}}' });
    expect(bodyVariableCount(variables)).toBe(2);
  });
});
