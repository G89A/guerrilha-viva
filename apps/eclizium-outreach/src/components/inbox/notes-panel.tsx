'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/utils';
import { addNoteAction } from '@/app/(dashboard)/inbox/actions';
import type { ActionResult } from '@/lib/errors/result';

export interface ConversationNoteItem {
  id: string;
  body: string;
  createdAt: Date;
  author: { id: string; name: string } | null;
}

/**
 * Notas internas da conversa.
 *
 * NADA aqui vai para o WhatsApp. O bloco é deliberadamente diferente do
 * compositor de resposta — cor, ícone e o aviso explícito — porque uma nota
 * confundida com resposta vira uma mensagem que o contato acha que recebeu.
 */
export function NotesPanel({
  conversationId,
  notes,
}: {
  conversationId: string;
  notes: ConversationNoteItem[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const [state, formAction, pending] = useActionState<ActionResult<{ ok: true }> | null, FormData>(
    addNoteAction,
    null,
  );

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);

  return (
    <section className="border-t border-border p-3">
      <h2 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <StickyNote aria-hidden="true" className="size-3.5" />
        Notas internas
      </h2>
      {/* Aviso permanente, não placeholder: placeholder some quando a pessoa
          começa a digitar, que é exatamente o momento em que confundir nota com
          resposta custa caro. */}
      <p className="mb-2 text-[11px] text-muted-foreground">
        Só a equipe vê. Nada aqui é enviado ao contato.
      </p>

      <form ref={formRef} action={formAction} className="space-y-2">
        <input type="hidden" name="conversationId" value={conversationId} />
        <textarea
          name="body"
          rows={2}
          required
          maxLength={2000}
          placeholder="Escreva uma nota para a equipe…"
          aria-label="Nova nota interna"
          className="w-full resize-y rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--color-ring] dark:border-amber-900 dark:bg-amber-950/20"
        />
        <Button type="submit" size="sm" variant="outline" disabled={pending} className="w-full">
          {pending ? 'Salvando…' : 'Salvar nota'}
        </Button>
        {state && !state.ok ? (
          <p className="text-xs text-destructive">{state.error.message}</p>
        ) : null}
      </form>

      {notes.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">Nenhuma nota nesta conversa.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {notes.map((note) => (
            <li
              key={note.id}
              className="rounded border border-amber-200 bg-amber-50 p-2 text-xs dark:border-amber-900 dark:bg-amber-950/20"
            >
              <p className="whitespace-pre-wrap break-words text-foreground">{note.body}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {note.author?.name ?? 'Removido'} · {formatDateTime(note.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
