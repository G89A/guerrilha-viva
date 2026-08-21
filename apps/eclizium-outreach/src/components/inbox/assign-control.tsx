'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { assignAction } from '@/app/(dashboard)/inbox/actions';

/**
 * Responsável pela conversa.
 *
 * A lista de opções vem do servidor, com os membros DESTE workspace, e o
 * servidor revalida a escolha: a opção que chega no `select` não é prova de
 * nada.
 */
export function AssignControl({
  conversationId,
  assigneeId,
  members,
}: {
  conversationId: string;
  assigneeId: string | null;
  members: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function change(value: string) {
    setSaving(true);
    setError(null);

    const data = new FormData();
    data.set('conversationId', conversationId);
    data.set('assigneeId', value);

    void assignAction(data)
      .then((result) => {
        if (!result.ok) setError(result.error.message);
        else startTransition(() => router.refresh());
      })
      .finally(() => setSaving(false));
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <label className="sr-only" htmlFor={`assignee-${conversationId}`}>
        Responsável pela conversa
      </label>
      <select
        id={`assignee-${conversationId}`}
        defaultValue={assigneeId ?? ''}
        disabled={saving || pending}
        onChange={(event) => change(event.currentTarget.value)}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
      >
        <option value="">Sem responsável</option>
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </select>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
