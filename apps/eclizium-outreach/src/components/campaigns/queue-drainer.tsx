'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Play, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { drainQueueAction } from '@/app/(dashboard)/campaigns/actions';

/**
 * Processar a fila agora.
 *
 * Em hospedagem serverless não existe processo de fundo, e o cron gratuito roda
 * uma vez por dia. Sem isto a campanha fica "em execução" e nada sai.
 *
 * O ciclo é o mesmo do worker de fundo — não há caminho de envio paralelo. A
 * diferença é quem dá a partida, e a tela precisa ser explícita quanto a isso:
 * fechou a aba, para. Nada continua sozinho, e prometer o contrário seria
 * mentira.
 */
export function QueueDrainer({
  pending,
  backgroundWorker,
  canOperate,
}: {
  pending: number;
  backgroundWorker: boolean;
  canOperate: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [sent, setSent] = useState(0);
  const [failed, setFailed] = useState(0);
  const [remaining, setRemaining] = useState(pending);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Ref porque o laço roda fora do ciclo de render: ler o estado ali devolveria
  // o valor congelado da primeira volta, e o botão Parar nunca funcionaria.
  const stopped = useRef(false);

  useEffect(() => {
    setRemaining(pending);
  }, [pending]);

  const loop = useCallback(async () => {
    while (!stopped.current) {
      const result = await drainQueueAction();

      if (!result.ok) {
        setError(result.error.message);
        break;
      }

      const data = result.data;
      setSent((total) => total + data.sent);
      setFailed((total) => total + data.failed + data.dead);
      setRemaining(data.pending);

      if (data.pending === 0) {
        setMessage('Fila vazia. Tudo que podia sair, saiu.');
        break;
      }

      if (data.throttled) {
        setMessage(
          'Pausado pelo limite de envio por minuto. Isso é proteção do seu número — espere um pouco e clique de novo.',
        );
        break;
      }

      if (data.sent === 0 && data.skipped === 0 && data.failed === 0 && data.webhooks === 0) {
        setMessage('Nada para processar agora. O que resta está agendado para mais tarde.');
        break;
      }
    }

    setRunning(false);
    startTransition(() => router.refresh());
  }, [router]);

  function start() {
    if (running) return;
    stopped.current = false;
    setRunning(true);
    setError(null);
    setMessage(null);
    setSent(0);
    setFailed(0);
    void loop();
  }

  function stop() {
    stopped.current = true;
    setMessage('Parado por você. O que já saiu, saiu; o resto continua na fila.');
  }

  if (!canOperate || remaining === 0) return null;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <p className="font-medium">
            {remaining.toLocaleString('pt-BR')} mensagem(ns) esperando na fila
          </p>
          <p className="text-muted-foreground">
            {backgroundWorker
              ? 'O worker desta instalação processa sozinho. Este botão só acelera enquanto você olha.'
              : 'Esta instalação não tem processo de fundo: a fila anda enquanto esta aba estiver aberta.'}
          </p>
        </div>

        {running ? (
          <Button type="button" variant="outline" onClick={stop}>
            <Square aria-hidden="true" />
            Parar
          </Button>
        ) : (
          <Button type="button" onClick={start}>
            <Play aria-hidden="true" />
            Processar agora
          </Button>
        )}
      </div>

      {running || sent > 0 || failed > 0 ? (
        <p className="text-sm tabular-nums" aria-live="polite">
          {running ? 'Processando… ' : ''}
          {sent.toLocaleString('pt-BR')} enviada(s)
          {failed > 0 ? `, ${failed.toLocaleString('pt-BR')} com falha` : ''}
        </p>
      ) : null}

      {message ? (
        <Alert>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Não foi possível processar</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
