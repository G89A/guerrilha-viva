import { describe, expect, it } from 'vitest';
import { shouldRunInProcessWorker } from '@/instrumentation';

describe('worker dentro do processo da aplicação', () => {
  it('fica DESLIGADO por padrão', () => {
    expect(shouldRunInProcessWorker({})).toBe(false);
  });

  it.each([
    ['ausente', undefined],
    ['vazio', ''],
    ['false', 'false'],
    ['1', '1'],
    ['TRUE maiúsculo', 'TRUE'],
    ['sim', 'sim'],
    ['yes', 'yes'],
  ])('não liga com %s — só o valor exato conta', (_label, value) => {
    expect(shouldRunInProcessWorker({ RUN_WORKER_IN_PROCESS: value })).toBe(false);
  });

  it('liga apenas com "true"', () => {
    expect(shouldRunInProcessWorker({ RUN_WORKER_IN_PROCESS: 'true' })).toBe(true);
  });
});
