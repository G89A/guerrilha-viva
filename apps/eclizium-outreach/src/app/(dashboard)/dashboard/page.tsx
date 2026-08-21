import type { Metadata } from 'next';
import { Inbox, Megaphone, MessageSquare, Radio, ShieldBan, Users } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { getWorkspaceOverview } from '@/features/dashboard/service';
import { assessSendReadiness } from '@/features/readiness/service';
import { SendReadiness } from '@/components/dashboard/send-readiness';
import { requireWorkspace } from '@/lib/auth/guards';

export const metadata: Metadata = { title: 'Painel' };
export const dynamic = 'force-dynamic';

const ROADMAP = [
  { sprint: 'Sprint 0', title: 'Plataforma base', detail: 'Auth, workspace, schema, logging, testes.', done: true },
  { sprint: 'Sprint 1', title: 'Contatos', detail: 'Listas, tags, consentimento e suppression.', done: true },
  { sprint: 'Sprint 2', title: 'Provider Meta', detail: 'Canal, templates e envio individual.', done: true },
  { sprint: 'Sprint 3', title: 'Webhooks', detail: 'Eventos, mensagens e status.', done: true },
  { sprint: 'Sprint 4', title: 'Campanhas', detail: 'Destinatários e elegibilidade.', done: true },
  { sprint: 'Sprint 5', title: 'Fila', detail: 'Worker, retry e idempotência.', done: true },
  { sprint: 'Sprint 6', title: 'Inbox', detail: 'Atendimento, notas, mídia e webhook assíncrono.', done: true },
  { sprint: 'Sprint 7', title: 'Analytics', detail: 'Relatórios e auditoria.', done: false },
] as const;

export default async function DashboardPage() {
  const context = await requireWorkspace();
  const [overview, readiness] = await Promise.all([
    getWorkspaceOverview(context.workspace.id),
    assessSendReadiness(context.workspace.id),
  ]);

  return (
    <>
      <PageHeader
        title={`Painel — ${context.workspace.name}`}
        description="Visão geral da operação. Todos os números vêm do banco, sem dados simulados."
      />

      <section aria-label="Prontidão para disparo" className="mb-6">
        <SendReadiness report={readiness} />
      </section>

      <section aria-label="Indicadores" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="Contatos ativos" value={overview.contacts} icon={Users} />
        <StatCard label="Suprimidos" value={overview.suppressed} icon={ShieldBan} />
        <StatCard label="Campanhas" value={overview.campaigns} icon={Megaphone} />
        <StatCard label="Conversas" value={overview.conversations} icon={Inbox} />
        <StatCard label="Mensagens enviadas" value={overview.messagesSent} icon={MessageSquare} />
        <StatCard
          label="Canais conectados"
          value={overview.channels}
          icon={Radio}
          hint="Um canal só conta como conectado após validação com o provider."
        />
      </section>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Estado da construção</CardTitle>
          <CardDescription>
            Cada fase só é marcada como concluída com UI, backend, banco, validação, autorização,
            tratamento de erros, testes e documentação.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="divide-y divide-border">
            {ROADMAP.map((item) => (
              <li key={item.sprint} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                <span
                  aria-hidden="true"
                  className={
                    item.done
                      ? 'mt-1.5 size-2 shrink-0 rounded-full bg-success'
                      : 'mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground/30'
                  }
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {item.sprint} — {item.title}
                    <span className="sr-only">{item.done ? ' (concluído)' : ' (pendente)'}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">{item.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </>
  );
}
