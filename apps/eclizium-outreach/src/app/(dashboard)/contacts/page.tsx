import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus, Upload } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { ContactFilters } from '@/components/contacts/contact-filters';
import { ContactTable } from '@/components/contacts/contact-table';
import { Pagination } from '@/components/contacts/pagination';
import { Button } from '@/components/ui/button';
import { contactFiltersSchema } from '@/features/contacts/schemas';
import { contactFilterOptions, queryContacts } from '@/features/contacts/query';
import { listTags } from '@/features/contacts/tags-service';
import { listContactLists } from '@/features/contacts/lists-service';
import { requireWorkspace } from '@/lib/auth/guards';
import { hasAtLeastRole, WorkspaceRole } from '@/lib/auth/roles';

export const metadata: Metadata = { title: 'Contatos' };
export const dynamic = 'force-dynamic';

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireWorkspace();
  const raw = await searchParams;

  // Query string é entrada do usuário: passa pelo mesmo portão de validação
  // que um formulário. Valores inválidos são descartados, não propagados.
  const parsed = contactFiltersSchema.safeParse(raw);
  const filters = parsed.success ? parsed.data : contactFiltersSchema.parse({});

  const [page, options, tags, lists] = await Promise.all([
    queryContacts(context.workspace.id, filters, context.workspace.defaultPhoneRegion),
    contactFilterOptions(context.workspace.id),
    listTags(context.workspace.id),
    listContactLists(context.workspace.id),
  ]);

  const canWrite = hasAtLeastRole(context.role, WorkspaceRole.MEMBER);
  const hasFilters = Object.entries(filters).some(
    ([key, value]) => key !== 'page' && value !== undefined,
  );

  return (
    <>
      <PageHeader
        title="Contatos"
        description={`${page.total} ${page.total === 1 ? 'contato' : 'contatos'} neste workspace.`}
        actions={
          canWrite ? (
            <>
              <Button asChild variant="outline">
                <Link href="/contacts/import">
                  <Upload aria-hidden="true" />
                  Importar
                </Link>
              </Button>
              <Button asChild>
                <Link href="/contacts/new">
                  <Plus aria-hidden="true" />
                  Novo contato
                </Link>
              </Button>
            </>
          ) : null
        }
      />

      <ContactFilters
        options={{
          tags: tags.map((tag) => ({ id: tag.id, name: tag.name })),
          lists: lists.map((list) => ({ id: list.id, name: list.name })),
          cities: options.cities,
          sources: options.sources,
        }}
      />

      <ContactTable rows={page.rows} hasFilters={hasFilters} canWrite={canWrite} />

      <Pagination
        page={page.page}
        pageCount={page.pageCount}
        total={page.total}
        pageSize={page.pageSize}
      />
    </>
  );
}
