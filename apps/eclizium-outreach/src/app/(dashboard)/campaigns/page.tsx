import type { Metadata } from 'next';
import Link from 'next/link';
import { Megaphone, Plus } from 'lucide-react';
import { CampaignStatus } from '@prisma/client';
import { PageHeader } from '@/components/layout/page-header';
import { CampaignStatusBadge } from '@/components/campaigns/campaign-status-badge';
import { Pagination } from '@/components/ui/pagination';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { StatCard } from '@/components/ui/stat-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { campaignListFiltersSchema } from '@/features/campaigns/schemas';
import { campaignStatusCounts, queryCampaigns } from '@/features/campaigns/campaign-query';
import { requireWorkspace } from '@/lib/auth/guards';
import { hasAtLeastRole, WorkspaceRole } from '@/lib/auth/roles';
import { formatDateTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Campanhas' };
export const dynamic = 'force-dynamic';

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireWorkspace();
  const raw = await searchParams;

  const parsed = campaignListFiltersSchema.safeParse(raw);
  const filters = parsed.success ? parsed.data : campaignListFiltersSchema.parse({});

  const [page, counts] = await Promise.all([
    queryCampaigns(context.workspace.id, filters),
    campaignStatusCounts(context.workspace.id),
  ]);

  const canCreate = hasAtLeastRole(context.role, WorkspaceRole.ADMIN);
  const hasFilters = Boolean(filters.search || filters.status || filters.templateId);

  return (
    <>
      <PageHeader
        title="Campanhas"
        description={page.total === 1 ? '1 campanha' : `${page.total} campanhas`}
        actions={
          canCreate ? (
            <Button asChild>
              <Link href="/campaigns/new">
                <Plus aria-hidden="true" className="mr-1 size-4" />
                Nova campanha
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Rascunhos" value={counts[CampaignStatus.DRAFT]} />
        <StatCard label="Agendadas" value={counts[CampaignStatus.SCHEDULED]} />
        <StatCard label="Em execução" value={counts[CampaignStatus.RUNNING]} />
        <StatCard label="Concluídas" value={counts[CampaignStatus.COMPLETED]} />
      </div>

      {page.rows.length === 0 ? (
        <EmptyState
          icon={<Megaphone aria-hidden="true" className="size-6" />}
          title={hasFilters ? 'Nenhuma campanha encontrada' : 'Crie sua primeira campanha'}
          description={
            hasFilters
              ? 'Ajuste os filtros para ver outras campanhas.'
              : 'Uma campanha seleciona uma audiência, resolve as variáveis de um template aprovado e mostra exatamente quem vai receber — antes de qualquer envio.'
          }
          action={
            canCreate && !hasFilters ? (
              <Button asChild>
                <Link href="/campaigns/new">Nova campanha</Link>
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campanha</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Destinatários</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead>Criada em</TableHead>
                  <TableHead>Agendada</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.rows.map((campaign) => (
                  <TableRow key={campaign.id}>
                    <TableCell>
                      <Link
                        href={`/campaigns/${campaign.id}`}
                        className="font-medium text-foreground hover:underline"
                      >
                        {campaign.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <CampaignStatusBadge status={campaign.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {campaign.totalRecipients === 0
                        ? '—'
                        : `${campaign.eligibleRecipients.toLocaleString('pt-BR')} / ${campaign.totalRecipients.toLocaleString('pt-BR')}`}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {campaign.template?.name ?? '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(campaign.createdAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {campaign.scheduledAt ? formatDateTime(campaign.scheduledAt) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <Pagination
            label="Paginação de campanhas"
            page={page.page}
            pageCount={page.pageCount}
            total={page.total}
            pageSize={page.pageSize}
          />
        </>
      )}
    </>
  );
}
