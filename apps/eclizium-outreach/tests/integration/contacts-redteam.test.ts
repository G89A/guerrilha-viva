/**
 * RED TEAM — abuso e concorrência (§28).
 *
 * Complementa `contacts-tenancy.test.ts`: aqui o alvo não é o vizinho, é o
 * próprio sistema — duplo clique, corrida, entrada malformada, repetição.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ConsentChannel, ConsentStatus } from '@prisma/client';
import { archiveContact, createContact } from '@/features/contacts/service';
import { attachTag, resolveTag } from '@/features/contacts/tags-service';
import { addToList, resolveList } from '@/features/contacts/lists-service';
import { setConsent } from '@/features/consent/service';
import { suppressContact, unsuppressContact } from '@/features/suppression/service';
import { importContactsFromCsv } from '@/features/contacts/csv/import-service';
import { contactFiltersSchema } from '@/features/contacts/schemas';
import { isAppError } from '@/lib/errors/app-error';
import { disconnectTestPrisma, resetDatabase, testPrisma } from '../helpers/db';
import { seedContact, seedTenant, workspaceRef, type SeededTenant } from '../helpers/factories';

const prisma = testPrisma();

const CONTACT = {
  phone: '85 99999-0001',
  firstName: 'Alvo',
  lastName: null,
  email: null,
  company: null,
  segment: null,
  city: null,
  state: null,
  country: null,
  source: 'manual',
  notes: null,
};

describe('concorrência e repetição', () => {
  let tenant: SeededTenant;

  beforeEach(async () => {
    await resetDatabase();
    tenant = await seedTenant('redteam');
  });

  afterAll(disconnectTestPrisma);

  it('dupla submissão do formulário cria apenas um contato', async () => {
    const results = await Promise.allSettled([
      createContact(workspaceRef(tenant.workspaceId), CONTACT),
      createContact(workspaceRef(tenant.workspaceId), CONTACT),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    await expect(
      prisma.contact.count({ where: { workspaceId: tenant.workspaceId } }),
    ).resolves.toBe(1);
  });

  it('criações concorrentes do mesmo telefone: a perdedora recebe CONFLICT, não erro técnico', async () => {
    const results = await Promise.allSettled([
      createContact(workspaceRef(tenant.workspaceId), CONTACT),
      createContact(workspaceRef(tenant.workspaceId), CONTACT),
      createContact(workspaceRef(tenant.workspaceId), CONTACT),
    ]);

    const rejections = results.filter((result) => result.status === 'rejected');
    for (const rejection of rejections) {
      const reason = (rejection as PromiseRejectedResult).reason;
      expect(isAppError(reason) && reason.code).toBe('CONFLICT');
    }
  });

  it('aplicar a mesma tag duas vezes em paralelo não duplica o vínculo', async () => {
    const contactId = await seedContact(tenant.workspaceId, '+5585999990001');
    const tag = await resolveTag(tenant.workspaceId, { tagName: 'VIP' });

    await Promise.allSettled([
      attachTag(tenant.workspaceId, contactId, tag.id),
      attachTag(tenant.workspaceId, contactId, tag.id),
    ]);

    await expect(prisma.contactTag.count({ where: { contactId } })).resolves.toBe(1);
  });

  it('adicionar o mesmo contato à lista duas vezes em paralelo não duplica', async () => {
    const contactId = await seedContact(tenant.workspaceId, '+5585999990002');
    const list = await resolveList(tenant.workspaceId, { listName: 'Leads' });

    await Promise.allSettled([
      addToList(tenant.workspaceId, contactId, list.id),
      addToList(tenant.workspaceId, contactId, list.id),
    ]);

    await expect(prisma.contactListMember.count({ where: { contactId } })).resolves.toBe(1);
  });

  it('criar a mesma tag por dois caminhos ao mesmo tempo devolve a mesma tag', async () => {
    const [first, second] = await Promise.all([
      resolveTag(tenant.workspaceId, { tagName: 'Simultânea' }),
      resolveTag(tenant.workspaceId, { tagName: 'Simultânea' }),
    ]);

    expect(first.id).toBe(second.id);
    await expect(prisma.tag.count({ where: { workspaceId: tenant.workspaceId } })).resolves.toBe(1);
  });

  it('suprimir duas vezes em paralelo mantém uma única entrada', async () => {
    const contact = await createContact(workspaceRef(tenant.workspaceId), CONTACT);

    await Promise.allSettled([
      suppressContact({
        workspaceId: tenant.workspaceId,
        contactId: contact.id,
        actorUserId: tenant.userId,
      }),
      suppressContact({
        workspaceId: tenant.workspaceId,
        contactId: contact.id,
        actorUserId: tenant.userId,
      }),
    ]);

    await expect(
      prisma.suppressionEntry.count({ where: { workspaceId: tenant.workspaceId } }),
    ).resolves.toBe(1);
  });

  it('arquivar contato já arquivado não é erro e não muda a data original', async () => {
    const contact = await createContact(workspaceRef(tenant.workspaceId), CONTACT);
    await archiveContact(tenant.workspaceId, contact.id);

    const first = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    await archiveContact(tenant.workspaceId, contact.id);
    const second = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });

    expect(second.archivedAt?.getTime()).toBe(first.archivedAt?.getTime());
  });

  it('importações concorrentes do mesmo telefone gravam apenas um contato', async () => {
    const csv = 'telefone,nome\n85 99999-0001,João';
    const options = {
      workspaceId: tenant.workspaceId,
      phoneRegion: 'BR',
      csv,
      mapping: { phone: 0, firstName: 1 },
      source: 'concorrente',
      whatsappConsent: ConsentStatus.UNKNOWN,
    };

    await Promise.allSettled([
      importContactsFromCsv(options),
      importContactsFromCsv(options),
    ]);

    await expect(
      prisma.contact.count({ where: { workspaceId: tenant.workspaceId } }),
    ).resolves.toBe(1);
  });

  it('contato removido durante o processo não deixa consentimento órfão', async () => {
    const contact = await createContact(workspaceRef(tenant.workspaceId), CONTACT);
    await prisma.contact.delete({ where: { id: contact.id } });

    await expect(prisma.contactConsent.count()).resolves.toBe(0);
  });

  it('alterar consentimento de contato removido é recusado', async () => {
    const contact = await createContact(workspaceRef(tenant.workspaceId), CONTACT);
    await prisma.contact.delete({ where: { id: contact.id } });

    const attempt = await setConsent({
      workspaceId: tenant.workspaceId,
      contactId: contact.id,
      channel: ConsentChannel.WHATSAPP,
      status: ConsentStatus.GRANTED,
    }).catch((error: unknown) => error);

    expect(isAppError(attempt) && attempt.code).toBe('NOT_FOUND');
  });
});

describe('entrada malformada', () => {
  let tenant: SeededTenant;

  beforeEach(async () => {
    await resetDatabase();
    tenant = await seedTenant('malformed');
  });

  it.each([
    ['string vazia', ''],
    ['só espaços', '   '],
    ['letras', 'telefone'],
    ['só símbolos', '+++'],
    ['curto demais', '1'],
    ['injeção SQL', "'; DROP TABLE contacts; --"],
    ['muito longo', '9'.repeat(300)],
  ])('recusa telefone %s sem quebrar', async (_label, phone) => {
    const attempt = await createContact(workspaceRef(tenant.workspaceId), {
      ...CONTACT,
      phone,
    }).catch((error: unknown) => error);

    expect(isAppError(attempt) && attempt.code).toBe('VALIDATION_ERROR');
    // A tabela continua existindo, com zero linhas.
    await expect(prisma.contact.count()).resolves.toBe(0);
  });

  it('texto com aspas e ponto e vírgula é gravado como dado, não interpretado', async () => {
    const contact = await createContact(workspaceRef(tenant.workspaceId), {
      ...CONTACT,
      firstName: "Robert'); DROP TABLE contacts;--",
      company: '"; DELETE FROM users; --',
    });

    const stored = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(stored.firstName).toBe("Robert'); DROP TABLE contacts;--");
    await expect(prisma.user.count()).resolves.toBeGreaterThan(0);
  });

  it('busca com caracteres especiais não quebra a query', async () => {
    await seedContact(tenant.workspaceId, '+5585999990001', { firstName: 'Normal' });

    for (const search of ["100%", "_", "'", '"', '\\', '%_%', 'a%b']) {
      const page = await import('@/features/contacts/query').then((module) =>
        module.queryContacts(
          tenant.workspaceId,
          contactFiltersSchema.parse({ search }),
          'BR',
        ),
      );
      expect(page.total, `busca por ${search}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('página negativa ou absurda é recusada pelo schema', () => {
    expect(contactFiltersSchema.safeParse({ page: -1 }).success).toBe(false);
    expect(contactFiltersSchema.safeParse({ page: 999999 }).success).toBe(false);
  });

  it('remover supressão exige motivo com conteúdo', async () => {
    const contact = await createContact(workspaceRef(tenant.workspaceId), CONTACT);
    await suppressContact({
      workspaceId: tenant.workspaceId,
      contactId: contact.id,
      actorUserId: tenant.userId,
    });

    const { unsuppressSchema } = await import('@/features/contacts/schemas');
    expect(unsuppressSchema.safeParse({ contactId: contact.id, reason: 'oi' }).success).toBe(false);
    expect(
      unsuppressSchema.safeParse({ contactId: contact.id, reason: 'motivo suficiente' }).success,
    ).toBe(true);

    // E o serviço só é chamado depois de o schema aprovar.
    await unsuppressContact({
      workspaceId: tenant.workspaceId,
      contactId: contact.id,
      reason: 'motivo suficiente',
      actorUserId: tenant.userId,
    });
    await expect(prisma.suppressionEntry.count()).resolves.toBe(0);
  });
});
