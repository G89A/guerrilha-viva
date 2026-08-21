'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  deleteQuickReplyAction,
  saveQuickReplyAction,
} from '@/app/(dashboard)/settings/quick-replies/actions';
import type { QuickReplyItem } from '@/features/messaging/quick-reply-service';
import type { ActionResult } from '@/lib/errors/result';

/**
 * Cadastro de respostas rápidas.
 *
 * Texto puro, sem variáveis: substituição de variável tem política própria
 * (campanha) e trazê-la para cá sem essa política produziria mensagem com
 * lacuna visível para uma pessoa real.
 */
export function QuickReplyManager({ items }: { items: QuickReplyItem[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [editing, setEditing] = useState<QuickReplyItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [state, formAction, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(
    saveQuickReplyAction,
    null,
  );

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setEditing(null);
      router.refresh();
    }
  }, [state, router]);

  function remove(id: string) {
    setDeleteError(null);
    const data = new FormData();
    data.set('id', id);
    void deleteQuickReplyAction(data).then((result) => {
      if (!result.ok) setDeleteError(result.error.message);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{editing ? 'Editar resposta rápida' : 'Nova resposta rápida'}</CardTitle>
          <CardDescription>
            Atalhos de texto para a Inbox. Inserir uma resposta rápida preenche o campo — o envio
            continua sendo um ato explícito de quem atende.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form ref={formRef} action={formAction} className="space-y-3">
            {editing ? <input type="hidden" name="id" value={editing.id} /> : null}

            <div className="space-y-1.5">
              <label htmlFor="quick-title" className="text-sm font-medium">
                Título
              </label>
              <Input
                id="quick-title"
                name="title"
                required
                maxLength={60}
                defaultValue={editing?.title ?? ''}
                placeholder="Ex.: Horário de atendimento"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="quick-body" className="text-sm font-medium">
                Texto
              </label>
              <textarea
                id="quick-body"
                name="body"
                rows={3}
                required
                maxLength={1000}
                defaultValue={editing?.body ?? ''}
                className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--color-ring]"
              />
            </div>

            {state && !state.ok ? (
              <p className="text-sm text-destructive">{state.error.message}</p>
            ) : null}

            <div className="flex gap-2">
              <Button type="submit" disabled={pending}>
                {pending ? 'Salvando…' : editing ? 'Salvar alterações' : 'Adicionar'}
              </Button>
              {editing ? (
                <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                  Cancelar
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cadastradas</CardTitle>
          <CardDescription>{items.length} resposta(s) rápida(s) neste workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          {deleteError ? <p className="mb-2 text-sm text-destructive">{deleteError}</p> : null}

          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma resposta rápida ainda.</p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                      {item.body}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditing(item)}
                    >
                      Editar
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remover ${item.title}`}
                      onClick={() => remove(item.id)}
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
