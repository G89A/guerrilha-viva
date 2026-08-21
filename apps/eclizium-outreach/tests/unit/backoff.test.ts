import { describe, expect, it } from 'vitest';
import {
  BASE_DELAY_MS,
  MAX_DELAY_MS,
  backoffDelayMs,
  nextRunAt,
} from '@/features/queue/backoff';

/** Gerador determinístico para tornar o jitter testável. */
const always = (value: number) => () => value;

describe('backoffDelayMs', () => {
  it('cresce exponencialmente com o teto do jitter', () => {
    const teto = [1, 2, 3, 4].map((attempt) =>
      backoffDelayMs(attempt, { random: always(1) }),
    );

    expect(teto).toEqual([
      BASE_DELAY_MS,
      BASE_DELAY_MS * 2,
      BASE_DELAY_MS * 4,
      BASE_DELAY_MS * 8,
    ]);
  });

  it('nunca passa do máximo, por mais tentativas que haja', () => {
    for (const attempt of [10, 20, 50, 1000]) {
      expect(backoffDelayMs(attempt, { random: always(1) })).toBeLessThanOrEqual(MAX_DELAY_MS);
    }
  });

  it('o jitter cobre de zero ao teto exponencial', () => {
    expect(backoffDelayMs(3, { random: always(0) })).toBe(0);
    expect(backoffDelayMs(3, { random: always(1) })).toBe(BASE_DELAY_MS * 4);
    expect(backoffDelayMs(3, { random: always(0.5) })).toBe(BASE_DELAY_MS * 2);
  });

  it('espalha jobs que falharam juntos', () => {
    // Cem jobs na mesma tentativa não podem voltar no mesmo instante.
    const atrasos = new Set(
      Array.from({ length: 100 }, () => backoffDelayMs(4)),
    );
    expect(atrasos.size).toBeGreaterThan(50);
  });

  it.each([0, -1, -100, 0.4])('trata tentativa inválida (%s) como a primeira', (attempt) => {
    expect(backoffDelayMs(attempt, { random: always(1) })).toBe(BASE_DELAY_MS);
  });

  it('nunca devolve valor negativo', () => {
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      expect(backoffDelayMs(attempt)).toBeGreaterThanOrEqual(0);
    }
  });

  it('respeita base e teto configurados', () => {
    const delay = backoffDelayMs(5, {
      baseDelayMs: 100,
      maxDelayMs: 500,
      random: always(1),
    });
    expect(delay).toBe(500);
  });
});

describe('nextRunAt', () => {
  it('soma o atraso ao instante atual', () => {
    const agora = new Date('2026-08-21T12:00:00Z');
    const proximo = nextRunAt(1, agora, { random: always(1) });

    expect(proximo.getTime() - agora.getTime()).toBe(BASE_DELAY_MS);
  });

  it('nunca agenda no passado', () => {
    const agora = new Date('2026-08-21T12:00:00Z');
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      expect(nextRunAt(attempt, agora).getTime()).toBeGreaterThanOrEqual(agora.getTime());
    }
  });
});
