'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConversationStatus } from '@prisma/client';
import { Button } from '@/components/ui/button';
import { markReadAction, setStatusAction } from '@/app/(dashboard)/inbox/actions';

/**
 * Ações do cabeçalho da conversa.
 *
 * Existe como componente de cliente para que uma recusa do servidor (permissão,
 * conversa de outro workspace) apareça na tela, em vez de sumir silenciosamente
 * como aconteceria com um form action que descarta o retorno.
 */
export function ConversationActions({
  conversationId,
  status,
  unreadCount,
}: {
  conversationId: string;
  status: ConversationStatus;
  unreadCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<'read' | 'status' | null>(null);

  function run(kind: 'read' | 'status', operation: () => Promise<{ ok: boolean; error?: { message: string } }>) {
    if (pending || running) return;
    setRunning(kind);
    setError(null);

    void operation()
      .then((result) => {
        if (!result.ok && result.error) setError(result.error.message);
        else startTransition(() => router.refresh());
      })
      .finally(() => setRunning(null));
  }

  const busy = pending || running !== null;
  const nextStatus =
    status === ConversationStatus.CLOSED ? ConversationStatus.OPEN : ConversationStatus.CLOSED;

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {unreadCount > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              run('read', () => {
                const data = new FormData();
                data.set('conversationId', conversationId);
                return markReadAction(data);
              })
            }
          >
            {running === 'read' ? 'Marcando…' : `Marcar como lida (${unreadCount})`}
          </Button>
        ) : null}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() =>
            run('status', () => {
              const data = new FormData();
              data.set('conversationId', conversationId);
              data.set('status', nextStatus);
              return setStatusAction(data);
            })
          }
        >
          {running === 'status'
            ? 'Aplicando…'
            : status === ConversationStatus.CLOSED
              ? 'Reabrir'
              : 'Fechar'}
        </Button>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
