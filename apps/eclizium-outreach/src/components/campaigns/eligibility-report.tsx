import { REASON_LABELS, type CampaignEligibilityReason } from '@/features/campaigns/eligibility';

export interface EligibilityReportProps {
  total: number;
  eligible: number;
  suppressed: number;
  invalid: number;
  ineligible: number;
  byReason: Record<string, number>;
}

/**
 * Relatório de elegibilidade.
 *
 * Mostra o total selecionado, quantos passam e — item a item — por que os
 * demais foram barrados. Nada é escondido: se 400 de 2.000 vão ficar de fora, o
 * operador vê os 400 e o motivo de cada grupo antes de decidir.
 */
export function EligibilityReport(props: EligibilityReportProps) {
  const blocked = props.total - props.eligible;
  const reasons = Object.entries(props.byReason).sort(([, a], [, b]) => b - a);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label="Selecionados" value={props.total} />
        <Metric label="Elegíveis" value={props.eligible} tone="success" />
        <Metric label="Suprimidos" value={props.suppressed} tone="danger" />
        <Metric label="Telefone inválido" value={props.invalid} tone="warning" />
      </div>

      {blocked > 0 ? (
        <div className="rounded-lg border border-border p-4">
          <p className="mb-2 text-sm font-medium">
            {blocked} contato(s) não vão receber. Motivos:
          </p>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {reasons.map(([reason, count]) => (
              <li key={reason} className="flex items-baseline justify-between gap-3">
                <span>{REASON_LABELS[reason as CampaignEligibilityReason] ?? reason}</span>
                <span className="font-mono text-xs tabular-nums">{count}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : props.total > 0 ? (
        <p className="text-sm text-muted-foreground">
          Todos os contatos selecionados estão elegíveis.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nenhum contato corresponde aos filtros escolhidos.
        </p>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  const toneClass = {
    neutral: 'text-foreground',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-destructive',
  }[tone];

  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-2xl font-semibold tabular-nums ${toneClass}`}>
        {value.toLocaleString('pt-BR')}
      </p>
    </div>
  );
}
