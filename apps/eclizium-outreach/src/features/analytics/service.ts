import 'server-only';
import {
  ConsentStatus,
  MessageDirection,
  MessageStatus,
  Prisma as PrismaNS,
} from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { daysInRange, type AnalyticsRange } from '@/features/analytics/range';

/**
 * Analytics do workspace.
 *
 * TUDO por agregação. Nenhuma consulta aqui carrega linhas para contar em
 * memória: um relatório que não escala vira um relatório que ninguém abre.
 *
 * O agrupamento por dia converte em DOIS passos:
 * `(created_at AT TIME ZONE 'UTC') AT TIME ZONE $tz`. As colunas são
 * `timestamp without time zone` guardadas em UTC, e um `AT TIME ZONE` sozinho
 * INTERPRETA o valor como sendo daquele fuso em vez de convertê-lo — o oposto
 * do pretendido, e um erro que só aparece como relatório silenciosamente errado.
 *
 * O fuso vai como PARÂMETRO, nunca interpolado. O valor vem da URL e é validado
 * antes (`range.ts`), mas o parâmetro é a barreira que importa.
 *
 * Toda consulta leva `workspace_id` no WHERE. Não existe agregação global.
 */

export interface DayPoint {
  day: string;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  inbound: number;
}

export interface MessagingTotals {
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  inbound: number;
  deliveryRate: number;
  readRate: number;
  failureRate: number;
  /**
   * `false` quando nenhum evento de webhook chegou no período. Sem webhook não
   * existe status de entrega — e apresentar 0% de entrega nesse caso seria
   * relatar como desempenho o que é ausência de dado.
   */
  statusDataAvailable: boolean;
}

function rate(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;
}

interface RawDayRow {
  day: string;
  direction: MessageDirection;
  status: MessageStatus;
  total: bigint;
}

/**
 * Série diária de mensagens.
 *
 * Uma consulta só, agrupada por dia/direção/status. Os dias sem movimento
 * entram com zero no preenchimento — o gráfico precisa do eixo completo, e
 * omitir o dia vazio faria uma queda parecer um buraco.
 */
export async function messagingSeries(
  workspaceId: string,
  range: AnalyticsRange,
): Promise<DayPoint[]> {
  const rows = await prisma.$queryRaw<RawDayRow[]>(PrismaNS.sql`
    SELECT to_char(date_trunc('day', (created_at AT TIME ZONE 'UTC') AT TIME ZONE ${range.timeZone}), 'YYYY-MM-DD') AS day,
           direction,
           status,
           COUNT(*)::bigint AS total
      FROM messages
     WHERE workspace_id = ${workspaceId}
       AND created_at >= ${range.from}
       AND created_at <= ${range.to}
     GROUP BY 1, 2, 3
  `);

  const byDay = new Map<string, DayPoint>();
  for (const day of daysInRange(range)) {
    byDay.set(day, { day, sent: 0, delivered: 0, read: 0, failed: 0, inbound: 0 });
  }

  for (const row of rows) {
    const point = byDay.get(row.day);
    if (!point) continue;
    const total = Number(row.total);

    if (row.direction === MessageDirection.INBOUND) {
      point.inbound += total;
      continue;
    }

    // Os status avançam (SENT → DELIVERED → READ), então uma mensagem lida
    // também foi entregue e enviada. Contar só o estado final subestimaria
    // entrega e envio.
    if (row.status === MessageStatus.FAILED) point.failed += total;
    if (
      row.status === MessageStatus.SENT ||
      row.status === MessageStatus.DELIVERED ||
      row.status === MessageStatus.READ
    ) {
      point.sent += total;
    }
    if (row.status === MessageStatus.DELIVERED || row.status === MessageStatus.READ) {
      point.delivered += total;
    }
    if (row.status === MessageStatus.READ) {
      point.read += total;
    }
  }

  return [...byDay.values()];
}

export async function messagingTotals(
  workspaceId: string,
  range: AnalyticsRange,
): Promise<MessagingTotals> {
  const [series, webhookEvents] = await Promise.all([
    messagingSeries(workspaceId, range),
    prisma.webhookEvent.count({
      where: { workspaceId, receivedAt: { gte: range.from, lte: range.to } },
    }),
  ]);

  const totals = series.reduce(
    (accumulator, point) => ({
      sent: accumulator.sent + point.sent,
      delivered: accumulator.delivered + point.delivered,
      read: accumulator.read + point.read,
      failed: accumulator.failed + point.failed,
      inbound: accumulator.inbound + point.inbound,
    }),
    { sent: 0, delivered: 0, read: 0, failed: 0, inbound: 0 },
  );

  const attempted = totals.sent + totals.failed;

  return {
    ...totals,
    deliveryRate: rate(totals.delivered, totals.sent),
    readRate: rate(totals.read, totals.delivered),
    failureRate: rate(totals.failed, attempted),
    statusDataAvailable: webhookEvents > 0,
  };
}

