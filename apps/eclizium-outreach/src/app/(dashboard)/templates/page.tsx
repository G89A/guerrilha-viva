import type { Metadata } from 'next';
import Link from 'next/link';
import { FileText } from 'lucide-react';
import { ChannelStatus } from '@prisma/client';
import { PageHeader } from '@/components/layout/page-header';
import { TemplateFilters } from '@/components/templates/template-filters';
import { TemplateStatusBadge } from '@/components/templates/template-status-badge';
import { Pagination } from '@/components/ui/pagination';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { templateFiltersSchema } from '@/features/messaging/schemas';
import { queryTemplates, templateLanguages } from '@/features/messaging/template-query';
import { findChannel } from '@/features/messaging/channel-service';
import { requireWorkspace } from '@/lib/auth/guards';
import { formatDateTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Templates' };
export const dynamic = 'force-dynamic';

const CATEGORY_LABELS: Record<string, string> = {
  MARKETING: 'Marketing',
  UTILITY: 'Utilidade',
  AUTHENTICATION: 'Autenticação',
  UNKNOWN: 'Desconhecida',
};

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireWorkspace();
  const raw = await searchParams;

  const parsed = templateFiltersSchema.safeParse(raw);
  const filters = parsed.success ? parsed.data : templateFiltersSchema.parse({});

  const [page, languages, channel] = await Promise.all([
    queryTemplates(context.workspace.id, filters),
    templateLanguages(context.workspace.id),
    findChannel(context.workspace.id),
  ]);

  const hasFilters = ['search', 'status', 'category', 'language'].some(
    (key) => filters[key as keyof typeof filters] !== undefined,
  );

  return (
    <>
      <PageHeader
        title="Templates"
        description={
          page.total === 1 ? '1 template sincronizado' : `${page.total} templates sincronizados`
        }
        actions={
          <Button asChild variant="outline">
            <Link href="/settings/integrations">Sincronizar templates</Link>
          </Button>
        }
      />

      {!channel ? (
        <Alert variant="warning" className="mb-6">
          <AlertTitle>WhatsApp não conectado</AlertTitle>
          <AlertDescription>
            Conecte sua conta da Meta em Configurações → Integrações para sincronizar templates.
          </AlertDescription>
        </Alert>
      ) : channel.status !== ChannelStatus.CONNECTED ? (
        <Alert variant="warning" className="mb-6">
          <AlertTitle>Integração não verificada</AlertTitle>
          <AlertDescription>
            O canal está como {channel.status}. Verifique a conexão antes de sincronizar ou enviar.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="mb-4">
        <TemplateFilters languages={languages} />
      </div>

      {page.rows.length === 0 ? (
        <EmptyState
          icon={<FileText aria-hidden="true" className="size-6" />}
          title={hasFilters ? 'Nenhum template encontrado' : 'Nenhum template sincronizado'}
          description={
            hasFilters
              ? 'Ajuste os filtros para ver outros templates.'
              : 'Sincronize com a Meta para trazer os templates da sua WABA. Nada é criado localmente.'
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Idioma</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Qualidade</TableHead>
                  <TableHead>Variáveis</TableHead>
                  <TableHead>Última sincronização</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.rows.map((template) => (
                  <TableRow key={template.id}>
                    <TableCell>
                      <Link
                        href={`/templates/${template.id}`}
                        className="font-medium text-foreground hover:underline"
                      >
                        {template.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {CATEGORY_LABELS[template.category] ?? template.category}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{template.language}</TableCell>
                    <TableCell>
                      <TemplateStatusBadge
                        status={template.status}
                        providerStatus={template.providerStatus}
                        availability={template.availability}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {template.qualityScore ?? '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {template.variableCount}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {template.syncedAt ? formatDateTime(template.syncedAt) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <Pagination
            page={page.page}
            pageCount={page.pageCount}
            total={page.total}
            pageSize={page.pageSize}
            label="Paginação de templates"
          />
        </>
      )}
    </>
  );
}
