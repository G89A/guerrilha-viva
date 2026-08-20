'use client';

import { loginAction } from '@/app/(auth)/actions';
import { AuthForm, fieldErrors } from '@/components/auth/auth-form';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

export function LoginForm() {
  return (
    <AuthForm action={loginAction} submitLabel="Entrar" pendingLabel="Entrando…">
      {(state) => (
        <>
          <Field id="email" label="E-mail" errors={fieldErrors(state, 'email')}>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              aria-describedby="email-error"
              aria-invalid={Boolean(fieldErrors(state, 'email'))}
              placeholder="voce@empresa.com"
            />
          </Field>

          <Field id="password" label="Senha" errors={fieldErrors(state, 'password')}>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={256}
              aria-describedby="password-error"
              aria-invalid={Boolean(fieldErrors(state, 'password'))}
            />
          </Field>
        </>
      )}
    </AuthForm>
  );
}
