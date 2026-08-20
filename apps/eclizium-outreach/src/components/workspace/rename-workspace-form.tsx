'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { renameWorkspaceAction } from '@/app/(dashboard)/actions';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { ActionResult } from '@/lib/errors/result';

type State = ActionResult<null> | null;

function SaveButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled} aria-busy={pending}>
      {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
      {pending ? 'Salvando…' : 'Salvar'}
    </Button>
  );
}

export interface RenameWorkspaceFormProps {
  defaultName: string;
  canEdit: boolean;
}

export function RenameWorkspaceForm({ defaultName, canEdit }: RenameWorkspaceFormProps) {
  const [state, formAction] = useActionState<State, FormData>(renameWorkspaceAction, null);
  const lastHandled = useRef<State>(null);

  useEffect(() => {
    if (!state || state === lastHandled.current) return;
    lastHandled.current = state;

    if (state.ok) {
      toast.success('Workspace atualizado.');
    } else if (state.error.code !== 'VALIDATION_ERROR') {
      toast.error('Não foi possível salvar', { description: state.error.message });
    }
  }, [state]);

  const errors = state && !state.ok ? state.error.fieldErrors?.name : undefined;
  const blockingError =
    state && !state.ok && state.error.code === 'FORBIDDEN' ? state.error.message : null;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {blockingError ? (
        <Alert variant="destructive">
          <AlertDescription>{blockingError}</AlertDescription>
        </Alert>
      ) : null}

      <Field id="name" label="Nome do workspace" errors={errors}>
        <Input
          id="name"
          name="name"
          defaultValue={defaultName}
          required
          maxLength={80}
          disabled={!canEdit}
          aria-describedby="name-error"
          aria-invalid={Boolean(errors)}
        />
      </Field>

      {canEdit ? (
        <SaveButton disabled={false} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Apenas administradores e proprietários podem renomear o workspace.
        </p>
      )}
    </form>
  );
}
