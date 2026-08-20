import { describe, expect, it } from 'vitest';
import { formatPhone, isValidPhone, normalizePhone, resolveRegion } from '@/features/contacts/phone';

function e164(raw: string, region = 'BR'): string | null {
  const result = normalizePhone(raw, region);
  return result.ok ? result.phone.e164 : null;
}

describe('normalizePhone', () => {
  it.each([
    ['85 99999-9999', '+5585999999999'],
    ['(85) 99999-9999', '+5585999999999'],
    ['85999999999', '+5585999999999'],
    ['+55 85 99999-9999', '+5585999999999'],
    ['+5585999999999', '+5585999999999'],
    ['  85 99999 9999  ', '+5585999999999'],
    ['85.99999.9999', '+5585999999999'],
  ])('normaliza %j para %j', (input, expected) => {
    expect(e164(input)).toBe(expected);
  });

  it('aceita fixo brasileiro de 8 dígitos', () => {
    expect(e164('85 3232-3232')).toBe('+558532323232');
  });

  it('respeita o DDI quando o número já é internacional, ignorando a região', () => {
    expect(e164('+1 415 555 2671', 'BR')).toBe('+14155552671');
  });

  it('usa a região informada para números sem DDI', () => {
    expect(e164('415 555 2671', 'US')).toBe('+14155552671');
  });

  it('devolve país e forma nacional', () => {
    const result = normalizePhone('85 99999-9999', 'BR');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.phone.country).toBe('BR');
    expect(result.phone.national).toContain('85');
  });

  it.each([
    ['vazio', '', 'EMPTY'],
    ['só espaços', '   ', 'EMPTY'],
    ['sem dígitos', 'abcdef', 'UNPARSEABLE'],
    ['alfanumérico', '800-FLOWERS', 'UNPARSEABLE'],
    ['curto demais', '123', 'INVALID_NUMBER'],
    // `00` é lido como prefixo de discagem internacional, não como DDD.
    ['prefixo 00', '00 99999-9999', 'UNPARSEABLE'],
  ])('rejeita %s', (_label, input, code) => {
    const result = normalizePhone(input, 'BR');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(code);
  });

  it('rejeita entrada absurdamente longa antes de chamar o parser', () => {
    const result = normalizePhone('9'.repeat(500), 'BR');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TOO_LONG');
  });

  it('trata null e undefined como vazio', () => {
    expect(normalizePhone(null).ok).toBe(false);
    expect(normalizePhone(undefined).ok).toBe(false);
  });

  it('é idempotente: normalizar o resultado devolve o mesmo E.164', () => {
    const first = e164('85 99999-9999');
    expect(first).not.toBeNull();
    expect(e164(first as string)).toBe(first);
  });

  it('formatos diferentes do mesmo número colidem no mesmo E.164', () => {
    const variants = ['85999999999', '(85) 99999-9999', '+55 85 99999 9999', '85 9 9999-9999'];
    const normalized = new Set(variants.map((variant) => e164(variant)));
    expect(normalized.size).toBe(1);
  });
});

describe('resolveRegion', () => {
  it.each([
    ['br', 'BR'],
    ['BR', 'BR'],
    ['us', 'US'],
    ['', 'BR'],
    ['BRA', 'BR'],
    ['1', 'BR'],
  ])('resolve %j para %j', (input, expected) => {
    expect(resolveRegion(input)).toBe(expected);
  });

  it('cai no padrão para null e undefined', () => {
    expect(resolveRegion(null)).toBe('BR');
    expect(resolveRegion(undefined)).toBe('BR');
  });
});

describe('isValidPhone', () => {
  it('concorda com normalizePhone', () => {
    expect(isValidPhone('85 99999-9999', 'BR')).toBe(true);
    expect(isValidPhone('123', 'BR')).toBe(false);
  });
});

describe('formatPhone', () => {
  it('formata E.164 para exibição', () => {
    expect(formatPhone('+5585999999999')).toBe('+55 85 99999 9999');
  });

  it('devolve travessão para vazio e o próprio valor para entrada não parseável', () => {
    expect(formatPhone(null)).toBe('—');
    expect(formatPhone('')).toBe('—');
    expect(formatPhone('lixo-legado')).toBe('lixo-legado');
  });
});
