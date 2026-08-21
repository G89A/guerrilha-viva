import { NextResponse, type NextRequest } from 'next/server';
import { requireWorkspace } from '@/lib/auth/guards';
import { toCsv } from '@/features/contacts/csv/export';
import { buildRange, parseRangeDays, parseTimeZone } from '@/features/analytics/range';
import {
  audienceGrowth,
  campaignPerformance,
  messagingSeries,
} from '@/features/analytics/service';

/**
 * Exportação dos relatórios em CSV.
 *
 * O workspace vem da SESSÃO, nunca do parâmetro. O período e o fuso vêm da URL
 * e passam pelos mesmos validadores da tela — um fuso inventado cai no padrão em
 * vez de chegar ao SQL.
 *
 * As células passam por `escapeCsvCell`, que neutraliza fórmula: um contato
 * chamado `=cmd|'/c calc'!A1` não vira execução ao abrir no Excel.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TYPES = ['campanhas', 'mensagens', 'audiencia'] as const;
type ExportType = (typeof TYPES)[number];

function isExportType(value: string | null): value is ExportType {
  return value !== null && (TYPES as readonly string[]).includes(value);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const context = await requireWorkspace();
  const params = request.nextUrl.searchParams;

  const type = params.get('tipo');
  if (!isExportType(type)) {
    return NextResponse.json(
      { error: 'tipo_invalido', aceitos: TYPES },
      { status: 400, headers: { 'cache-control': 'no-store' } },
    );
  }

  const range = buildRange({
    days: parseRangeDays(params.get('dias')),
    timeZone: parseTimeZone(params.get('fuso')),
  });

  let csv: string;

  if (type === 'campanhas') {
    const rows = await campaignPerformance(context.workspace.id, range, 500);
    csv = toCsv(
      ['campanha', 'status', 'iniciada_em', 'destinatarios', 'enviadas', 'entregues', 'lidas', 'falhas', 'taxa_entrega', 'taxa_leitura'],
      rows.map((row) => [
        row.name,
        row.status,
        row.startedAt?.toISOString() ?? '',
        row.total,
        row.sent,
        row.delivered,
        row.read,
        row.failed,
        row.deliveryRate,
        row.readRate,
      ]),
    );
  } else if (type === 'mensagens') {
    const rows = await messagingSeries(context.workspace.id, range);
    csv = toCsv(
      ['dia', 'enviadas', 'entregues', 'lidas', 'falhas', 'recebidas'],
      rows.map((row) => [row.day, row.sent, row.delivered, row.read, row.failed, row.inbound]),
    );
  } else {
    const growth = await audienceGrowth(context.workspace.id, range);
    csv = toCsv(
      ['dia', 'contatos_criados', 'consentimentos_concedidos', 'consentimentos_revogados', 'supressoes'],
      growth.days.map((row) => [row.day, row.created, row.granted, row.revoked, row.suppressed]),
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="eclizium-${type}-${stamp}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
