import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ConsentChannel, ConsentStatus, ContactStatus } from '@prisma/client';
import { queryContacts, contactFilterOptions } from '@/features/contacts/query';
import { contactFiltersSchema, CONTACTS_PAGE_SIZE } from '@/features/contacts/schemas';
import { archiveContact, createContact } from '@/features/contacts/service';
import { attachTag, resolveTag } from '@/features/contacts/tags-service';
import { addToList, resolveList } from '@/features/contacts/lists-service';
import { setConsent } from '@/features/consent/service';
import { suppressContact } from '@/features/suppression/service';
import { disconnectTestPrisma, resetDatabase, testPrisma } from '../helpers/db';
import { seedContact, seedTenant, workspaceRef, type SeededTenant } from '../helpers/factories';

const prisma = testPrisma();

function filters(input: Record<string, unknown> = {}) {
  return contactFiltersSchema.parse(input);
}

describe('busca e filtros', () => {
  let tenant: SeededTenant;

  beforeEach(async () => {
    await resetDatabase();
    tenant = await seedTenant('query');

    await seedContact(tenant.workspaceId, '+5585999990001', {
      firstName: 'João',
      lastName: 'Silva',
      email: 'joao@acme.com',
      company: 'ACME',
      city: 'Fortaleza',
      source: 'site',
    });
    await seedContact(tenant.workspaceId, '+5511988880002', {
      firstName: 'Maria',
      lastName: 'Souza',
      email: 'maria@contoso.com',
      company: 'Contoso',
      city: 'São Paulo',
      source: 'evento',
    });
    await seedContact(tenant.workspaceId, '+5521977770003', {
      firstName: 'Pedro',
      lastName: 'Lima',
      email: 'pedro@acme.com',
      company: 'ACME',
      city: 'Rio de Janeiro',
      source: 'site',
    });
  });

  afterAll(disconnectTestPrisma);

  it.each([
    ['nome', 'João', 1],
    ['sobrenome', 'Souza', 1],
    ['empresa', 'ACME', 2],
    ['e-mail', 'acme.com', 2],
    ['parcial no nome', 'ped', 1],
    ['sem resultado', 'inexistente', 0],
  ])('busca por %s', async (_label, search, expected) => {
    const page = await queryContacts(tenant.workspaceId, filters({ search }), 'BR');
    expect(page.total).toBe(expected);
  });

  it('busca ignora diferença de caixa', async () => {
    const lower = await queryContacts(tenant.workspaceId, filters({ search: 'joão' }), 'BR');
    const upper = await queryContacts(tenant.workspaceId, filters({ search: 'JOÃO' }), 'BR');
    expect(lower.total).toBe(1);
    expect(upper.total).toBe(1);
  });

  it('busca por telefone em formato local encontra o E.164 armazenado', async () => {
    const page = await queryContacts(
      tenant.workspaceId,
      filters({ search: '(85) 99999-0001' }),
      'BR',
    );
    expect(page.total).toBe(1);
    expect(page.rows[0]?.phoneE164).toBe('+5585999990001');
  });

  it('busca por trecho de dígitos do telefone', async () => {
    const page = await queryContacts(tenant.workspaceId, filters({ search: '98888' }), 'BR');
    expect(page.total).toBe(1);
  });

  it('filtra por status', async () => {
    const contacts = await prisma.contact.findMany({ where: { workspaceId: tenant.workspaceId } });
    await archiveContact(tenant.workspaceId, contacts[0]!.id);

    const active = await queryContacts(
      tenant.workspaceId,
      filters({ status: ContactStatus.ACTIVE }),
      'BR',
    );
    const archived = await queryContacts(
      tenant.workspaceId,
      filters({ status: ContactStatus.ARCHIVED }),
      'BR',
    );

    expect(active.total).toBe(2);
    expect(archived.total).toBe(1);
  });

  it.each([
    ['cidade', { city: 'Fortaleza' }, 1],
    ['origem', { source: 'site' }, 2],
  ])('filtra por %s', async (_label, filter, expected) => {
    const page = await queryContacts(tenant.workspaceId, filters(filter), 'BR');
    expect(page.total).toBe(expected);
  });

  it('filtra por tag', async () => {
    const contacts = await prisma.contact.findMany({ where: { workspaceId: tenant.workspaceId } });
    const tag = await resolveTag(tenant.workspaceId, { tagName: 'VIP' });
    await attachTag(tenant.workspaceId, contacts[0]!.id, tag.id);

    const page = await queryContacts(tenant.workspaceId, filters({ tagId: tag.id }), 'BR');
    expect(page.total).toBe(1);
    expect(page.rows[0]?.tags.map((item) => item.name)).toEqual(['VIP']);
  });

  it('filtra por lista', async () => {
    const contacts = await prisma.contact.findMany({ where: { workspaceId: tenant.workspaceId } });
    const list = await resolveList(tenant.workspaceId, { listName: 'Leads' });
    await addToList(tenant.workspaceId, contacts[0]!.id, list.id);

    const page = await queryContacts(tenant.workspaceId, filters({ listId: list.id }), 'BR');
    expect(page.total).toBe(1);
  });

  it('filtra por consentimento, tratando ausência de registro como UNKNOWN', async () => {
    const contacts = await prisma.contact.findMany({
      where: { workspaceId: tenant.workspaceId },
      orderBy: { phoneE164: 'asc' },
    });
    await setConsent({
      workspaceId: tenant.workspaceId,
      contactId: contacts[0]!.id,
      channel: ConsentChannel.WHATSAPP,
      status: ConsentStatus.GRANTED,
    });

    const granted = await queryContacts(
      tenant.workspaceId,
      filters({ consent: ConsentStatus.GRANTED }),
      'BR',
    );
    const unknown = await queryContacts(
      tenant.workspaceId,
      filters({ consent: ConsentStatus.UNKNOWN }),
      'BR',
    );

    expect(granted.total).toBe(1);
    // Os outros dois nunca tiveram registro: contam como desconhecidos.
    expect(unknown.total).toBe(2);
  });

  it('filtra por supressão nos dois sentidos', async () => {
    const contacts = await prisma.contact.findMany({ where: { workspaceId: tenant.workspaceId } });
    await suppressContact({
      workspaceId: tenant.workspaceId,
      contactId: contacts[0]!.id,
      actorUserId: tenant.userId,
    });

    const suppressed = await queryContacts(tenant.workspaceId, filters({ suppressed: 'yes' }), 'BR');
    const clean = await queryContacts(tenant.workspaceId, filters({ suppressed: 'no' }), 'BR');

    expect(suppressed.total).toBe(1);
    expect(suppressed.rows[0]?.suppressed).toBe(true);
    expect(clean.total).toBe(2);
  });

  it('combina filtros de forma restritiva', async () => {
    const page = await queryContacts(
      tenant.workspaceId,
      filters({ search: 'ACME', city: 'Fortaleza' }),
      'BR',
    );
    expect(page.total).toBe(1);
  });

  it('descarta filtro inválido em vez de propagar', () => {
    const parsed = contactFiltersSchema.safeParse({ status: 'DELETED', page: 'abc' });
    expect(parsed.success).toBe(false);
  });

  it('oferece apenas cidades e origens do próprio workspace', async () => {
    const other = await seedTenant('outro');
    await seedContact(other.workspaceId, '+5599999990001', { city: 'Manaus', source: 'alheia' });

    const options = await contactFilterOptions(tenant.workspaceId);
    expect(options.cities).toEqual(['Fortaleza', 'Rio de Janeiro', 'São Paulo']);
    expect(options.cities).not.toContain('Manaus');
    expect(options.sources).not.toContain('alheia');
  });
});

