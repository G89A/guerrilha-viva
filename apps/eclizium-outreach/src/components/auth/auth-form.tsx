'use client';

import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import type { AuthActionState } from '@/features/auth/action-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export type AuthFormAction = (
  state: AuthActionState,
  formData: FormData,
) => Promise<AuthActionState>;

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="w-full" disabled={pending} aria-busy={pending}>
      {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
      {pending ? pendingLabel : label}
    </Button>
  );
}

export interface AuthFormProps {
  action: AuthFormAction;
  submitLabel: string;
  pendingLabel: string;
  children: (state: AuthActionState) => React.ReactNode;
}

/**
 * Shared shell for the login/register forms: owns the action state, surfaces
 * the non-field error, and performs the redirect only after the server
 * confirmed success.
 */
export function AuthForm({ action, submitLabel, pendingLabel, children }: AuthFormProps) {
  const router = useRouter();
  const [state, formAction] = useActionState<AuthActionState, FormData>(action, null);

  useEffect(() => {
    if (state?.ok) {
      router.replace(state.data.redirectTo);
      // The dashboard is a server component; refresh so it re-reads the session.
      router.refresh();
    }
  }, [state, router]);

  const formError =
    state && !state.ok && state.error.code !== 'VALIDATION_ERROR' ? state.error.message : null;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      {children(state)}

      <SubmitButton label={submitLabel} pendingLabel={pendingLabel} />
    </form>
  );
}

/** Extracts server-side field errors for a given input name. */
export function fieldErrors(state: AuthActionState, name: string): string[] | undefined {
  if (!state || state.ok) return undefined;
  return state.error.fieldErrors?.[name];
}