export interface CampaignPerformanceRow {
  id: string;
  name: string;
  status: string;
  startedAt: Date | null;
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  deliveryRate: number;
  readRate: number;
}

interface RawCampaignRow {
  id: string;
  name: string;
  status: string;
  started_at: Date | null;
  total: bigint;
  sent: bigint;
  delivered: bigint;
  read: bigint;
  failed: bigint;
}

/**
 * Desempenho por campanha, agregado no banco.
 *
 * Poderia ser feito com N consultas de métricas por campanha — e seria N+1.
 * Aqui é um `GROUP BY` só, com `FILTER`, e o limite existe para que a tela não
 * dependa de quantas campanhas o workspace tem.
 */
export async function campaignPerformance(
  workspaceId: string,
  range: AnalyticsRange,
  limit = 20,
): Promise<CampaignPerformanceRow[]> {
  const rows = await prisma.$queryRaw<RawCampaignRow[]>(PrismaNS.sql`
    SELECT c.id,
           c.name,
           c.status::text AS status,
           c.started_at,
           COUNT(r.id)::bigint AS total,
           COUNT(r.id) FILTER (WHERE r.status IN ('SENT','DELIVERED','READ','REPLIED'))::bigint AS sent,
           COUNT(r.id) FILTER (WHERE r.status IN ('DELIVERED','READ','REPLIED'))::bigint AS delivered,
           COUNT(r.id) FILTER (WHERE r.status IN ('READ','REPLIED'))::bigint AS read,
           COUNT(r.id) FILTER (WHERE r.status = 'FAILED')::bigint AS failed
      FROM campaigns c
      LEFT JOIN campaign_recipients r
        ON r.campaign_id = c.id
       AND r.workspace_id = c.workspace_id
     WHERE c.workspace_id = ${workspaceId}
       AND c.created_at <= ${range.to}
       AND (c.started_at IS NULL OR c.started_at >= ${range.from})
     GROUP BY c.id, c.name, c.status, c.started_at
     ORDER BY c.started_at DESC NULLS LAST, c.created_at DESC
     LIMIT ${limit}
  `);

  return rows.map((row) => {
    const sent = Number(row.sent);
    const delivered = Number(row.delivered);
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      startedAt: row.started_at,
      total: Number(row.total),
      sent,
      delivered,
      read: Number(row.read),
      failed: Number(row.failed),
      deliveryRate: rate(delivered, sent),
      readRate: rate(Number(row.read), delivered),
    };
  });
}

export interface AudienceGrowth {
  days: Array<{ day: string; created: number; granted: number; revoked: number; suppressed: number }>;
  totals: { created: number; granted: number; revoked: number; suppressed: number };
}

/** Crescimento e saúde da base: entradas, consentimento e supressão. */
export async function audienceGrowth(
  workspaceId: string,
  range: AnalyticsRange,
): Promise<AudienceGrowth> {
  const [contacts, consents, suppressions] = await Promise.all([
    prisma.$queryRaw<Array<{ day: string; total: bigint }>>(PrismaNS.sql`
      SELECT to_char(date_trunc('day', (created_at AT TIME ZONE 'UTC') AT TIME ZONE ${range.timeZone}), 'YYYY-MM-DD') AS day,
             COUNT(*)::bigint AS total
        FROM contacts
       WHERE workspace_id = ${workspaceId}
         AND created_at >= ${range.from} AND created_at <= ${range.to}
       GROUP BY 1
    `),
    prisma.$queryRaw<Array<{ day: string; status: ConsentStatus; total: bigint }>>(PrismaNS.sql`
      SELECT to_char(date_trunc('day', (updated_at AT TIME ZONE 'UTC') AT TIME ZONE ${range.timeZone}), 'YYYY-MM-DD') AS day,
             status,
             COUNT(*)::bigint AS total
        FROM contact_consents
       WHERE workspace_id = ${workspaceId}
         AND updated_at >= ${range.from} AND updated_at <= ${range.to}
       GROUP BY 1, 2
    `),
    prisma.$queryRaw<Array<{ day: string; total: bigint }>>(PrismaNS.sql`
      SELECT to_char(date_trunc('day', (created_at AT TIME ZONE 'UTC') AT TIME ZONE ${range.timeZone}), 'YYYY-MM-DD') AS day,
             COUNT(*)::bigint AS total
        FROM suppression_entries
       WHERE workspace_id = ${workspaceId}
         AND created_at >= ${range.from} AND created_at <= ${range.to}
       GROUP BY 1
    `),
  ]);

  const byDay = new Map(
    daysInRange(range).map((day) => [day, { day, created: 0, granted: 0, revoked: 0, suppressed: 0 }]),
  );

  for (const row of contacts) {
    const point = byDay.get(row.day);
    if (point) point.created += Number(row.total);
  }
  for (const row of consents) {
    const point = byDay.get(row.day);
    if (!point) continue;
    if (row.status === ConsentStatus.GRANTED) point.granted += Number(row.total);
    if (row.status === ConsentStatus.REVOKED) point.revoked += Number(row.total);
  }
  for (const row of suppressions) {
    const point = byDay.get(row.day);
    if (point) point.suppressed += Number(row.total);
  }

  const days = [...byDay.values()];
  return {
    days,
    totals: days.reduce(
      (accumulator, point) => ({
        created: accumulator.created + point.created,
        granted: accumulator.granted + point.granted,
        revoked: accumulator.revoked + point.revoked,
        suppressed: accumulator.suppressed + point.suppressed,
      }),
      { created: 0, granted: 0, revoked: 0, suppressed: 0 },
    ),
  };
}

