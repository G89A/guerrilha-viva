import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { ContactForm } from '@/components/contacts/contact-form';
import { Card, CardContent } from '@/components/ui/card';
import { getContactOrThrow } from '@/features/contacts/service';
import { requireWorkspace } from '@/lib/auth/guards';
import { hasAtLeastRole, WorkspaceRole } from '@/lib/auth/roles';
import { isAppError } from '@/lib/errors/app-error';

export const metadata: Metadata = { title: 'Editar contato' };
export const dynamic = 'force-dynamic';

export default async function EditContactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await requireWorkspace();
  if (!hasAtLeastRole(context.role, WorkspaceRole.MEMBER)) notFound();

  const { id } = await params;

  let contact;
  try {
    contact = await getContactOrThrow(context.workspace.id, id);
  } catch (error) {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  return (
    <>
      <PageHeader title="Editar contato" description={contact.phoneE164} />
      <Card className="max-w-3xl">
        <CardContent className="pt-5">
          <ContactForm
            mode="edit"
            defaults={{
              contactId: contact.id,
              // O campo mostra o telefone como foi informado; se veio de uma
              // importação antiga sem `phone`, cai para o E.164.
              phone: contact.phone ?? contact.phoneE164,
              firstName: contact.firstName ?? '',
              lastName: contact.lastName ?? '',
              email: contact.email ?? '',
              company: contact.company ?? '',
              segment: contact.segment ?? '',
              city: contact.city ?? '',
              state: contact.state ?? '',
              country: contact.country ?? '',
              source: contact.source ?? '',
              notes: contact.notes ?? '',
            }}
          />
        </CardContent>
      </Card>
    </>
  );
}
