'use client';

import { useState } from 'react';
import { MediaStatus, MessageDirection, MessageStatus, MessageType } from '@prisma/client';
import { AlertTriangle, Check, CheckCheck, Clock, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn, formatDateTime } from '@/lib/utils';
import { MESSAGE_STATUS_LABELS } from '@/features/messaging/message-status';
import { loadOlderMessagesAction } from '@/app/(dashboard)/inbox/actions';

export interface ThreadMessage {
  id: string;
  direction: MessageDirection;
  type: MessageType;
  status: MessageStatus;
  body: string | null;
  renderedContent: string | null;
  mediaId: string | null;
  mediaMimeType: string | null;
  mediaFilename: string | null;
  mediaCaption: string | null;
  mediaStatus: MediaStatus;
  errorTitle: string | null;
  errorMessage: string | null;
  providerTimestamp: Date | null;
  createdAt: Date;
}

/**
 * Indicador de status das mensagens que NÓS enviamos.
 *
 * Isto é o status do WhatsApp (o destinatário recebeu/leu). Não confundir com
 * o contador de não lidas da conversa, que é da equipe.
 */
function StatusIndicator({ status }: { status: MessageStatus }) {
  const label = MESSAGE_STATUS_LABELS[status];

  if (status === MessageStatus.FAILED) {
    return (
      <span className="inline-flex items-center gap-1 text-destructive" title={label}>
        <AlertTriangle aria-hidden="true" className="size-3" />
        {label}
      </span>
    );
  }

  if (status === MessageStatus.READ) {
    return (
      <span className="inline-flex items-center gap-1 text-primary" title={label}>
        <CheckCheck aria-hidden="true" className="size-3" />
        {label}
      </span>
    );
  }

  if (status === MessageStatus.DELIVERED) {
    return (
      <span className="inline-flex items-center gap-1" title={label}>
        <CheckCheck aria-hidden="true" className="size-3" />
        {label}
      </span>
    );
  }

  if (status === MessageStatus.SENT) {
    return (
      <span className="inline-flex items-center gap-1" title={label}>
        <Check aria-hidden="true" className="size-3" />
        {label}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1" title={label}>
      <Clock aria-hidden="true" className="size-3" />
      {label}
    </span>
  );
}

/**
 * Anexo recebido.
 *
 * O binário é buscado na Meta pelo servidor, sob demanda, e nunca fica
 * guardado. Imagem e vídeo aparecem; o resto vira link para a mesma rota, que
 * só serve tipos de uma allowlist.
 */
function Attachment({ message }: { message: ThreadMessage }) {
  const [failed, setFailed] = useState(false);
  const mime = message.mediaMimeType ?? '';
  const href = `/api/inbox/media/${message.id}`;
  const label = message.mediaFilename ?? message.mediaMimeType ?? 'Anexo';

  const canRender =
    message.direction === MessageDirection.INBOUND && message.mediaId !== null && !failed;

  if (canRender && mime.startsWith('image/')) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element --
         a mídia é servida pela nossa rota autenticada, sob demanda; não há URL
         estável para o otimizador do Next trabalhar em cima. */
      <img
        src={href}
        alt={message.mediaCaption ?? label}
        className="mb-1.5 max-h-64 rounded border border-border object-contain"
        onError={() => setFailed(true)}
      />
    );
  }

  if (canRender && mime.startsWith('audio/')) {
    return <audio controls src={href} className="mb-1.5 w-full" onError={() => setFailed(true)} />;
  }

  if (canRender && mime.startsWith('video/')) {
    return (
      <video
        controls
        src={href}
        className="mb-1.5 max-h-64 w-full rounded border border-border"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className="mb-1.5 flex items-center gap-2 rounded border border-border bg-background/60 px-2 py-1.5 text-xs">
      <Paperclip aria-hidden="true" className="size-3.5 shrink-0" />
      {canRender ? (
        <a href={href} target="_blank" rel="noreferrer" className="truncate underline">
          {label}
        </a>
      ) : (
        <span className="truncate">{label}</span>
      )}
      {failed ? <span className="shrink-0 text-muted-foreground">(indisponível)</span> : null}
    </div>
  );
}

/**
 * Histórico da conversa.
 *
 * TODO o conteúdo aqui vem do WhatsApp e é conteúdo NÃO CONFIÁVEL. É
 * renderizado como texto por interpolação do React, que escapa por padrão.
 * `dangerouslySetInnerHTML` não aparece em nenhum ponto desta árvore — e não
 * deve ser introduzido.
 */
export function MessageThread({
  conversationId,
  messages,
  olderCursor,
}: {
  conversationId: string;
  messages: ThreadMessage[];
  olderCursor: string | null;
}) {
  const [older, setOlder] = useState<ThreadMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(olderCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadOlder() {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);

    const result = await loadOlderMessagesAction({ conversationId, cursor });
    if (result.ok) {
      setOlder((previous) => [...result.data.messages, ...previous]);
      setCursor(result.data.olderCursor);
    } else {
      setError(result.error.message);
    }
    setLoading(false);
  }

  const all = [...older, ...messages];

  if (all.length === 0) {
    return (
      <p className="p-8 text-center text-sm text-muted-foreground">
        Nenhuma mensagem nesta conversa ainda.
      </p>
    );
  }

  return (
    <div>
      {cursor ? (
        <div className="p-3 text-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void loadOlder()}
          >
            {loading ? 'Carregando…' : 'Mensagens anteriores'}
          </Button>
          {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
        </div>
      ) : null}

      <ol className="space-y-3 p-4">
        {all.map((message) => {
          const inbound = message.direction === MessageDirection.INBOUND;
          const content = message.renderedContent ?? message.body;
          const timestamp = message.providerTimestamp ?? message.createdAt;

          return (
            <li key={message.id} className={cn('flex', inbound ? 'justify-start' : 'justify-end')}>
              <div
                className={cn(
                  'max-w-[75%] rounded-lg px-3 py-2 text-sm shadow-sm',
                  inbound
                    ? 'rounded-tl-none bg-muted text-foreground'
                    : 'rounded-tr-none bg-primary/10 text-foreground',
                )}
              >
                {message.mediaStatus !== MediaStatus.NOT_APPLICABLE ? (
                  <Attachment message={message} />
                ) : null}

                {content ? (
                  <p className="whitespace-pre-wrap break-words">{content}</p>
                ) : message.mediaCaption ? (
                  <p className="whitespace-pre-wrap break-words">{message.mediaCaption}</p>
                ) : (
                  <p className="italic text-muted-foreground">
                    {message.type === MessageType.UNSUPPORTED
                      ? 'Tipo de mensagem ainda não suportado'
                      : 'Sem conteúdo de texto'}
                  </p>
                )}

                {message.status === MessageStatus.FAILED && message.errorMessage ? (
                  <p className="mt-1.5 border-t border-destructive/30 pt-1.5 text-xs text-destructive">
                    {message.errorTitle ? `${message.errorTitle}: ` : ''}
                    {message.errorMessage}
                  </p>
                ) : null}

                <div className="mt-1 flex items-center justify-end gap-2 text-[11px] text-muted-foreground">
                  <time dateTime={timestamp.toISOString()} title={formatDateTime(timestamp)}>
                    {timestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </time>
                  {inbound ? null : <StatusIndicator status={message.status} />}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
