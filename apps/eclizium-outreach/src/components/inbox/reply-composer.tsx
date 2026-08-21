'use client';

import { useActionState, useEffect, useRef } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { sendReplyAction, type ReplyResult } from '@/app/(dashboard)/inbox/actions';
import { MAX_REPLY_LENGTH } from '@/features/messaging/reply-constants';
import type { ActionResult } from '@/lib/errors/result';

/**
 * Caixa de resposta.
 *
 * Fora da janela de 24 horas da Meta o campo é desabilitado com a explicação —
 * em vez de deixar o usuário escrever e receber uma recusa depois.
 */
export function ReplyComposer({
  conversationId,
  windowOpen,
  windowExpiresAt,
  canReply,
}: {
  conversationId: string;
  windowOpen: boolean;
  windowExpiresAt: Date | null;
  canReply: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionResult<ReplyResult> | null, FormData>(
    sendReplyAction,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);

  // Limpa o campo só quando o envio realmente deu certo.
  useEffect(() => {
    if (state?.ok && state.data.status === 'SENT') formRef.current?.reset();
  }, [state]);

  if (!canReply) {
    return (
      <div className="border-t border-border p-4">
        <p className="text-sm text-muted-foreground">
          Seu papel neste workspace não permite responder conversas.
        </p>
      </div>
    );
  }

  if (!windowOpen) {
    return (
      <div className="border-t border-border p-4">
        <Alert variant="warning">
          <AlertDescription>
            A janela de 24 horas desde a última mensagem do contato
            {windowExpiresAt ? ` expirou em ${windowExpiresAt.toLocaleString('pt-BR')}` : ' não está aberta'}.
            A Meta só permite texto livre dentro dessa janela; fora dela é preciso usar um template
            aprovado.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const result = state?.ok ? state.data : null;

  return (
    <div className="border-t border-border">
      {state && !state.ok ? (
        <Alert variant="destructive" className="m-3 mb-0">
          <AlertDescription>{state.error.message}</AlertDescription>
        </Alert>
      ) : null}

      {result?.status === 'BLOCKED' ? (
        <Alert variant="warning" className="m-3 mb-0">
          <AlertDescription>{result.reason}</AlertDescription>
        </Alert>
      ) : null}

      {result?.status === 'FAILED' ? (
        <Alert variant="destructive" className="m-3 mb-0">
          <AlertDescription>
            {result.error}
            {result.retryable ? ' Você pode tentar novamente em alguns minutos.' : ''}
          </AlertDescription>
        </Alert>
      ) : null}

      <form ref={formRef} action={formAction} className="flex items-end gap-2 p-3">
        <input type="hidden" name="conversationId" value={conversationId} />
        <textarea
          name="text"
          rows={2}
          required
          maxLength={MAX_REPLY_LENGTH}
          placeholder="Escreva uma resposta…"
          aria-label="Resposta"
          className="min-h-[44px] flex-1 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--color-ring]"
        />
        <Button type="submit" disabled={pending} className="shrink-0">
          <Send aria-hidden="true" className="mr-1 size-4" />
          {pending ? 'Enviando…' : 'Enviar'}
        </Button>
      </form>
    </div>
  );
}
