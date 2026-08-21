'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { type CampaignStatus } from '@prisma/client';
import { FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { EligibilityReport } from '@/components/campaigns/eligibility-report';
import {
  lifecycleAction,
  prepareCampaignAction,
  type PrepareActionResult,
} from '@/app/(dashboard)/campaigns/actions';
import { canPerform } from '@/features/campaigns/campaign-state';

type Busy = 'dry' | 'prepare' | 'start' | 'pause' | 'resume' | 'cancel' | null;

/**
 * Botões de operação da campanha.
 *
 * Cada ação desabilita enquanto roda, e a autorização real é decidida no
 * servidor — a UI apenas evita cliques inúteis. As pré-condições vêm da mesma
 * máquina de estados que o serviço usa, então botão habilitado e ação aceita
 * não podem divergir.
 */
export function CampaignActions({
  campaignId,
  status,
  canOperate,
}: {
  campaignId: string;
  status: CampaignStatus;
  canOperate: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<PrepareActionResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function run(kind: Busy, operation: () => Promise<void>) {
    if (pending || busy) return;
    setBusy(kind);
    setError(null);
    setNotice(null);

    void operation().finally(() => {
      setBusy(null);
      startTransition(() => router.refresh());
    });
  }

  async function prepare(dryRun: boolean) {
    const result = await prepareCampaignAction(campaignId, dryRun);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setReport(result.data);
  }

  async function lifecycle(action: 'start' | 'pause' | 'resume' | 'cancel') {
    const result = await lifecycleAction(campaignId, action);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    if (action === 'start') {
      setNotice(
        'Campanha marcada como em execução. O disparo automático entra na Sprint 5 — ' +
          'nenhuma mensagem foi enfileirada ainda.',
      );
    }
    if (action === 'cancel' && result.data.cancelledRecipients !== undefined) {
      setNotice(`${result.data.cancelledRecipients} destinatário(s) pendente(s) cancelado(s).`);
    }
  }

  const working = pending || busy !== null;

  if (!canOperate) {
    return (
      <p className="text-sm text-muted-foreground">
        Seu papel neste workspace não permite operar campanhas.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={working || !canPerform('prepare', status)}
          onClick={() => run('dry', () => prepare(true))}
        >
          <FlaskConical aria-hidden="true" className="mr-1 size-4" />
          {busy === 'dry' ? 'Rodando ensaio…' : 'Rodar ensaio'}
        </Button>

        <Button
          type="button"
          disabled={working || !canPerform('prepare', status)}
          onClick={() => run('prepare', () => prepare(false))}
        >
          {busy === 'prepare' ? 'Preparando…' : 'Preparar campanha'}
        </Button>

        <Button
          type="button"
          variant="outline"
          disabled={working || !canPerform('start', status)}
          onClick={() => run('start', () => lifecycle('start'))}
        >
          {busy === 'start' ? 'Iniciando…' : 'Iniciar'}
        </Button>

        {canPerform('pause', status) ? (
          <Button
            type="button"
            variant="outline"
            disabled={working}
            onClick={() => run('pause', () => lifecycle('pause'))}
          >
            {busy === 'pause' ? 'Pausando…' : 'Pausar'}
          </Button>
        ) : null}

        {canPerform('resume', status) ? (
          <Button
            type="button"
            variant="outline"
            disabled={working}
            onClick={() => run('resume', () => lifecycle('resume'))}
          >
            {busy === 'resume' ? 'Retomando…' : 'Retomar'}
          </Button>
        ) : null}

        {canPerform('cancel', status) ? (
          <Button
            type="button"
            variant="ghost"
            disabled={working}
            onClick={() => run('cancel', () => lifecycle('cancel'))}
          >
            {busy === 'cancel' ? 'Cancelando…' : 'Cancelar'}
          </Button>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {notice ? (
        <Alert variant="info">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      {report ? (
        <div className="space-y-3 rounded-lg border border-border p-4">
          {report.dryRun ? (
            <Alert variant="info">
              <FlaskConical aria-hidden="true" />
              <AlertTitle>ENSAIO — NENHUMA MENSAGEM SERÁ ENVIADA</AlertTitle>
              <AlertDescription>
                A audiência foi avaliada de ponta a ponta sem gravar destinatários e sem nenhuma
                chamada à Meta.
              </AlertDescription>
            </Alert>
          ) : (
            <p className="text-sm text-muted-foreground">
              {report.created.toLocaleString('pt-BR')} destinatário(s) materializado(s) em{' '}
              {(report.durationMs / 1000).toFixed(1)}s.
            </p>
          )}

          <EligibilityReport
            total={report.total}
            eligible={report.eligible}
            suppressed={report.suppressed}
            invalid={report.invalid}
            ineligible={report.ineligible}
            byReason={report.byReason}
          />
        </div>
      ) : null}
    </div>
  );
}
