/**
 * Cálculo do intervalo entre tentativas.
 *
 * Backoff exponencial com jitter completo. O jitter existe para que N jobs que
 * falharam juntos — por exemplo durante uma indisponibilidade do provider — não
 * voltem todos no mesmo instante e derrubem o serviço de novo assim que ele
 * levantar.
 *
 * Isso é espalhamento de carga, não disfarce: o objetivo é a saúde do sistema e
 * do provider, e o comportamento é determinístico dado o gerador aleatório.
 */

export const BASE_DELAY_MS = 5_000;
export const MAX_DELAY_MS = 30 * 60 * 1000;

export interface BackoffOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Injetável para teste; em produção é `Math.random`. */
  random?: () => number;
}

/**
 * Atraso da próxima tentativa. `attempt` é quantas já falharam (1 = primeira
 * falha), então o primeiro reagendamento usa o intervalo base.
 */
export function backoffDelayMs(attempt: number, options: BackoffOptions = {}): number {
  const base = options.baseDelayMs ?? BASE_DELAY_MS;
  const max = options.maxDelayMs ?? MAX_DELAY_MS;
  const random = options.random ?? Math.random;

  const safeAttempt = Math.max(1, Math.floor(attempt));
  // 2^(n-1) cresce rápido; o teto impede que uma falha longa jogue o job para
  // daqui a dias.
  const exponential = Math.min(max, base * 2 ** (safeAttempt - 1));

  // Full jitter: sorteia dentro de [0, exponential]. Mantém a média crescendo
  // e elimina a sincronia entre jobs que falharam juntos.
  return Math.floor(random() * exponential);
}

export function nextRunAt(
  attempt: number,
  now: Date = new Date(),
  options: BackoffOptions = {},
): Date {
  return new Date(now.getTime() + backoffDelayMs(attempt, options));
}
