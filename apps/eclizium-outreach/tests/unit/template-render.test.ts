import { describe, expect, it } from 'vitest';
import {
  renderTemplateText,
  resolveVariables,
  suggestMapping,
  type VariableMapping,
} from '@/features/messaging/template-render';
import type { TemplateVariable } from '@/features/messaging/template-normalize';

const CONTACT = {
  firstName: 'Ana',
  lastName: 'Souza',
  company: 'Clínica XPTO',
  city: 'Fortaleza',
  segment: 'Saúde',
};

const BODY_VARS: TemplateVariable[] = [
  { key: '1', component: 'body' },
  { key: '2', component: 'body' },
];

describe('resolveVariables', () => {
  it('resolve a partir dos campos do contato, em ordem posicional', () => {
    const mapping: VariableMapping = {
      'body:1': { source: 'contact.firstName' },
      'body:2': { source: 'contact.company' },
    };

    const result = resolveVariables(BODY_VARS, mapping, CONTACT, 'body');
    expect(result).toEqual({ ok: true, values: ['Ana', 'Clínica XPTO'] });
  });

  it('resolve nome completo juntando nome e sobrenome', () => {
    const result = resolveVariables(
      [{ key: '1', component: 'body' }],
      { 'body:1': { source: 'contact.fullName' } },
      CONTACT,
      'body',
    );
    expect(result).toEqual({ ok: true, values: ['Ana Souza'] });
  });

  it('aceita texto fixo', () => {
    const result = resolveVariables(
      [{ key: '1', component: 'body' }],
      { 'body:1': { source: 'literal', value: '10/09 às 14h' } },
      CONTACT,
      'body',
    );
    expect(result).toEqual({ ok: true, values: ['10/09 às 14h'] });
  });

  it('bloqueia quando o campo do contato está vazio', () => {
    const result = resolveVariables(
      [{ key: '1', component: 'body' }],
      { 'body:1': { source: 'contact.company' } },
      { ...CONTACT, company: null },
      'body',
    );
    expect(result).toEqual({ ok: false, missing: ['{{1}}'] });
  });

  it('bloqueia quando o placeholder não tem mapeamento', () => {
    const result = resolveVariables(BODY_VARS, { 'body:1': { source: 'contact.firstName' } }, CONTACT, 'body');
    expect(result).toEqual({ ok: false, missing: ['{{2}}'] });
  });

  it('bloqueia literal vazio ou só espaços', () => {
    for (const value of ['', '   ']) {
      const result = resolveVariables(
        [{ key: '1', component: 'body' }],
        { 'body:1': { source: 'literal', value } },
        CONTACT,
        'body',
      );
      expect(result.ok).toBe(false);
    }
  });

  it('lista todos os placeholders faltando, não apenas o primeiro', () => {
    const result = resolveVariables(BODY_VARS, {}, CONTACT, 'body');
    expect(result).toEqual({ ok: false, missing: ['{{1}}', '{{2}}'] });
  });

  it('separa header de body', () => {
    const variables: TemplateVariable[] = [
      { key: '1', component: 'header' },
      { key: '1', component: 'body' },
    ];
    const mapping: VariableMapping = {
      'header:1': { source: 'contact.city' },
      'body:1': { source: 'contact.firstName' },
    };

    expect(resolveVariables(variables, mapping, CONTACT, 'header')).toEqual({
      ok: true,
      values: ['Fortaleza'],
    });
    expect(resolveVariables(variables, mapping, CONTACT, 'body')).toEqual({
      ok: true,
      values: ['Ana'],
    });
  });

  it('ordena por número, não pela ordem de declaração', () => {
    const variables: TemplateVariable[] = [
      { key: '2', component: 'body' },
      { key: '1', component: 'body' },
    ];
    const mapping: VariableMapping = {
      'body:1': { source: 'literal', value: 'primeiro' },
      'body:2': { source: 'literal', value: 'segundo' },
    };

    expect(resolveVariables(variables, mapping, CONTACT, 'body')).toEqual({
      ok: true,
      values: ['primeiro', 'segundo'],
    });
  });

  it('devolve vazio quando o componente não tem variáveis', () => {
    expect(resolveVariables(BODY_VARS, {}, CONTACT, 'header')).toEqual({ ok: true, values: [] });
  });
});

describe('renderTemplateText', () => {
  it('substitui na posição correta', () => {
    expect(renderTemplateText('Oi {{1}}, da {{2}}.', ['Ana', 'XPTO'])).toBe('Oi Ana, da XPTO.');
  });

  it('mantém o placeholder visível quando falta valor', () => {
    expect(renderTemplateText('Oi {{1}} e {{2}}', ['Ana'])).toBe('Oi Ana e {{2}}');
  });

  it('substitui todas as ocorrências do mesmo índice', () => {
    expect(renderTemplateText('{{1}} e {{1}}', ['Ana'])).toBe('Ana e Ana');
  });

  it('não interpreta o valor substituído como novo placeholder', () => {
    expect(renderTemplateText('{{1}}', ['{{2}}'])).toBe('{{2}}');
  });

  it('deixa o texto intacto quando não há placeholders', () => {
    expect(renderTemplateText('Texto fixo', ['x'])).toBe('Texto fixo');
  });
});

describe('suggestMapping', () => {
  it('sugere origens distintas, sem aplicar nada sozinha', () => {
    const mapping = suggestMapping([
      { key: '1', component: 'body' },
      { key: '2', component: 'body' },
    ]);
    expect(mapping['body:1']?.source).toBe('contact.firstName');
    expect(mapping['body:2']?.source).toBe('contact.company');
  });

  it('cai em literal quando acabam as sugestões', () => {
    const variables: TemplateVariable[] = Array.from({ length: 6 }, (_value, index) => ({
      key: String(index + 1),
      component: 'body' as const,
    }));
    expect(suggestMapping(variables)['body:6']?.source).toBe('literal');
  });
});
