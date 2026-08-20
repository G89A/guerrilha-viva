import { describe, expect, it } from 'vitest';
import { loginSchema, registerSchema } from '@/features/auth/schemas';
import { isAppError } from '@/lib/errors/app-error';
import { formDataToObject, parseOrThrow } from '@/lib/validation/parse';

describe('registerSchema', () => {
  it('normalises email casing and trims names', () => {
    const parsed = parseOrThrow(registerSchema, {
      name: '  Ana Souza  ',
      email: '  Ana@Example.COM ',
      password: 'senha-forte-1',
      workspaceName: '  Acme  ',
    });

    expect(parsed.email).toBe('ana@example.com');
    expect(parsed.name).toBe('Ana Souza');
    expect(parsed.workspaceName).toBe('Acme');
  });

  it.each([
    ['short', 'abc1'],
    ['letters only', 'senhasemnumero'],
    ['digits only', '1234567890'],
  ])('rejects a weak password (%s)', (_label, password) => {
    expect(() =>
      parseOrThrow(registerSchema, {
        name: 'Ana',
        email: 'ana@example.com',
        password,
        workspaceName: 'Acme',
      }),
    ).toThrow();
  });

  it('reports field-level errors on the AppError', () => {
    try {
      parseOrThrow(registerSchema, { name: 'A', email: 'nope', password: 'x', workspaceName: '' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(isAppError(error)).toBe(true);
      if (!isAppError(error)) return;
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(Object.keys(error.fieldErrors ?? {}).sort()).toEqual([
        'email',
        'name',
        'password',
        'workspaceName',
      ]);
    }
  });
});

describe('loginSchema', () => {
  it('accepts a legacy password that would fail the signup policy', () => {
    const parsed = parseOrThrow(loginSchema, { email: 'a@b.com', password: 'old' });
    expect(parsed.password).toBe('old');
  });

  it('rejects an empty password', () => {
    expect(() => parseOrThrow(loginSchema, { email: 'a@b.com', password: '' })).toThrow();
  });
});

describe('formDataToObject', () => {
  it('converts entries and collapses repeats into arrays', () => {
    const formData = new FormData();
    formData.set('email', 'a@b.com');
    formData.append('tag', 'x');
    formData.append('tag', 'y');

    expect(formDataToObject(formData)).toEqual({ email: 'a@b.com', tag: ['x', 'y'] });
  });

  it('ignores extra fields not present in the schema', () => {
    const formData = new FormData();
    formData.set('email', 'a@b.com');
    formData.set('password', 'qualquer');
    formData.set('isAdmin', 'true');

    const parsed = parseOrThrow(loginSchema, formDataToObject(formData));
    expect(parsed).toEqual({ email: 'a@b.com', password: 'qualquer' });
    expect('isAdmin' in parsed).toBe(false);
  });
});
