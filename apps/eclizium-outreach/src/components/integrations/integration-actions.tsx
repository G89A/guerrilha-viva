'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  disconnectIntegrationAction,
  syncTemplatesAction,
  testConnectionAction,
} from '@/app/(dashboard)/settings/integrations/actions';

type Feedback = { tone: 'info' | 'destructive'; text: string } | null;

/**
 * Botões de operação da integração.
 *
 * Cada ação desabilita o botão enquanto roda — nenhum caminho aqui pode ser
 * disparado duas vezes por duplo clique. A autorização real, ainda assim, é
 * verificada no servidor.
 */
export function IntegrationActions({
  canOperate,
  canConfigure,
  configured,
}: {
  canOperate: boolean;
  canConfigure: boolean;
  configured: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [running, setRunning] = useState<'test' | 'sync' | 'disconnect' | null>(null);

  function run(kind: 'test' | 'sync' | 'disconnect', operation: () => Promise<Feedback>) {
    if (pending || running) return;
    setRunning(kind);
    setFeedback(null);

    void operation()
      .then((result) => {
        setFeedback(result);
        startTransition(() => router.refresh());
      })
      .finally(() => setRunning(null));
  }

  const busy = pending || running !== null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!canOperate || !configured || busy}
          onClick={() =>
            run('test', async () => {
              const result = await testConnectionAction();
              if (!result.ok) return { tone: 'destructive', text: result.error.message };
              return {
                tone: result.data.ok ? 'info' : 'destructive',
                text: result.data.message,
              };
            })
          }
        >
          {running === 'test' ? 'Verificando…' : 'Testar conexão'}
        </Button>

        <Button
          type="button"
          variant="outline"
          disabled={!canOperate || !configured || busy}
          onClick={() =>
            run('sync', async () => {
              const result = await syncTemplatesAction();
              if (!result.ok) return { tone: 'destructive', text: result.error.message };
              const { fetched, created, updated, markedUnavailable } = result.data;
              return {
                tone: 'info',
                text: `${fetched} template(s) na Meta — ${created} novo(s), ${updated} atualizado(s), ${markedUnavailable} marcado(s) como removido(s).`,
              };
            })
          }
        >
          {running === 'sync' ? 'Sincronizando…' : 'Sincronizar templates'}
        </Button>

        {canConfigure && configured ? (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              run('disconnect', async () => {
                const result = await disconnectIntegrationAction();
                return result.ok
                  ? { tone: 'info', text: 'Integração desconectada.' }
                  : { tone: 'destructive', text: result.error.message };
              })
            }
          >
            {running === 'disconnect' ? 'Desconectando…' : 'Desconectar'}
          </Button>
        ) : null}
      </div>

      {!canOperate ? (
        <p className="text-xs text-muted-foreground">
          Seu papel neste workspace não permite operar a integração.
        </p>
      ) : null}

      {feedback ? (
        <Alert variant={feedback.tone === 'info' ? 'info' : 'destructive'}>
          <AlertDescription>{feedback.text}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
