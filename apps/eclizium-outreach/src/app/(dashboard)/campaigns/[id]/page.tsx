import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { RecipientStatus } from '@prisma/client';
import { PageHeader } from '@/components/layout/page-header';
import { CampaignActions } from '@/components/campaigns/campaign-actions';
import { CampaignStatusBadge } from '@/components/campaigns/campaign-status-badge';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Pagination } from '@/components/ui/pagination';
import { StatCard } from '@/components/ui/stat-card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getCampaignDetail, queryRecipients } from '@/features/campaigns/campaign-query';
import { recipientFiltersSchema } from '@/features/campaigns/schemas';
import { computeCampaignMetrics, computeRates } from '@/features/campaigns/metrics';
import { REASON_LABELS, type CampaignEligibilityReason } from '@/features/campaigns/eligibility';
import { requireWorkspace } from '@/lib/auth/guards';
import { hasAtLeastRole, WorkspaceRole } from '@/lib/auth/roles';
import { formatPhone } from '@/features/contacts/phone';
import { formatDateTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Campanha' };
export const dynamic = 'force-dynamic';

const RECIPIENT_LABELS: Record<RecipientStatus, string> = {
  [RecipientStatus.PENDING]: 'Pendente',
  [RecipientStatus.ELIGIBLE]: 'Elegível',
  [RecipientStatus.SUPPRESSED]: 'Suprimido',
  [RecipientStatus.INVALID]: 'Telefone inválido',
  [RecipientStatus.INELIGIBLE]: 'Bloqueado',
  [RecipientStatus.QUEUED]: 'Na fila',
  [RecipientStatus.SENDING]: 'Enviando',
  [RecipientStatus.SENT]: 'Enviada',
  [RecipientStatus.DELIVERED]: 'Entregue',
  [RecipientStatus.READ]: 'Lida',
  [RecipientStatus.REPLIED]: 'Respondeu',
  [RecipientStatus.FAILED]: 'Falhou',
  [RecipientStatus.CANCELLED]: 'Cancelado',
};

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireWorkspace();
  const { id } = await params;
  const raw = await searchParams;

  // Escopada ao workspace: id de outro tenant simplesmente não existe.
  const campaign = await getCampaignDetail(context.workspace.id, id);
  if (!campaign) notFound();

  const parsed = recipientFiltersSchema.safeParse(raw);
  const filters = parsed.success ? parsed.data : recipientFiltersSchema.parse({});

  const [recipients, metrics] = await Promise.all([
    queryRecipients(context.workspace.id, campaign.id, filters),
    computeCampaignMetrics(context.workspace.id, campaign.id),
  ]);
  const rates = computeRates(metrics);
  const canOperate = hasAtLeastRole(context.role, WorkspaceRole.ADMIN);

  return (
    <>
      <PageHeader
        title={campaign.name}
        description={campaign.description ?? 'Sem descrição'}
        actions={
          <Button asChild variant="ghost">
            <Link href="/campaigns">
              <ArrowLeft aria-hidden="true" className="mr-1 size-4" />
              Voltar
            </Link>
          </Button>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <CampaignStatusBadge status={campaign.status} />
        <Badge variant="neutral">WhatsApp</Badge>
        {campaign.template ? <Badge variant="outline">{campaign.template.name}</Badge> : null}
        {campaign.scheduledAt ? (
          <Badge variant="outline">
            Agendada: {formatDateTime(campaign.scheduledAt)} ({campaign.timezone})
          </Badge>
        ) : null}
      </div>

      {campaign.failureReason ? (
        <Alert variant="destructive" className="mb-6">
          <AlertTitle>A preparação falhou</AlertTitle>
          <AlertDescription>{campaign.failureReason}</AlertDescription>
        </Alert>
      ) : null}

      {campaign.status === 'RUNNING' ? (
        <Alert variant="info" className="mb-6">
          <AlertTitle>Execução ainda não implementada</AlertTitle>
          <AlertDescription>
            A campanha está marcada como em execução, mas o disparo em massa entra na Sprint 5.
            Nenhuma mensagem foi enfileirada ou enviada.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total" value={metrics.total} />
        <StatCard label="Elegíveis" value={metrics.eligible} />
        <StatCard label="Suprimidos" value={metrics.suppressed} />
        <StatCard label="Telefone inválido" value={metrics.invalid} />
        <StatCard label="Enviadas" value={metrics.sent} />
        <StatCard label="Entregues" value={metrics.delivered} />
        <StatCard label="Lidas" value={metrics.read} />
        <StatCard
          label="Falhas"
          value={metrics.failed}
          hint={`Taxa de falha: ${(rates.failureRate * 100).toFixed(1)}%`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Ações</CardTitle>
            </CardHeader>
            <CardContent>
              <CampaignActions
                campaignId={campaign.id}
                status={campaign.status}
                canOperate={canOperate}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Destinatários</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {recipients.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum destinatário ainda. Prepare a campanha para materializar a audiência.
                </p>
              ) : (
                <>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Contato</TableHead>
                          <TableHead>Telefone</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Motivo</TableHead>
                          <TableHead>Provider ID</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {recipients.rows.map((recipient) => (
                          <TableRow key={recipient.id}>
                            <TableCell>
                              <Link
                                href={`/contacts/${recipient.contact.id}`}
                                className="font-medium hover:underline"
                              >
                                {[recipient.contact.firstName, recipient.contact.lastName]
                                  .filter(Boolean)
                                  .join(' ') || 'Sem nome'}
                              </Link>
                              {recipient.contact.company ? (
                                <span className="block text-xs text-muted-foreground">
                                  {recipient.contact.company}
                                </span>
                              ) : null}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {formatPhone(recipient.contact.phoneE164)}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  recipient.status === RecipientStatus.ELIGIBLE
                                    ? 'success'
                                    : recipient.status === RecipientStatus.SUPPRESSED ||
                                        recipient.status === RecipientStatus.FAILED
                                      ? 'destructive'
                                      : 'neutral'
                                }
                              >
                                {RECIPIENT_LABELS[recipient.status]}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {recipient.eligibilityReasons.length === 0
                                ? '—'
                                : recipient.eligibilityReasons
                                    .map(
                                      (reason) =>
                                        REASON_LABELS[reason as CampaignEligibilityReason] ??
                                        reason,
                                    )
                                    .join('; ')}
                            </TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {recipient.providerMessageId ?? '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <Pagination
                    label="Paginação de destinatários"
                    page={recipients.page}
                    pageCount={recipients.pageCount}
                    total={recipients.total}
                    pageSize={recipients.pageSize}
                  />
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Detalhes</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <Detail label="Criada por" value={campaign.createdBy?.name ?? campaign.createdBy?.email ?? '—'} />
              <Detail label="Criada em" value={formatDateTime(campaign.createdAt)} />
              <Detail
                label="Preparada em"
                value={campaign.preparedAt ? formatDateTime(campaign.preparedAt) : '—'}
              />
              <Detail
                label="Último ensaio"
                value={campaign.lastDryRunAt ? formatDateTime(campaign.lastDryRunAt) : 'Nenhum'}
              />
              <Detail
                label="Iniciada em"
                value={campaign.startedAt ? formatDateTime(campaign.startedAt) : '—'}
              />
              <Detail
                label="Template"
                value={
                  campaign.template
                    ? `${campaign.template.name} (${campaign.template.language})`
                    : 'Nenhum'
                }
              />
              <Detail
                label="Variável ausente"
                value={
                  campaign.variablePolicy === 'FALLBACK_VALUE'
                    ? 'Usa valor alternativo'
                    : 'Bloqueia o contato'
                }
              />
            </dl>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
