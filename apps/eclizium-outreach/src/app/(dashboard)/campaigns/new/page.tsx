import type { Metadata } from 'next';
import { ChannelStatus } from '@prisma/client';
import { PageHeader } from '@/components/layout/page-header';
import { CampaignWizard } from '@/components/campaigns/campaign-wizard';
import { campaignReadyTemplates } from '@/features/campaigns/campaign-query';
import { audienceFilterOptions } from '@/features/campaigns/audience-service';
import { findChannel } from '@/features/messaging/channel-service';
import { listTags } from '@/features/contacts/tags-service';
import { listContactLists } from '@/features/contacts/lists-service';
import { requireWorkspaceRole } from '@/lib/auth/guards';
import { WorkspaceRole } from '@/lib/auth/roles';

export const metadata: Metadata = { title: 'Nova campanha' };
export const dynamic = 'force-dynamic';

export default async function NewCampaignPage() {
  // Criar campanha exige ADMIN — a barreira é aqui, não só no botão.
  const context = await requireWorkspaceRole(WorkspaceRole.ADMIN);

  const [templates, options, tags, lists, channel] = await Promise.all([
    campaignReadyTemplates(context.workspace.id),
    audienceFilterOptions(context.workspace.id),
    listTags(context.workspace.id),
    listContactLists(context.workspace.id),
    findChannel(context.workspace.id),
  ]);

  return (
    <>
      <PageHeader
        title="Nova campanha"
        description="Nada é enviado aqui. Ao final, a campanha nasce como rascunho."
      />

      <CampaignWizard
        templates={templates}
        channelConnected={channel?.status === ChannelStatus.CONNECTED}
        options={{
          lists: lists.map((list) => ({ id: list.id, name: list.name })),
          tags: tags.map((tag) => ({ id: tag.id, name: tag.name })),
          cities: options.cities,
          states: options.states,
          segments: options.segments,
          sources: options.sources,
        }}
      />
    </>
  );
}
