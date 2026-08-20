/**
 * RED TEAM — SPRINT 1.
 *
 * User B, autenticado no Workspace B, tenta operar sobre Contact A, do
 * Workspace A. Toda tentativa aqui precisa terminar em recusa: nada de leitura,
 * nada de escrita, nada de vínculo, e nenhuma pista de que Contact A existe.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ConsentChannel, ConsentStatus, ContactStatus } from '@prisma/client';
import {
  archiveContact,
  createContact,
  getContactOrThrow,
  restoreContact,
  updateContact,
} from '@/features/contacts/service';
import { getContactDetail, queryContacts } from '@/features/contacts/query';
import { attachTag, resolveTag } from '@/features/contacts/tags-service';
import { addToList, resolveList } from '@/features/contacts/lists-service';
import { setConsent } from '@/features/consent/service';
import { suppressContact, unsuppressContact } from '@/features/suppression/service';
import { contactFiltersSchema } from '@/features/contacts/schemas';
import { isAppError } from '@/lib/errors/app-error';
import { disconnectTestPrisma, resetDatabase, testPrisma } from '../helpers/db';
import { seedTenant, workspaceRef, type SeededTenant } from '../helpers/factories';

const prisma = testPrisma();

const CONTACT = {
  phone: '85 99999-0001',
  firstName: 'Vítima',
  lastName: 'Silva',
  email: 'vitima@example.com',
  company: 'Alvo Ltda',
  segment: null,
  city: 'Fortaleza',
  state: 'CE',
  country: 'BR',
  source: 'manual',
  notes: 'confidencial',
};

const EMPTY_FILTERS = contactFiltersSchema.parse({});

describe('isolamento entre workspaces — operações de contato', () => {
  let attacker: SeededTenant;
  let victim: SeededTenant;
  let victimContactId: string;

  beforeEach(async () => {
    await resetDatabase();
    attacker = await seedTenant('attacker');
    victim = await seedTenant('victim');

    const contact = await createContact(workspaceRef(victim.workspaceId), {
      ...CONTACT,
      whatsappConsent: ConsentStatus.GRANTED,
    });
    victimContactId = contact.id;
  });

  afterAll(disconnectTestPrisma);

  it('LER: contato alheio não é encontrado pelo id', async () => {
    const attempt = await getContactOrThrow(attacker.workspaceId, victimContactId).catch(
      (error: unknown) => error,
    );
    expect(isAppError(attempt) && attempt.code).toBe('NOT_FOUND');
  });

  it('LER: a ficha completa de contato alheio devolve null', async () => {
    await expect(getContactDetail(attacker.workspaceId, victimContactId)).resolves.toBeNull();
  });

  it('LER: a listagem do atacante não mostra o contato alheio', async () => {
    const page = await queryContacts(attacker.workspaceId, EMPTY_FILTERS, 'BR');
    expect(page.total).toBe(0);
    expect(page.rows).toHaveLength(0);
  });

  it('LER: buscar pelos dados exatos do contato alheio não vaza nada', async () => {
    for (const search of ['Vítima', 'vitima@example.com', 'Alvo Ltda', '85 99999-0001']) {
      const page = await queryContacts(
        attacker.workspaceId,
        contactFiltersSchema.parse({ search }),
        'BR',
      );
      expect(page.total, `busca por ${search}`).toBe(0);
    }
  });

  it('EDITAR: atualizar contato alheio é recusado e não altera nada', async () => {
    const attempt = await updateContact(workspaceRef(attacker.workspaceId), victimContactId, {
      ...CONTACT,
      firstName: 'Invadido',
    }).catch((error: unknown) => error);

    expect(isAppError(attempt) && attempt.code).toBe('NOT_FOUND');

    const stored = await prisma.contact.findUniqueOrThrow({ where: { id: victimContactId } });
    expect(stored.firstName).toBe('Vítima');
  });

  it('ARQUIVAR: arquivar contato alheio é recusado', async () => {
    const attempt = await archiveContact(attacker.workspaceId, victimContactId).catch(
      (error: unknown) => error,
    );
    expect(isAppError(attempt) && attempt.code).toBe('NOT_FOUND');

    const stored = await prisma.contact.findUniqueOrThrow({ where: { id: victimContactId } });
    expect(stored.status).toBe(ContactStatus.ACTIVE);
  });

  it('RESTAURAR: restaurar contato alheio é recusado', async () => {
    await archiveContact(victim.workspaceId, victimContactId);

    const attempt = await restoreContact(attacker.workspaceId, victimContactId).catch(
      (error: unknown) => error,
    );
    expect(isAppError(attempt) && attempt.code).toBe('NOT_FOUND');
  });

  it('TAG: aplicar tag em contato alheio é recusado pelo banco', async () => {
    const tag = await resolveTag(attacker.workspaceId, { tagName: 'Invasora' });

    await expect(attachTag(attacker.workspaceId, victimContactId, tag.id)).rejects.toThrow();
    await expect(prisma.contactTag.count({ where: { contactId: victimContactId } })).resolves.toBe(0);
  });

  it('LISTA: adicionar contato alheio a uma lista local é recusado pelo banco', async () => {
    const list = await resolveList(attacker.workspaceId, { listName: 'Minha lista' });

    await expect(addToList(attacker.workspaceId, victimContactId, list.id)).rejects.toThrow();
    await expect(
      prisma.contactListMember.count({ where: { contactId: victimContactId } }),
    ).resolves.toBe(0);
  });

  it('CONSENTIMENTO: suprimir contato alheio é recusado antes de qualquer escrita', async () => {
    const attempt = await suppressContact({
      workspaceId: attacker.workspaceId,
      contactId: victimContactId,
      actorUserId: attacker.userId,
    }).catch((error: unknown) => error);

    expect(isAppError(attempt) && attempt.code).toBe('NOT_FOUND');
    await expect(prisma.suppressionEntry.count()).resolves.toBe(0);

    const consent = await prisma.contactConsent.findFirstOrThrow({
      where: { contactId: victimContactId, channel: ConsentChannel.WHATSAPP },
    });
    expect(consent.status).toBe(ConsentStatus.GRANTED);
  });

  it('SUPRESSÃO: remover supressão alheia é recusado', async () => {
    await suppressContact({
      workspaceId: victim.workspaceId,
      contactId: victimContactId,
      actorUserId: victim.userId,
    });

    const attempt = await unsuppressContact({
      workspaceId: attacker.workspaceId,
      contactId: victimContactId,
      reason: 'Tentativa indevida do atacante',
      actorUserId: attacker.userId,
    }).catch((error: unknown) => error);

    expect(isAppError(attempt) && attempt.code).toBe('NOT_FOUND');
    await expect(
      prisma.suppressionEntry.count({ where: { workspaceId: victim.workspaceId } }),
    ).resolves.toBe(1);
  });

  it('filtrar por tag de outro workspace não revela contatos alheios', async () => {
    const victimTag = await resolveTag(victim.workspaceId, { tagName: 'Segmento' });
    await attachTag(victim.workspaceId, victimContactId, victimTag.id);

    const page = await queryContacts(
      attacker.workspaceId,
      contactFiltersSchema.parse({ tagId: victimTag.id }),
      'BR',
    );
    expect(page.total).toBe(0);
  });

  it('filtrar por lista de outro workspace não revela contatos alheios', async () => {
    const victimList = await resolveList(victim.workspaceId, { listName: 'Alvos' });
    await addToList(victim.workspaceId, victimContactId, victimList.id);

    const page = await queryContacts(
      attacker.workspaceId,
      contactFiltersSchema.parse({ listId: victimList.id }),
      'BR',
    );
    expect(page.total).toBe(0);
  });

  it('id inexistente e id de outro tenant respondem exatamente igual', async () => {
    const foreign = await getContactOrThrow(attacker.workspaceId, victimContactId).catch(
      (error: unknown) => error,
    );
    const missing = await getContactOrThrow(attacker.workspaceId, 'contato_inexistente').catch(
      (error: unknown) => error,
    );

    expect(isAppError(foreign) && foreign.code).toBe(isAppError(missing) ? missing.code : '');
    expect(isAppError(foreign) && foreign.message).toBe(isAppError(missing) ? missing.message : '');
  });

  it('o mesmo telefone existindo nos dois workspaces não cruza os dados', async () => {
    const twin = await createContact(workspaceRef(attacker.workspaceId), {
      ...CONTACT,
      firstName: 'Meu contato',
    });

    const page = await queryContacts(attacker.workspaceId, EMPTY_FILTERS, 'BR');
    expect(page.total).toBe(1);
    expect(page.rows[0]?.id).toBe(twin.id);
    expect(page.rows[0]?.firstName).toBe('Meu contato');
  });

  it('suprimir no workspace do atacante não suprime o gêmeo do outro tenant', async () => {
    const twin = await createContact(workspaceRef(attacker.workspaceId), CONTACT);
    await suppressContact({
      workspaceId: attacker.workspaceId,
      contactId: twin.id,
      actorUserId: attacker.userId,
    });

    const victimSuppressions = await prisma.suppressionEntry.count({
      where: { workspaceId: victim.workspaceId },
    });
    expect(victimSuppressions).toBe(0);

    const victimConsent = await prisma.contactConsent.findFirstOrThrow({
      where: { contactId: victimContactId, channel: ConsentChannel.WHATSAPP },
    });
    expect(victimConsent.status).toBe(ConsentStatus.GRANTED);
  });

  it('CONSENTIMENTO: alterar consentimento de contato alheio é recusado', async () => {
    // A unique key do consentimento é (contactId, channel), sem workspace.
    // Sem a checagem de posse dentro de setConsent, este upsert atualizaria o
    // registro da vítima — foi assim que o red team encontrou a falha.
    const attempt = await setConsent({
      workspaceId: attacker.workspaceId,
      contactId: victimContactId,
      channel: ConsentChannel.WHATSAPP,
      status: ConsentStatus.REVOKED,
    }).catch((error: unknown) => error);

    expect(isAppError(attempt) && attempt.code).toBe('NOT_FOUND');

    const consent = await prisma.contactConsent.findFirstOrThrow({
      where: { contactId: victimContactId, channel: ConsentChannel.WHATSAPP },
    });
    expect(consent.workspaceId).toBe(victim.workspaceId);
    expect(consent.status).toBe(ConsentStatus.GRANTED);
  });

  it('CONSENTIMENTO: o banco também recusa, mesmo passando por cima do serviço', async () => {
    // Foreign key composta (workspace_id, contact_id).
    await expect(
      prisma.contactConsent.create({
        data: {
          workspaceId: attacker.workspaceId,
          contactId: victimContactId,
          channel: ConsentChannel.SMS,
          status: ConsentStatus.GRANTED,
        },
      }),
    ).rejects.toThrow();
  });
});
