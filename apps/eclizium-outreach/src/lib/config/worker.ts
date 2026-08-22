/**
 * Forma do worker neste deploy.
 *
 * Fica fora de `instrumentation.ts` porque quem precisa desta resposta não é só
 * o ponto de partida do servidor: a tela de prontidão também precisa, para
 * orientar de acordo com a instalação que a pessoa tem — e um módulo de domínio
 * não deve importar o entrypoint do Next para descobrir isso.
 */

export const WORKER_IDLE_SLEEP_MS = 2_000;
export const WORKER_BUSY_SLEEP_MS = 100;

/** `true` só quando a variável foi ligada explicitamente. */
export function shouldRunInProcessWorker(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.RUN_WORKER_IN_PROCESS === 'true';
}
