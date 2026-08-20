import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { ImportWizard } from '@/components/contacts/import-wizard';
import { requireWorkspace } from '@/lib/auth/guards';
import { hasAtLeastRole, WorkspaceRole } from '@/lib/auth/roles';

export const metadata: Metadata = { title: 'Importar contatos' };
export const dynamic = 'force-dynamic';

export default async function ImportContactsPage() {
  const context = await requireWorkspace();
  if (!hasAtLeastRole(context.role, WorkspaceRole.MEMBER)) notFound();

  return (
    <>
      <PageHeader
        title="Importar contatos"
        description="Nenhuma linha entra sem passar por validação. O relatório final mostra tudo que ficou de fora."
      />
      <ImportWizard phoneRegion={context.workspace.defaultPhoneRegion} />
    </>
  );
}
