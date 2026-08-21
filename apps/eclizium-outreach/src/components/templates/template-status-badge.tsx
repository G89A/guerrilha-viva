import { TemplateAvailability, TemplateStatus } from '@prisma/client';
import { Badge } from '@/components/ui/badge';

type Variant = 'default' | 'neutral' | 'success' | 'warning' | 'destructive' | 'outline';

const PRESENTATION: Record<TemplateStatus, { label: string; variant: Variant }> = {
  [TemplateStatus.APPROVED]: { label: 'Aprovado', variant: 'success' },
  [TemplateStatus.PENDING]: { label: 'Em análise', variant: 'warning' },
  [TemplateStatus.REJECTED]: { label: 'Rejeitado', variant: 'destructive' },
  [TemplateStatus.PAUSED]: { label: 'Pausado', variant: 'warning' },
  [TemplateStatus.DISABLED]: { label: 'Desativado', variant: 'neutral' },
  [TemplateStatus.UNKNOWN]: { label: 'Desconhecido', variant: 'neutral' },
};

/**
 * Mostra o status normalizado e, quando a Meta devolveu algo que não
 * reconhecemos, o valor bruto entre parênteses — em vez de esconder que o
 * provider disse outra coisa.
 */
export function TemplateStatusBadge({
  status,
  providerStatus,
  availability,
}: {
  status: TemplateStatus;
  providerStatus?: string | null;
  availability?: TemplateAvailability;
}) {
  const presentation = PRESENTATION[status];
  const showRaw =
    status === TemplateStatus.UNKNOWN && providerStatus && providerStatus.length > 0;

  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge variant={presentation.variant}>
        {presentation.label}
        {showRaw ? ` (${providerStatus})` : ''}
      </Badge>
      {availability === TemplateAvailability.UNAVAILABLE ? (
        <Badge variant="outline">Removido da Meta</Badge>
      ) : null}
    </span>
  );
}
