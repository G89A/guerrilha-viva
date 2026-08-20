import { ConsentStatus, ContactStatus } from '@prisma/client';
import { Badge } from '@/components/ui/badge';

const CONSENT_VARIANT: Record<ConsentStatus, 'success' | 'destructive' | 'neutral'> = {
  [ConsentStatus.GRANTED]: 'success',
  [ConsentStatus.REVOKED]: 'destructive',
  [ConsentStatus.UNKNOWN]: 'neutral',
};

const CONSENT_LABEL: Record<ConsentStatus, string> = {
  [ConsentStatus.GRANTED]: 'Concedido',
  [ConsentStatus.REVOKED]: 'Revogado',
  [ConsentStatus.UNKNOWN]: 'Desconhecido',
};

export function ConsentBadge({ status }: { status: ConsentStatus }) {
  return <Badge variant={CONSENT_VARIANT[status]}>{CONSENT_LABEL[status]}</Badge>;
}

const STATUS_VARIANT: Record<ContactStatus, 'default' | 'neutral' | 'warning'> = {
  [ContactStatus.ACTIVE]: 'default',
  [ContactStatus.ARCHIVED]: 'neutral',
  [ContactStatus.INVALID]: 'warning',
};

const STATUS_LABEL: Record<ContactStatus, string> = {
  [ContactStatus.ACTIVE]: 'Ativo',
  [ContactStatus.ARCHIVED]: 'Arquivado',
  [ContactStatus.INVALID]: 'Inválido',
};

export function ContactStatusBadge({ status }: { status: ContactStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}

/** Só aparece quando há supressão — a ausência não vira um selo "liberado". */
export function SuppressionBadge({ suppressed }: { suppressed: boolean }) {
  if (!suppressed) return null;
  return <Badge variant="destructive">Suprimido</Badge>;
}
