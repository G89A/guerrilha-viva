import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { ChannelStatus, ConsentChannel, ConsentStatus, ContactStatus, TemplateStatus } from '@prisma/client';
import { PageHeader } from '@/components/layout/page-header';
import { TemplateStatusBadge } from '@/components/templates/template-status-badge';
import {
  parseButtons,
  WhatsAppTemplatePreview,
} from '@/components/templates/whatsapp-template-preview';
import { SendTestDialog, type SelectableContact } from '@/components/templates/send-test-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { getTemplateDetail } from '@/features/messaging/template-query';
import { findChannel } from '@/features/messaging/channel-service';
import type { TemplateVariable } from '@/features/messaging/template-normalize';
import { prisma } from '@/lib/db/client';
import { requireWorkspace } from '@/lib/auth/guards';
import { hasAtLeastRole, WorkspaceRole } from '@/lib/auth/roles';
import { formatDateTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Template' };
export const dynamic = 'force-dynamic';

/** Candidatos ao envio de teste: ativos, com consentimento e sem supressão. */
async function eligibleContacts(workspaceId: string): Promise<SelectableContact[]> {
  const contacts = await prisma.contact.findMany({
    where: {
      workspaceId,
      status: ContactStatus.ACTIVE,
      consents: { some: { channel: ConsentChannel.WHATSAPP, status: ConsentStatus.GRANTED } },
      suppressions: { none: {} },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      company: true,
      city: true,
      segment: true,
      phoneE164: true,
    },
  });

  return contacts.map((contact) => ({
    id: contact.id,
    label:
      [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim() || 'Sem nome',
    phoneE164: contact.phoneE164,
    firstName: contact.firstName,
    lastName: contact.lastName,
    company: contact.company,
    city: contact.city,
    segment: contact.segment,
  }));
}

export default async function TemplateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await requireWorkspace();
  const { id } = await params;

  // Escopado ao workspace: um id de outro tenant simplesmente não existe aqui.
  const template = await getTemplateDetail(context.workspace.id, id);
  if (!template) notFound();

  const [channel, contacts] = await Promise.all([
    findChannel(context.workspace.id),
    eligibleContacts(context.workspace.id),
  ]);

  const variables = (template.variables as unknown as TemplateVariable[]) ?? [];
  const buttons = parseButtons(template.buttons);
  const canSend = hasAtLeastRole(context.role, WorkspaceRole.ADMIN);
  const channelReady = channel?.status === ChannelStatus.CONNECTED;
  const approved = template.status === TemplateStatus.APPROVED;

  return (
    <>
      <PageHeader
        title={template.name}
        description={`${template.language} · ${template.category}`}
        actions={
          <Button asChild variant="ghost">
            <Link href="/templates">
              <ArrowLeft aria-hidden="true" className="mr-1 size-4" />
              Voltar
            </Link>
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Conteúdo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <WhatsAppTemplatePreview
                headerFormat={template.headerFormat}
                headerText={template.headerText}
                body={template.body}
                footerText={template.footerText}
                buttons={buttons}
              />

              {variables.length > 0 ? (
                <div>
                  <p className="mb-1 text-sm font-medium">Variáveis</p>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {variables.map((variable) => (
                      <li key={`${variable.component}:${variable.key}`}>
                        <code className="text-xs">{`{{${variable.key}}}`}</code> em{' '}
                        {variable.component === 'header' ? 'cabeçalho' : 'corpo'} — sem origem
                        pré-definida; você escolhe no envio.
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Este template não tem variáveis.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Enviar teste</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!approved ? (
                <Alert variant="warning">
                  <AlertTitle>Template não aprovado</AlertTitle>
                  <AlertDescription>
                    A Meta reporta este template como {template.providerStatus ?? template.status}.
                    Só templates APPROVED podem ser enviados.
                  </AlertDescription>
                </Alert>
              ) : null}

              {!channelReady ? (
                <Alert variant="warning">
                  <AlertTitle>Canal não conectado</AlertTitle>
                  <AlertDescription>
                    Verifique a integração em Configurações → Integrações antes de enviar.
                  </AlertDescription>
                </Alert>
              ) : null}

              {approved && channelReady ? (
                <SendTestDialog
                  templateId={template.id}
                  templateName={template.name}
                  language={template.language}
                  headerFormat={template.headerFormat}
                  headerText={template.headerText}
                  body={template.body}
                  footerText={template.footerText}
                  buttons={buttons}
                  variables={variables}
                  contacts={contacts}
                  canSend={canSend}
                />
              ) : null}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Detalhes</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Status</dt>
                <dd className="mt-1">
                  <TemplateStatusBadge
                    status={template.status}
                    providerStatus={template.providerStatus}
                    availability={template.availability}
                  />
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Status na Meta</dt>
                <dd className="font-mono text-xs">{template.providerStatus ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Categoria</dt>
                <dd>{template.providerCategory ?? template.category}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Idioma</dt>
                <dd>{template.language}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Qualidade</dt>
                <dd>{template.qualityScore ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Provider template ID</dt>
                <dd className="font-mono text-xs break-all">
                  {template.providerTemplateId ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Última sincronização</dt>
                <dd>{template.syncedAt ? formatDateTime(template.syncedAt) : '—'}</dd>
              </div>
              {template.rejectedReason ? (
                <div>
                  <dt className="text-muted-foreground">Motivo da rejeição</dt>
                  <dd>{template.rejectedReason}</dd>
                </div>
              ) : null}
            </dl>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
