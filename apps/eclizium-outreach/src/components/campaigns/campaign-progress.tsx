import { Badge } from '@/components/ui/badge';
import type { CampaignQueueStatus } from '@/features/campaigns/execution-service';
import type { CampaignMetrics } from '@/features/campaigns/metrics';

/**
 * Progresso do disparo.
 *
 * Mostra o que já saiu, o que está na fila e o que morreu na dead-letter. Um
 * número aqui nunca é estimado: todos vêm da agregação sobre destinatários e da
 * profundidade real da fila.
 */
export function CampaignProgress({
  metrics,
  queue,
}: {
  metrics: CampaignMetrics;
  queue: CampaignQueueStatus;
}) {
  const processados = metrics.sent + metrics.delivered + metrics.read + metrics.replied;
  const total = metrics.eligible + processados + metrics.failed + metrics.queued + metrics.sending;
  const percent = total === 0 ? 0 : Math.round((processados / total) * 100);

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 flex items-baseline justify-between text-sm">
          <span className="font-medium">Progresso do disparo</span>
          <span className="tabular-nums text-muted-foreground">
            {processados.toLocaleString('pt-BR')} de {total.toLocaleString('pt-BR')} ({percent}%)
          </span>
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progresso do disparo"
        >
          <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 text-xs">
        <Badge variant="neutral">Na fila: {queue.pending.toLocaleString('pt-BR')}</Badge>
        {queue.leased > 0 ? (
          <Badge variant="warning">Em processamento: {queue.leased.toLocaleString('pt-BR')}</Badge>
        ) : null}
        {queue.failed > 0 ? (
          <Badge variant="warning">
            Aguardando nova tentativa: {queue.failed.toLocaleString('pt-BR')}
          </Badge>
        ) : null}
        {queue.dead > 0 ? (
          <Badge variant="destructive">
            Desistidos: {queue.dead.toLocaleString('pt-BR')}
          </Badge>
        ) : null}
      </div>

      {queue.pending > 0 || queue.leased > 0 ? (
        <p className="text-xs text-muted-foreground">
          O envio acontece em segundo plano, respeitando o limite de vazão do canal. Atualize a
          página para ver o andamento.
        </p>
      ) : null}
    </div>
  );
}