describe('paginação', () => {
  let tenant: SeededTenant;

  beforeEach(async () => {
    await resetDatabase();
    tenant = await seedTenant('page');

    for (let index = 0; index < CONTACTS_PAGE_SIZE + 5; index += 1) {
      await createContact(workspaceRef(tenant.workspaceId), {
        phone: `8599${String(index).padStart(6, '0')}`,
        firstName: `Contato ${index}`,
        lastName: null,
        email: null,
        company: null,
        segment: null,
        city: null,
        state: null,
        country: null,
        source: 'seed',
        notes: null,
      });
    }
  });

  it('nunca devolve mais que uma página, mesmo com base maior', async () => {
    const page = await queryContacts(tenant.workspaceId, filters(), 'BR');

    expect(page.rows).toHaveLength(CONTACTS_PAGE_SIZE);
    expect(page.total).toBe(CONTACTS_PAGE_SIZE + 5);
    expect(page.pageCount).toBe(2);
  });

  it('a segunda página traz o restante, sem repetir registros', async () => {
    const first = await queryContacts(tenant.workspaceId, filters(), 'BR');
    const second = await queryContacts(tenant.workspaceId, filters({ page: 2 }), 'BR');

    expect(second.rows).toHaveLength(5);
    const ids = new Set([...first.rows, ...second.rows].map((row) => row.id));
    expect(ids.size).toBe(CONTACTS_PAGE_SIZE + 5);
  });

  it('página além do fim devolve lista vazia, não erro', async () => {
    const page = await queryContacts(tenant.workspaceId, filters({ page: 99 }), 'BR');
    expect(page.rows).toHaveLength(0);
    expect(page.total).toBe(CONTACTS_PAGE_SIZE + 5);
  });

  it('a ordenação é estável entre chamadas', async () => {
    const first = await queryContacts(tenant.workspaceId, filters(), 'BR');
    const again = await queryContacts(tenant.workspaceId, filters(), 'BR');
    expect(first.rows.map((row) => row.id)).toEqual(again.rows.map((row) => row.id));
  });
});
