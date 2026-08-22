import type { Metadata } from 'next';
import { ChannelEnvironment, ChannelStatus } from '@prisma/client';
import { CircleAlert, Info } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { IntegrationActions } from '@/components/integrations/integration-actions';
import { IntegrationStatusBadge } from '@/components/integrations/integration-status-badge';
import { MetaConfigurationForm } from '@/components/integrations/meta-configuration-form';
import { findChannel, toChannelView } from '@/features/messaging/channel-service';
import { getMetaEnvState } from '@/lib/env';
import { fingerprintSecret } from '@/lib/security/secret-box';
import { requireWorkspace } from '@/lib/auth/guards';
import { hasAtLeastRole, WorkspaceRole } from '@/lib/auth/roles';
import { formatDateTime } from '@/lib/utils';
import { WebhookEventsPanel } from '@/components/integrations/webhook-events-panel';
import { listFailedEvents, webhookEventSummary } from '@/features/webhooks/event-query';

export const metadata: Metadata = { title: 'Integrações' };
export const dynamic = 'force-dynamic';

/** Mostra só os últimos dígitos: suficiente para conferir, sem espalhar o id. */
function maskId(value: string | null): string {
  if (!value) return '—';
  return value.length <= 4 ? value : `${'•'.repeat(6)}${value.slice(-4)}`;
}

export default async function IntegrationsSettingsPage() {
  // Autorização antes de qualquer leitura: estado de integração é informação
  // operacional do workspace.
  const context = await requireWorkspace();
  const channel = await findChannel(context.workspace.id);
  const view = channel ? toChannelView(channel) : null;

  const canConfigure = hasAtLeastRole(context.role, WorkspaceRole.OWNER);
  const canOperate = hasAtLeastRole(context.role, WorkspaceRole.ADMIN);

  const [webhookSummary, failedEvents] = await Promise.all([
    webhookEventSummary(context.workspace.id),
    listFailedEvents(context.workspace.id),
  ]);

  const env = getMetaEnvState();
  const envFingerprint = env.configured ? fingerprintSecret(env.env.META_ACCESS_TOKEN) : null;

  const configured =
    view !== null && Boolean(view.wabaId) && Boolean(view.phoneNumberId) && view.credentials.present;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>WhatsApp Business</CardTitle>
            <CardDescription>
              Meta WhatsApp Business Platform — Cloud API oficial. As credenciais existem apenas no
              servidor e nunca são enviadas ao navegador.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {view ? <IntegrationStatusBadge status={view.status} /> : null}
            {view ? (
              <Badge variant={view.environment === ChannelEnvironment.PRODUCTION ? 'default' : 'neutral'}>
                {view.environment === ChannelEnvironment.PRODUCTION ? 'Produção' : 'Teste'}
              </Badge>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          {!view ? (
            <Alert variant="warning">
              <CircleAlert aria-hidden="true" />
              <AlertTitle>WhatsApp não conectado</AlertTitle>
              <AlertDescription>
                Conecte sua conta da Meta para sincronizar templates e realizar testes. Enquanto
                isso, nenhum envio acontece — e nada é simulado.
              </AlertDescription>
            </Alert>
          ) : null}

          {view && !view.credentials.present ? (
            <Alert variant="warning">
              <CircleAlert aria-hidden="true" />
              <AlertTitle>Credencial ausente</AlertTitle>
              <AlertDescription>
                Falta: {view.credentials.missing.join(', ')}.
              </AlertDescription>
            </Alert>
          ) : null}

          {view?.status === ChannelStatus.CONNECTED ? null : view && configured ? (
            <Alert variant="info">
              <Info aria-hidden="true" />
              <AlertTitle>Ainda não verificado</AlertTitle>
              <AlertDescription>
                As credenciais estão salvas, mas ainda não foram validadas contra a Graph API.
                Credencial presente não é o mesmo que integração funcionando — use “Testar conexão”.
              </AlertDescription>
            </Alert>
          ) : null}

          {view?.lastError ? (
            <Alert variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertTitle>Última verificação falhou</AlertTitle>
              <AlertDescription>{view.lastError}</AlertDescription>
            </Alert>
          ) : null}

          {view ? (
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Número</dt>
                <dd className="font-medium">{view.displayPhoneNumber ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Verified name</dt>
                <dd className="font-medium">{view.verifiedName ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">WABA ID</dt>
                <dd className="font-mono text-xs">{maskId(view.wabaId)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Phone Number ID</dt>
                <dd className="font-mono text-xs">{maskId(view.phoneNumberId)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Graph API</dt>
                <dd className="font-medium">{view.graphApiVersion}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Access Token</dt>
                <dd className="font-mono text-xs">
                  {view.credentials.fingerprint ?? '••••••••••••••••••••••••'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Última verificação</dt>
                <dd>{view.lastVerifiedAt ? formatDateTime(view.lastVerifiedAt) : 'Nunca'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Conectado desde</dt>
                <dd>{view.connectedAt ? formatDateTime(view.connectedAt) : '—'}</dd>
              </div>
            </dl>
          ) : null}

          <IntegrationActions
            canOperate={canOperate}
            canConfigure={canConfigure}
            configured={configured}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configuração</CardTitle>
          <CardDescription>
            Permissões necessárias no token da Meta: <code>whatsapp_business_messaging</code> para
            enviar e <code>whatsapp_business_management</code> para ler templates.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canConfigure ? (
            <MetaConfigurationForm channel={view} envFingerprint={envFingerprint} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Apenas quem tem papel OWNER pode alterar a configuração da integração.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Variáveis de ambiente</CardTitle>
          <CardDescription>
            Usadas quando a credencial é lida do ambiente. Definidas no servidor, nunca no bundle.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {(['META_ACCESS_TOKEN', 'META_WABA_ID', 'META_PHONE_NUMBER_ID', 'META_GRAPH_API_VERSION', 'META_WEBHOOK_VERIFY_TOKEN', 'META_APP_SECRET'] as const).map(
            (key) => {
              const missing = !env.configured && env.missing.includes(key);
              return (
                <div key={key} className="flex items-center justify-between gap-3">
                  <code className="text-xs">{key}</code>
                  <Badge variant={missing ? 'warning' : 'success'}>
                    {missing ? 'Ausente' : 'Definida'}
                  </Badge>
                </div>
              );
            },
          )}
          <Separator className="my-2" />
          <p className="text-xs text-muted-foreground">
            <code>META_WEBHOOK_VERIFY_TOKEN</code> e <code>META_APP_SECRET</code> não aparecem no
            formulário acima porque pertencem ao <strong>app da Meta</strong>, não ao workspace:
            defina as duas nas variáveis de ambiente da hospedagem. A primeira é uma string que
            você inventa e repete no cadastro do webhook na Meta; a segunda vem do painel do app.
            Sem as duas a rota de webhook <strong>recusa toda entrega</strong> em vez de aceitar
            sem verificar assinatura — o envio acontece, mas status de entrega e respostas não
            chegam.
          </p>
        </CardContent>
      </Card>
      <WebhookEventsPanel
        summary={webhookSummary}
        failed={failedEvents}
        canRequeue={canOperate}
      />

    </div>
  );
}
