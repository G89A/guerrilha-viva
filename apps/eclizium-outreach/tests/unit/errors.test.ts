import { describe, expect, it } from 'vitest';
import { AppError, isAppError } from '@/lib/errors/app-error';
import { runAction } from '@/lib/errors/result';

describe('AppError', () => {
  it('maps codes to HTTP status', () => {
    expect(AppError.unauthenticated().status).toBe(401);
    expect(AppError.forbidden().status).toBe(403);
    expect(AppError.notFound().status).toBe(404);
    expect(AppError.conflict('dup').status).toBe(409);
    expect(AppError.notConfigured('missing').status).toBe(503);
    expect(AppError.internal().status).toBe(500);
  });

  it('is detected by the type guard', () => {
    expect(isAppError(AppError.forbidden())).toBe(true);
    expect(isAppError(new Error('plain'))).toBe(false);
  });
});

describe('runAction', () => {
  it('wraps a successful result', async () => {
    await expect(runAction('test.ok', async () => 42)).resolves.toEqual({ ok: true, data: 42 });
  });

  it('passes an AppError through with its code and field errors', async () => {
    const result = await runAction('test.validation', async () => {
      throw AppError.validation('Dados inválidos.', { email: ['E-mail inválido.'] });
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Dados inválidos.',
        fieldErrors: { email: ['E-mail inválido.'] },
      },
    });
  });

  it('never leaks the message of an unexpected error', async () => {
    const result = await runAction('test.boom', async () => {
      throw new Error('connection string postgres://user:pw@host/db');
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
    expect(result.error.message).toBe('Erro interno.');
    expect(JSON.stringify(result)).not.toContain('postgres://');
  });
});