export interface FailureReason {
  code: string;
  title: string | null;
  total: number;
}

/** Por que as mensagens falharam. Sem isso, "12% de falha" não aciona nada. */
export async function failureBreakdown(
  workspaceId: string,
  range: AnalyticsRange,
  limit = 10,
): Promise<FailureReason[]> {
  const rows = await prisma.message.groupBy({
    by: ['errorCode', 'errorTitle'],
    where: {
      workspaceId,
      status: MessageStatus.FAILED,
      createdAt: { gte: range.from, lte: range.to },
    },
    _count: { _all: true },
    orderBy: { _count: { errorCode: 'desc' } },
    take: limit,
  });

  return rows.map((row) => ({
    code: row.errorCode ?? 'SEM_CODIGO',
    title: row.errorTitle,
    total: row._count._all,
  }));
}

export interface InboxResponsiveness {
  conversations: number;
  inbound: number;
  replies: number;
  /** Mediana do tempo até a primeira resposta, em minutos. `null` sem amostra. */
  medianFirstReplyMinutes: number | null;
  p90FirstReplyMinutes: number | null;
  /** Conversas recebidas que nunca tiveram resposta no período. */
  unanswered: number;
}

interface RawReplyRow {
  minutes: number | null;
}

/**
 * Responsividade do atendimento.
 *
 * O tempo até a primeira resposta é medido por conversa: primeira mensagem
 * recebida no período e a primeira enviada DEPOIS dela. Conversa sem resposta
 * entra em `unanswered` em vez de sumir da conta — que é o número que o gestor
 * precisa ver.
 */
export async function inboxResponsiveness(
  workspaceId: string,
  range: AnalyticsRange,
): Promise<InboxResponsiveness> {
  const rows = await prisma.$queryRaw<RawReplyRow[]>(PrismaNS.sql`
    WITH primeira_entrada AS (
      SELECT conversation_id, MIN(created_at) AS entrada
        FROM messages
       WHERE workspace_id = ${workspaceId}
         AND direction = 'INBOUND'
         AND conversation_id IS NOT NULL
         AND created_at >= ${range.from} AND created_at <= ${range.to}
       GROUP BY conversation_id
    )
    SELECT EXTRACT(EPOCH FROM (MIN(m.created_at) - e.entrada)) / 60 AS minutes
      FROM primeira_entrada e
      LEFT JOIN messages m
        ON m.conversation_id = e.conversation_id
       AND m.workspace_id = ${workspaceId}
       AND m.direction = 'OUTBOUND'
       AND m.created_at > e.entrada
     GROUP BY e.conversation_id, e.entrada
  `);

  const answered = rows
    .map((row) => (row.minutes === null ? null : Number(row.minutes)))
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);

  const [conversations, inbound, replies] = await Promise.all([
    prisma.conversation.count({
      where: { workspaceId, lastMessageAt: { gte: range.from, lte: range.to } },
    }),
    prisma.message.count({
      where: {
        workspaceId,
        direction: MessageDirection.INBOUND,
        createdAt: { gte: range.from, lte: range.to },
      },
    }),
    prisma.message.count({
      where: {
        workspaceId,
        direction: MessageDirection.OUTBOUND,
        campaignId: null,
        createdAt: { gte: range.from, lte: range.to },
      },
    }),
  ]);

  return {
    conversations,
    inbound,
    replies,
    medianFirstReplyMinutes: percentile(answered, 0.5),
    p90FirstReplyMinutes: percentile(answered, 0.9),
    unanswered: rows.length - answered.length,
  };
}

/** Percentil por interpolação do vizinho mais próximo. `null` sem amostra. */
export function percentile(sorted: number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  const value = sorted[index];
  return value === undefined ? null : Math.round(value * 10) / 10;
}
