import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LineChart } from '@/components/charts/line-chart';
import { DivergingBars } from '@/components/charts/diverging-bars';
import { RankedBars } from '@/components/charts/ranked-bars';
import { RangeControls } from '@/components/analytics/range-controls';
import { buildRange, parseRangeDays, parseTimeZone } from '@/features/analytics/range';
import {
  audienceGrowth,
  campaignPerformance,
  failureBreakdown,
  inboxResponsiveness,
  messagingSeries,
  messagingTotals,
} from '@/features/analytics/service';
import { auditActivity } from '@/features/analytics/audit-query';
import { requireWorkspace } from '@/lib/auth/guards';
import { hasAtLeastRole, WorkspaceRole } from '@/lib/auth/roles';

export const metadata: Metadata = { title: 'Analytics' };
export const dynamic = 'force-dynamic';

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireWorkspace();
  const raw = await searchParams;

  const range = buildRange({
    days: parseRangeDays(raw.dias),
    timeZone: parseTimeZone(raw.fuso),
  });

  const [series, totals, campaigns, growth, failures, inbox, audit] = await Promise.all([
    messagingSeries(context.workspace.id, range),
    messagingTotals(context.workspace.id, range),
    campaignPerformance(context.workspace.id, range),
    audienceGrowth(context.workspace.id, range),
    failureBreakdown(context.workspace.id, range),
    inboxResponsiveness(context.workspace.id, range),
    auditActivity(context.workspace.id, range.from, range.to),
  ]);

  const canAudit = hasAtLeastRole(context.role, WorkspaceRole.ADMIN);
  const labels = series.map((point) => point.day.slice(5));
  const exportBase = `/api/analytics/export?dias=${range.days}&fuso=${encodeURIComponent(range.timeZone)}`;

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Tudo por agregação sobre os dados reais do workspace. Nenhum número é estimado."
      />

      <RangeControls days={range.days} timeZone={range.timeZone} />

      {!totals.statusDataAvailable && totals.sent > 0 ? (
        <Alert variant="warning" className="mb-6">
          <AlertDescription>
            Nenhum evento de webhook chegou neste período, então <strong>não há dado de entrega
            nem de leitura</strong> — as taxas abaixo aparecem zeradas por ausência de informação,
            não por desempenho ruim. Configure o webhook em{' '}
            <Link href="/settings/integrations" className="underline">
              Integrações
            </Link>
            .
          </AlertDescription>
        </Alert>
      ) : null}

      <section aria-label="Totais do período" className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Enviadas" value={String(totals.sent)} />
        <Metric
          label="Entregues"
          value={totals.statusDataAvailable ? `${totals.deliveryRate}%` : '—'}
          hint={totals.statusDataAvailable ? `${totals.delivered} mensagens` : 'sem webhook no período'}
        />
        <Metric
          label="Lidas"
          value={totals.statusDataAvailable ? `${totals.readRate}%` : '—'}
          hint={totals.statusDataAvailable ? `${totals.read} das entregues` : 'sem webhook no período'}
        />
        <Metric
          label="Falhas"
          value={`${totals.failureRate}%`}
          hint={`${totals.failed} de ${totals.sent + totals.failed} tentativas`}
        />
      </section>

      <div className="space-y-6">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
            <div className="space-y-1.5">
              <CardTitle>Mensagens por dia</CardTitle>
              <CardDescription>
                Enviadas, entregues e lidas. Os estados avançam, então uma mensagem lida também
                conta como entregue e enviada.
              </CardDescription>
            </div>
            <Button asChild variant="outline" size="sm">
              <a href={`${exportBase}&tipo=mensagens`}>Exportar CSV</a>
            </Button>
          </CardHeader>
          <CardContent>
            <LineChart
              labels={labels}
              ariaLabel="Mensagens enviadas, entregues e lidas por dia"
              series={[
                {
                  key: 'sent',
                  label: 'Enviadas',
                  color: 'var(--chart-1)',
                  points: series.map((point) => point.sent),
                },
                {
                  key: 'delivered',
                  label: 'Entregues',
                  color: 'var(--chart-2)',
                  points: series.map((point) => point.delivered),
                },
                {
                  key: 'read',
                  label: 'Lidas',
                  color: 'var(--chart-3)',
                  points: series.map((point) => point.read),
                },
              ]}
            />
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Por que falhou</CardTitle>
              <CardDescription>
                Sem o motivo, uma taxa de falha não aciona nada.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RankedBars
                tone="critical"
                emptyMessage="Nenhuma falha registrada no período."
                items={failures.map((failure) => ({
                  label: failure.title ?? failure.code,
                  hint: failure.code,
                  value: failure.total,
                }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Atendimento</CardTitle>
              <CardDescription>
                Tempo até a primeira resposta, medido por conversa.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Metric label="Recebidas" value={String(inbox.inbound)} />
              <Metric label="Respostas manuais" value={String(inbox.replies)} />
              <Metric
                label="Mediana de resposta"
                value={
                  inbox.medianFirstReplyMinutes === null
                    ? '—'
                    : `${inbox.medianFirstReplyMinutes} min`
                }
                hint={inbox.medianFirstReplyMinutes === null ? 'sem amostra' : undefined}
              />
              <Metric
                label="Sem resposta"
                value={String(inbox.unanswered)}
                hint="conversas que receberam e não tiveram retorno"
              />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
            <div className="space-y-1.5">
              <CardTitle>Base de contatos</CardTitle>
              <CardDescription>
                Entradas acima da linha, saídas abaixo. Saída é revogação de consentimento ou
                supressão — as duas tiram alguém do alcance.
              </CardDescription>
            </div>
            <Button asChild variant="outline" size="sm">
              <a href={`${exportBase}&tipo=audiencia`}>Exportar CSV</a>
            </Button>
          </CardHeader>
          <CardContent>
            <DivergingBars
              ariaLabel="Entradas e saídas da base de contatos por dia"
              positiveLabel="Entradas"
              negativeLabel="Saídas"
              points={growth.days.map((day) => ({
                label: day.day.slice(5),
                positive: day.created + day.granted,
                negative: day.revoked + day.suppressed,
              }))}
            />
            <dl className="mt-4 grid gap-3 sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">Contatos criados</dt>
                <dd className="text-sm font-medium tabular-nums">{growth.totals.created}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Consentimentos concedidos</dt>
                <dd className="text-sm font-medium tabular-nums">{growth.totals.granted}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Revogações</dt>
                <dd className="text-sm font-medium tabular-nums">{growth.totals.revoked}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Supressões</dt>
                <dd className="text-sm font-medium tabular-nums">{growth.totals.suppressed}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
            <div className="space-y-1.5">
              <CardTitle>Campanhas</CardTitle>
              <CardDescription>
                Agregado no banco, numa consulta só — não uma leitura por campanha.
              </CardDescription>
            </div>
            <Button asChild variant="outline" size="sm">
              <a href={`${exportBase}&tipo=campanhas`}>Exportar CSV</a>
            </Button>
          </CardHeader>
          <CardContent>
            {campaigns.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma campanha no período selecionado.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campanha</TableHead>
                      <TableHead className="text-right">Destinatários</TableHead>
                      <TableHead className="text-right">Enviadas</TableHead>
                      <TableHead className="text-right">Entrega</TableHead>
                      <TableHead className="text-right">Leitura</TableHead>
                      <TableHead className="text-right">Falhas</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {campaigns.map((campaign) => (
                      <TableRow key={campaign.id}>
                        <TableCell>
                          <Link href={`/campaigns/${campaign.id}`} className="hover:underline">
                            {campaign.name}
                          </Link>
                          <span className="ml-2 text-xs text-muted-foreground">
                            {campaign.status}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{campaign.total}</TableCell>
                        <TableCell className="text-right tabular-nums">{campaign.sent}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {campaign.sent === 0 ? '—' : `${campaign.deliveryRate}%`}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {campaign.delivered === 0 ? '—' : `${campaign.readRate}%`}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {campaign.failed > 0 ? (
                            <span className="inline-flex items-center gap-1 text-destructive">
                              <AlertTriangle aria-hidden="true" className="size-3" />
                              {campaign.failed}
                            </span>
                          ) : (
                            campaign.failed
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {canAudit ? (
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
              <div className="space-y-1.5">
                <CardTitle>Atividade auditada</CardTitle>
                <CardDescription>
                  Ações mais registradas no período.
                </CardDescription>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href="/analytics/audit">Ver registro completo</Link>
              </Button>
            </CardHeader>
            <CardContent>
              <RankedBars
                emptyMessage="Nenhuma ação registrada no período."
                items={audit.map((entry) => ({ label: entry.action, value: entry.total }))}
              />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
