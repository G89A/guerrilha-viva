import { NextResponse, type NextRequest } from 'next/server';
import { requireWorkspaceRole } from '@/lib/auth/guards';
import { WorkspaceRole } from '@/lib/auth/roles';
import { toCsv } from '@/features/contacts/csv/export';
import { buildRange, parseRangeDays, parseTimeZone } from '@/features/analytics/range';
import { listAuditEntries } from '@/features/analytics/audit-query';

/**
 * Exportação do registro de auditoria.
 *
 * Exige ADMIN: o log diz quem fez o quê, e não é informação de todo mundo.
 * A exportação percorre por cursor, em blocos — auditoria de um workspace ativo
 * tem dezenas de milhares de linhas, e carregar tudo de uma vez derrubaria o
 * processo.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ROWS = 10_000;
const CHUNK = 500;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const context = await requireWorkspaceRole(WorkspaceRole.ADMIN);
  const params = request.nextUrl.searchParams;

  const range = buildRange({
    days: parseRangeDays(params.get('dias')),
    timeZone: parseTimeZone(params.get('fuso')),
  });

  const filters = {
    ...(params.get('acao') ? { action: params.get('acao') as string } : {}),
    ...(params.get('recurso') ? { resourceType: params.get('recurso') as string } : {}),
    from: range.from,
    to: range.to,
  };

  const rows: Array<Array<unknown>> = [];
  let cursor: string | undefined;

  while (rows.length < MAX_ROWS) {
    const page = await listAuditEntries(
      context.workspace.id,
      filters,
      cursor ? { cursor, take: CHUNK } : { take: CHUNK },
    );

    for (const entry of page.entries) {
      rows.push([
        entry.createdAt.toISOString(),
        entry.action,
        entry.resourceType,
        entry.resourceId ?? '',
        entry.actorType,
        entry.actorName ?? '',
        entry.actorEmail ?? '',
        JSON.stringify(entry.metadata),
      ]);
    }

    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }

  const csv = toCsv(
    ['quando', 'acao', 'recurso', 'recurso_id', 'tipo_ator', 'ator', 'email_ator', 'metadados'],
    rows,
  );
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="eclizium-auditoria-${stamp}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
