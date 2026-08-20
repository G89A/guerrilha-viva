import type { Metadata } from 'next';
import { CheckCircle2, CircleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getMetaIntegrationState, META_ENV_KEYS } from '@/features/messaging/channel-status';
import { requireWorkspace } from '@/lib/auth/guards';

export const metadata: Metadata = { title: 'Integrações' };
export const dynamic = 'force-dynamic';

export default async function IntegrationsSettingsPage() {
  // Authorisation first: integration state is workspace-operator information.
  await requireWorkspace();
  const integration = getMetaIntegrationState();
  const missing = integration.status === 'NOT_CONFIGURED' ? integration.missing : [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Meta WhatsApp Business Cloud API</CardTitle>
            <CardDescription>
              Provedor oficial de mensageria. As credenciais existem apenas no servidor e nunca são
              enviadas ao navegador.
            </CardDescription>
          </div>
          <Badge variant={integration.status === 'NOT_CONFIGURED' ? 'warning' : 'success'}>
            {integration.status}
          </Badge>
        </CardHeader>

        <CardContent className="space-y-4">
          {integration.status === 'NOT_CONFIGURED' ? (
            <Alert variant="warning">
              <CircleAlert aria-hidden="true" />
              <AlertTitle>Integração não configurada</AlertTitle>
              <AlertDescription>
                Defina as variáveis abaixo no ambiente do servidor e reinicie a aplicação. Enquanto
                isso, nenhum envio, sincronização de template ou webhook funcionará — e nada será
                simulado.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="info">
              <CheckCircle2 aria-hidden="true" />
              <AlertTitle>Credenciais presentes</AlertTitle>
              <AlertDescription>
                As variáveis estão definidas, mas ainda não foram validadas contra a Graph API. A
                verificação real do token e do número entra na Sprint 2 — até lá, considere o canal
                como não verificado.
              </AlertDescription>
            </Alert>
          )}

          <div>
            <h2 className="mb-2 text-sm font-medium">Variáveis de ambiente</h2>
            <ul className="divide-y divide-border rounded-md border border-border">
              {META_ENV_KEYS.map((key) => {
                const isMissing = missing.includes(key);
                return (
                  <li key={key} className="flex items-center justify-between gap-3 px-3 py-2">
                    <code className="truncate font-mono text-xs">{key}</code>
                    <Badge variant={isMissing ? 'destructive' : 'success'}>
                      {isMissing ? 'ausente' : 'definida'}
                    </Badge>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              Valores nunca são exibidos, nem no estado &ldquo;definida&rdquo;.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Webhook</CardTitle>
          <CardDescription>Recepção de status e mensagens recebidas.</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertTitle>Endpoint ainda não publicado</AlertTitle>
            <AlertDescription>
              As rotas <code className="font-mono text-xs">/api/webhooks/meta/whatsapp</code> (GET
              de verificação e POST de eventos) são entregues na Sprint 3. Não configure o webhook
              no painel da Meta antes disso.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}
