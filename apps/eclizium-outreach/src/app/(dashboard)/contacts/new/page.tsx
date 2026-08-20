import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { ContactForm } from '@/components/contacts/contact-form';
import { Card, CardContent } from '@/components/ui/card';
import { requireWorkspace } from '@/lib/auth/guards';
import { hasAtLeastRole, WorkspaceRole } from '@/lib/auth/roles';

export const metadata: Metadata = { title: 'Novo contato' };
export const dynamic = 'force-dynamic';

export default async function NewContactPage() {
  const context = await requireWorkspace();
  if (!hasAtLeastRole(context.role, WorkspaceRole.MEMBER)) notFound();

  return (
    <>
      <PageHeader
        title="Novo contato"
        description={`Telefones sem código de país usam a região ${context.workspace.defaultPhoneRegion}.`}
      />
      <Card className="max-w-3xl">
        <CardContent className="pt-5">
          <ContactForm
            mode="create"
            defaults={{
              phone: '',
              firstName: '',
              lastName: '',
              email: '',
              company: '',
              segment: '',
              city: '',
              state: '',
              country: '',
              source: '',
              notes: '',
            }}
          />
        </CardContent>
      </Card>
    </>
  );
}
