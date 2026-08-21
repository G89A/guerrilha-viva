/**
 * Período e fuso das consultas de analytics.
 *
 * O fuso importa mais do que parece: agrupar por dia em UTC coloca tudo que
 * aconteceu depois das 21h no Brasil no "dia seguinte". Um relatório que erra a
 * fronteira do dia é um relatório que ninguém confere duas vezes — então o fuso
 * é explícito, escolhido por quem lê, e aparece na tela.
 */

export const RANGE_PRESETS = [7, 30, 90] as const;
export type RangeDays = (typeof RANGE_PRESETS)[number];

export const DEFAULT_RANGE_DAYS: RangeDays = 30;
export const DEFAULT_TIME_ZONE = 'UTC';

export interface AnalyticsRange {
  /** Início inclusivo, em UTC. */
  from: Date;
  /** Fim, em UTC. */
  to: Date;
  /** Quantos dias o período cobre. A UI só oferece os presets. */
  days: number;
  timeZone: string;
}

/**
 * Valida o nome do fuso pelo próprio ICU, em vez de manter uma lista.
 *
 * O valor vem da URL, então é entrada não confiável — e vai para o SQL como
 * parâmetro de `AT TIME ZONE`. Um nome inválido faria o PostgreSQL levantar
 * erro no meio da consulta; recusar aqui é mais barato e mais claro.
 */
export function isValidTimeZone(value: string): boolean {
  if (value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function parseRangeDays(value: unknown): RangeDays {
  const parsed = Number(value);
  return (RANGE_PRESETS as readonly number[]).includes(parsed)
    ? (parsed as RangeDays)
    : DEFAULT_RANGE_DAYS;
}

export function parseTimeZone(value: unknown): string {
  return typeof value === 'string' && isValidTimeZone(value) ? value : DEFAULT_TIME_ZONE;
}

/**
 * Constrói o período. `to` é o instante atual, e `from` é o começo do dia,
 * NO FUSO ESCOLHIDO, de `days - 1` dias atrás — assim "7 dias" inclui hoje e as
 * seis datas anteriores completas, que é o que a pessoa espera ao ler o rótulo.
 */
export function buildRange(input: {
  days?: number;
  timeZone?: string;
  now?: Date;
}): AnalyticsRange {
  const days = input.days ?? DEFAULT_RANGE_DAYS;
  const timeZone = input.timeZone && isValidTimeZone(input.timeZone) ? input.timeZone : DEFAULT_TIME_ZONE;
  const now = input.now ?? new Date();

  const startOfToday = startOfDayInZone(now, timeZone);
  const from = new Date(startOfToday.getTime() - (days - 1) * 24 * 60 * 60 * 1000);

  return { from, to: now, days, timeZone };
}

/** Instante UTC correspondente à meia-noite local do dia de `instant`. */
export function startOfDayInZone(instant: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant);

  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0);

  // Diferença entre o relógio local e o UTC no instante dado — isso respeita
  // horário de verão, que um deslocamento fixo não respeitaria.
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') === 24 ? 0 : get('hour'),
    get('minute'),
    get('second'),
  );
  const offsetMs = asUtc - Math.floor(instant.getTime() / 1000) * 1000;

  const localMidnightAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'));
  return new Date(localMidnightAsUtc - offsetMs);
}

/** Rótulos `YYYY-MM-DD` de todos os dias do período, no fuso escolhido. */
export function daysInRange(range: AnalyticsRange): string[] {
  const labels: string[] = [];
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: range.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  for (let index = 0; index < range.days; index += 1) {
    const day = new Date(range.from.getTime() + index * 24 * 60 * 60 * 1000);
    labels.push(formatter.format(day));
  }

  return labels;
}
