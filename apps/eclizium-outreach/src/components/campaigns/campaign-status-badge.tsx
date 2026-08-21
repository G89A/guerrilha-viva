import { CampaignStatus } from '@prisma/client';
import { Badge } from '@/components/ui/badge';
import { CAMPAIGN_STATUS_LABELS } from '@/features/campaigns/campaign-state';

type Variant = 'default' | 'neutral' | 'success' | 'warning' | 'destructive' | 'outline';

const VARIANTS: Record<CampaignStatus, Variant> = {
  [CampaignStatus.DRAFT]: 'neutral',
  [CampaignStatus.PREPARING]: 'warning',
  [CampaignStatus.READY]: 'default',
  [CampaignStatus.SCHEDULED]: 'default',
  [CampaignStatus.RUNNING]: 'success',
  [CampaignStatus.PAUSED]: 'warning',
  [CampaignStatus.COMPLETED]: 'success',
  [CampaignStatus.CANCELLED]: 'neutral',
  [CampaignStatus.FAILED]: 'destructive',
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  return <Badge variant={VARIANTS[status]}>{CAMPAIGN_STATUS_LABELS[status]}</Badge>;
}
