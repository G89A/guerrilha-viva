import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AuditTable } from '@/components/analytics/audit-table';
import { buildRange, parseRangeDays, parseTimeZone } from '@/features/analytics/range';
import { auditFilterOptions, listAuditEntries } from '@/features/analytics/audit-query';
import { requireWorkspaceRole } from '@/lib/auth/guards';
import { WorkspaceRole } from '@/lib/auth/roles';

export const metadata: Metadata = { title: 'Auditoria' };
export const dynamic = 'force-dynamic';

/**
 * Registro de auditoria.
 *
 * ADMIN para cima: o log diz quem fez o quê, e isso não é informação de todo
 * mundo. Só leitura — não existe caminho para editar ou apagar registro, porque
 * log que o próprio sistema altera não serve de prova.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireWorkspaceRole(WorkspaceRole.ADMIN);
  const raw = await searchParams;

  const range = buildRange({ days: parseRangeDays(raw.dias), timeZone: parseTimeZone(raw.fuso) });

  const filters = {
    ...(typeof raw.acao === 'string' && raw.acao ? { action: raw.acao } : {}),
    ...(typeof raw.recurso === 'string' && raw.recurso ? { resourceType: raw.recurso } : {}),
    ...(typeof raw.ator === 'string' && raw.ator ? { actorUserId: raw.ator } : {}),
    from: range.from,
    to: range.to,
  };

  const [page, options] = await Promise.all([
    listAuditEntries(context.workspace.id, filters),
    auditFilterOptions(context.workspace.id),
  ]);

  const exportUrl = `/api/analytics/audit/export?dias=${range.days}&fuso=${encodeURIComponent(
    range.timeZone,
  )}${filters.action ? `&acao=${encodeURIComponent(filters.action)}` : ''}${
    filters.resourceType ? `&recurso=${encodeURIComponent(filters.resourceType)}` : ''
  }`;

  return (
    <>
      <PageHeader
        title="Auditoria"
        description="Quem fez o quê, quando. Registro imutável: a aplicação escreve e nunca edita."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/analytics">Voltar para Analytics</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href={exportUrl}>Exportar CSV</a>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Registros</CardTitle>
          <CardDescription>
            Últimos {page.entries.length} registro(s) do período. Os metadados nunca contêm token,
            segredo ou conteúdo de mensagem.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AuditTable
            page={page}
            options={options}
            filters={{
              action: filters.action ?? '',
              resourceType: filters.resourceType ?? '',
              actorUserId: filters.actorUserId ?? '',
            }}
          />
        </CardContent>
      </Card>
    </>
  );
}
