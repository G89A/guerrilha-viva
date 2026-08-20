import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Pencil } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { ArchiveButton } from '@/components/contacts/archive-button';
import { ContactStatusBadge, SuppressionBadge } from '@/components/contacts/badges';
import {
  ConsentPanel,
  ListSelector,
  SuppressionPanel,
  TagSelector,
} from '@/components/contacts/contact-detail-panels';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getContactDetail } from '@/features/contacts/query';
import { formatPhone } from '@/features/contacts/phone';
import { SUPPRESSION_REASON_LABELS } from '@/features/suppression/service';
import { requireWorkspace } from '@/lib/auth/guards';
import { hasAtLeastRole, WorkspaceRole } from '@/lib/auth/roles';
import { prisma } from '@/lib/db/client';
import { formatDateTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Contato' };
export const dynamic = 'force-dynamic';

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value && value.length > 0 ? value : '—'}</dd>
    </div>
  );
}

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await requireWorkspace();
  const { id } = await params;

  // Um id de outro workspace não é encontrado: a página é um 404, nunca uma
  // pista de que aquele contato existe em algum lugar.
  const contact = await getContactDetail(context.workspace.id, id);
  if (!contact) notFound();

  const auditEntries = await prisma.auditLog.findMany({
    where: { workspaceId: context.workspace.id, resourceType: 'Contact', resourceId: contact.id },
    include: { actor: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });

  const canWrite = hasAtLeastRole(context.role, WorkspaceRole.MEMBER);
  const canUnsuppress = hasAtLeastRole(context.role, WorkspaceRole.ADMIN);
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Sem nome';

  return (
    <>
      <PageHeader
        title={name}
        description={formatPhone(contact.phoneE164)}
        actions={
          <>
            <ContactStatusBadge status={contact.status} />
            <SuppressionBadge suppressed={contact.suppressions.length > 0} />
            {canWrite ? (
              <>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/contacts/${contact.id}/edit`}>
                    <Pencil aria-hidden="true" />
                    Editar
                  </Link>
                </Button>
                <ArchiveButton contactId={contact.id} status={contact.status} />
              </>
            ) : null}
          </>
        }
      />

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Dados</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Detail label="Telefone (E.164)" value={contact.phoneE164} />
                <Detail label="Telefone informado" value={contact.phone} />
                <Detail label="E-mail" value={contact.email} />
                <Detail label="Empresa" value={contact.company} />
                <Detail label="Segmento" value={contact.segment} />
                <Detail label="Cidade" value={contact.city} />
                <Detail label="Estado" value={contact.state} />
                <Detail label="País" value={contact.country} />
                <Detail label="Origem" value={contact.source} />
                <Detail label="Criado em" value={formatDateTime(contact.createdAt)} />
                <Detail label="Atualizado em" value={formatDateTime(contact.updatedAt)} />
                <Detail
                  label="Arquivado em"
                  value={contact.archivedAt ? formatDateTime(contact.archivedAt) : null}
                />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Observações</CardTitle>
            </CardHeader>
            <CardContent>
              {contact.notes ? (
                <p className="whitespace-pre-wrap text-sm">{contact.notes}</p>
              ) : (
                <p className="text-sm text-muted-foreground">Sem observações.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Histórico</CardTitle>
            </CardHeader>
            <CardContent>
              {auditEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma ação registrada ainda.</p>
              ) : (
                <ol className="divide-y divide-border">
                  {auditEntries.map((entry) => (
                    <li key={entry.id} className="flex justify-between gap-3 py-2 text-sm">
                      <span>
                        <span className="font-medium">{entry.action}</span>
                        <span className="block text-xs text-muted-foreground">
                          {entry.actor?.name ?? 'Sistema'}
                        </span>
                      </span>
                      <span className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDateTime(entry.createdAt)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <TagSelector
            contactId={contact.id}
            tags={contact.tags.map((link) => ({ id: link.tag.id, name: link.tag.name }))}
            canWrite={canWrite}
          />
          <ListSelector
            contactId={contact.id}
            lists={contact.listMembers.map((link) => ({
              id: link.list.id,
              name: link.list.name,
            }))}
            canWrite={canWrite}
          />
          <ConsentPanel
            contactId={contact.id}
            consents={contact.consents.map((consent) => ({
              channel: consent.channel,
              status: consent.status,
              capturedAt: consent.capturedAt,
            }))}
            canWrite={canWrite}
          />
          <SuppressionPanel
            contactId={contact.id}
            suppressions={contact.suppressions.map((entry) => ({
              id: entry.id,
              channel: entry.channel,
              reason: SUPPRESSION_REASON_LABELS[entry.reason],
              createdAt: entry.createdAt,
            }))}
            canWrite={canWrite}
            canUnsuppress={canUnsuppress}
          />
        </div>
      </div>
    </>
  );
}
