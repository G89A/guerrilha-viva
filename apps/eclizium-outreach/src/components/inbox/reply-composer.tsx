'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Send, Zap } from 'lucide-react';
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
  quickReplies = [],
}: {
  conversationId: string;
  windowOpen: boolean;
  windowExpiresAt: Date | null;
  canReply: boolean;
  quickReplies?: Array<{ id: string; title: string; body: string }>;
}) {
  const [state, formAction, pending] = useActionState<ActionResult<ReplyResult> | null, FormData>(
    sendReplyAction,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [showQuick, setShowQuick] = useState(false);

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
            aprovado — o que hoje se faz por campanha, em <strong>Campanhas</strong>.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const result = state?.ok ? state.data : null;
  const remaining = windowExpiresAt ? windowExpiresAt.getTime() - Date.now() : null;
  const hoursLeft = remaining === null ? null : Math.max(0, Math.floor(remaining / 3_600_000));

  return (
    <div className="border-t border-border">
      {hoursLeft !== null && hoursLeft <= 4 ? (
        <p className="px-3 pt-2 text-xs text-muted-foreground">
          A janela de atendimento fecha em menos de {hoursLeft + 1} h. Depois disso, só template.
        </p>
      ) : null}
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

      {showQuick && quickReplies.length > 0 ? (
        <div className="flex flex-wrap gap-1 border-t border-border px-3 pt-3">
          {quickReplies.map((quick) => (
            <button
              key={quick.id}
              type="button"
              // Preenche o campo. NUNCA envia: mensagem disparada por atalho é
              // mensagem enviada sem querer para uma pessoa real.
              onClick={() => {
                if (textRef.current) {
                  textRef.current.value = quick.body;
                  textRef.current.focus();
                }
                setShowQuick(false);
              }}
              className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
            >
              {quick.title}
            </button>
          ))}
        </div>
      ) : null}

      <form ref={formRef} action={formAction} className="flex items-end gap-2 p-3">
        <input type="hidden" name="conversationId" value={conversationId} />
        {quickReplies.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0"
            aria-label="Respostas rápidas"
            aria-expanded={showQuick}
            onClick={() => setShowQuick((open) => !open)}
          >
            <Zap aria-hidden="true" className="size-4" />
          </Button>
        ) : null}
        <textarea
          ref={textRef}
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
