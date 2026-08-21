'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/utils';
import { requeueWebhookEventAction } from '@/app/(dashboard)/settings/integrations/actions';
import type {
  FailedWebhookEvent,
  WebhookEventSummary,
} from '@/features/webhooks/event-query';

/**
 * Estado da recepção de webhooks.
 *
 * O processamento é assíncrono desde a Sprint 6, então o que falhou tem de
 * ficar visível — e reprocessável — em vez de sumir num log.
 */
export function WebhookEventsPanel({
  summary,
  failed,
  canRequeue,
}: {
  summary: WebhookEventSummary;
  failed: FailedWebhookEvent[];
  canRequeue: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function requeue(eventId: string) {
    setBusy(eventId);
    setNotice(null);

    const data = new FormData();
    data.set('eventId', eventId);

    void requeueWebhookEventAction(data)
      .then((result) => {
        if (!result.ok) setNotice(result.error.message);
        else if (result.data.reason) setNotice(result.data.reason);
        else {
          setNotice('Evento reenfileirado. O worker aplica no próximo ciclo.');
          router.refresh();
        }
      })
      .finally(() => setBusy(null));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Eventos do webhook</CardTitle>
        <CardDescription>
          Cada entrega da Meta vira um evento durável e um job. Nada é aplicado dentro da
          requisição — o que falha fica aqui, com retentativa.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Metric label="Na fila" value={summary.received} />
          <Metric label="Processando" value={summary.processing} />
          <Metric label="Aplicados" value={summary.processed} />
          <Metric label="Ignorados" value={summary.ignored} />
          <Metric label="Com falha" value={summary.failed} tone={summary.failed > 0 ? 'bad' : undefined} />
        </dl>

        <p className="text-xs text-muted-foreground">
          {summary.lastReceivedAt
            ? `Última entrega recebida em ${formatDateTime(summary.lastReceivedAt)}.`
            : 'Nenhuma entrega recebida ainda neste workspace.'}
        </p>

        {failed.length > 0 ? (
          <div>
            <h3 className="mb-2 text-sm font-medium">Falhas recentes</h3>
            <ul className="divide-y divide-border">
              {failed.map((event) => (
                <li key={event.id} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium">{event.eventType ?? 'Evento'}</p>
                    <p className="mt-0.5 break-words text-xs text-muted-foreground">
                      {event.errorMessage ?? 'Sem detalhe registrado.'}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Recebido em {formatDateTime(event.receivedAt)}
                    </p>
                  </div>
                  {canRequeue ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      disabled={busy !== null}
                      onClick={() => requeue(event.id)}
                    >
                      {busy === event.id ? 'Enfileirando…' : 'Reprocessar'}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'bad';
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">
        <Badge variant={tone === 'bad' ? 'destructive' : 'neutral'}>{value}</Badge>
      </dd>
    </div>
  );
}
