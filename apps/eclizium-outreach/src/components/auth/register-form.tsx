'use client';

import { registerAction } from '@/app/(auth)/actions';
import { AuthForm, fieldErrors } from '@/components/auth/auth-form';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

export function RegisterForm() {
  return (
    <AuthForm action={registerAction} submitLabel="Criar conta" pendingLabel="Criando conta…">
      {(state) => (
        <>
          <Field id="name" label="Seu nome" errors={fieldErrors(state, 'name')}>
            <Input
              id="name"
              name="name"
              autoComplete="name"
              required
              maxLength={120}
              aria-describedby="name-error"
              aria-invalid={Boolean(fieldErrors(state, 'name'))}
            />
          </Field>

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

          <Field
            id="workspaceName"
            label="Nome do workspace"
            hint="Normalmente o nome da sua empresa ou operação."
            errors={fieldErrors(state, 'workspaceName')}
          >
            <Input
              id="workspaceName"
              name="workspaceName"
              autoComplete="organization"
              required
              maxLength={80}
              aria-describedby="workspaceName-error"
              aria-invalid={Boolean(fieldErrors(state, 'workspaceName'))}
            />
          </Field>

          <Field
            id="password"
            label="Senha"
            hint="Mínimo de 10 caracteres, com ao menos uma letra e um número."
            errors={fieldErrors(state, 'password')}
          >
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
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
