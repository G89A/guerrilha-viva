import { describe, expect, it } from 'vitest';
import {
  buildRange,
  daysInRange,
  DEFAULT_RANGE_DAYS,
  DEFAULT_TIME_ZONE,
  isValidTimeZone,
  parseRangeDays,
  parseTimeZone,
  startOfDayInZone,
} from '@/features/analytics/range';

describe('validação de fuso', () => {
  it.each(['UTC', 'America/Sao_Paulo', 'Europe/Lisbon', 'Asia/Tokyo'])('aceita %s', (zone) => {
    expect(isValidTimeZone(zone)).toBe(true);
  });

  it.each([
    ['vazio', ''],
    ['inventado', 'Marte/Olympus'],
    ['injeção', "UTC'; DROP TABLE messages; --"],
    ['longo demais', 'A'.repeat(200)],
  ])('recusa %s', (_label, zone) => {
    expect(isValidTimeZone(zone)).toBe(false);
  });

  it('entrada inválida cai no padrão em vez de quebrar', () => {
    expect(parseTimeZone("'; DROP TABLE --")).toBe(DEFAULT_TIME_ZONE);
    expect(parseTimeZone(null)).toBe(DEFAULT_TIME_ZONE);
    expect(parseTimeZone('America/Sao_Paulo')).toBe('America/Sao_Paulo');
  });
});

describe('período', () => {
  it('só aceita os presets; qualquer outro vira o padrão', () => {
    expect(parseRangeDays(7)).toBe(7);
    expect(parseRangeDays('30')).toBe(30);
    expect(parseRangeDays(90)).toBe(90);
    expect(parseRangeDays(999)).toBe(DEFAULT_RANGE_DAYS);
    expect(parseRangeDays(-1)).toBe(DEFAULT_RANGE_DAYS);
    expect(parseRangeDays('abacaxi')).toBe(DEFAULT_RANGE_DAYS);
  });

  it('7 dias inclui hoje e as seis datas anteriores', () => {
    const now = new Date('2026-08-21T15:00:00Z');
    const range = buildRange({ days: 7, timeZone: 'UTC', now });

    expect(range.from.toISOString()).toBe('2026-08-15T00:00:00.000Z');
    expect(daysInRange(range)).toHaveLength(7);
    expect(daysInRange(range).at(0)).toBe('2026-08-15');
    expect(daysInRange(range).at(-1)).toBe('2026-08-21');
  });

  it('a fronteira do dia respeita o fuso escolhido', () => {
    // 02:00 UTC de 21/08 ainda é 23:00 de 20/08 em São Paulo (UTC-3).
    const now = new Date('2026-08-21T02:00:00Z');

    const utc = buildRange({ days: 1, timeZone: 'UTC', now });
    const brasil = buildRange({ days: 1, timeZone: 'America/Sao_Paulo', now });

    expect(daysInRange(utc)).toEqual(['2026-08-21']);
    expect(daysInRange(brasil)).toEqual(['2026-08-20']);
    // O começo do dia brasileiro é 3 horas DEPOIS do começo do dia UTC anterior.
    expect(brasil.from.toISOString()).toBe('2026-08-20T03:00:00.000Z');
  });

  it('início do dia atravessa horário de verão sem deslocamento fixo', () => {
    // Lisboa está em UTC+1 no verão e UTC+0 no inverno.
    const verao = startOfDayInZone(new Date('2026-07-15T12:00:00Z'), 'Europe/Lisbon');
    const inverno = startOfDayInZone(new Date('2026-01-15T12:00:00Z'), 'Europe/Lisbon');

    expect(verao.toISOString()).toBe('2026-07-14T23:00:00.000Z');
    expect(inverno.toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });

  it('os rótulos de 90 dias são únicos e consecutivos', () => {
    const range = buildRange({ days: 90, timeZone: 'America/Sao_Paulo', now: new Date('2026-08-21T15:00:00Z') });
    const labels = daysInRange(range);

    expect(labels).toHaveLength(90);
    expect(new Set(labels).size).toBe(90);
    expect(labels.at(-1)).toBe('2026-08-21');
  });

  it('fuso inválido no build cai no padrão em vez de propagar para o SQL', () => {
    const range = buildRange({ days: 7, timeZone: 'Marte/Olympus' });
    expect(range.timeZone).toBe(DEFAULT_TIME_ZONE);
  });
});
