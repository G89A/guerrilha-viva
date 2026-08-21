import { ChannelStatus } from '@prisma/client';
import { Badge } from '@/components/ui/badge';

const PRESENTATION: Record<ChannelStatus, { label: string; variant: 'success' | 'warning' | 'destructive' | 'neutral' }> = {
  [ChannelStatus.CONNECTED]: { label: 'Conectado', variant: 'success' },
  [ChannelStatus.NOT_CONFIGURED]: { label: 'Não configurado', variant: 'neutral' },
  [ChannelStatus.INVALID]: { label: 'Credencial inválida', variant: 'destructive' },
  [ChannelStatus.DISCONNECTED]: { label: 'Desconectado', variant: 'neutral' },
  [ChannelStatus.ERROR]: { label: 'Erro', variant: 'destructive' },
};

export function IntegrationStatusBadge({ status }: { status: ChannelStatus }) {
  const presentation = PRESENTATION[status];
  return <Badge variant={presentation.variant}>{presentation.label}</Badge>;
}
