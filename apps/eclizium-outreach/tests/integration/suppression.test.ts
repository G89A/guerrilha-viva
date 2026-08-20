/** Caso obrigatório 5 e o contrato do serviço central de supressão. */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ConsentChannel, ConsentStatus, SuppressionReason } from '@prisma/client';
import { createContact } from '@/features/contacts/service';
import {
  listSuppressions,
  suppressContact,
  unsuppressContact,
} from '@/features/suppression/service';
import { setConsent } from '@/features/consent/service';
import { isAppError } from '@/lib/errors/app-error';
import { disconnectTestPrisma, resetDatabase, testPrisma } from '../helpers/db';
import { seedTenant, workspaceRef, type SeededTenant } from '../helpers/factories';

const prisma = testPrisma();

const input = {
  phone: '85 99999-9999',
  firstName: 'João',
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

async function makeContact(tenant: SeededTenant, phone = input.phone) {
  return createContact(workspaceRef(tenant.workspaceId), {
    ...input,
    phone,
    whatsappConsent: ConsentStatus.GRANTED,
  });
}

describe('suppressContact', () => {
  let tenant: SeededTenant;

  beforeEach(async () => {
    await resetDatabase();
    tenant = await seedTenant('supp');
  });

  afterAll(disconnectTestPrisma);

  // CASO 5
  it('cria a entrada, revoga o consentimento e registra auditoria', async () => {
    const contact = await makeContact(tenant);

    const result = await suppressContact({
      workspaceId: tenant.workspaceId,
      contactId: contact.id,
      reason: SuppressionReason.OPT_OUT,
      actorUserId: tenant.userId,
    });

    expect(result.created).toBe(true);
    expect(result.entry.phoneE164).toBe(contact.phoneE164);
    expect(result.consentRevoked).toBe(true);

    const consent = await prisma.contactConsent.findUniqueOrThrow({
      where: { contactId_channel: { contactId: contact.id, channel: ConsentChannel.WHATSAPP } },
    });
    expect(consent.status).toBe(ConsentStatus.REVOKED);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'contact.suppressed', resourceId: contact.id },
    });
    expect(audit.actorUserId).toBe(tenant.userId);
  });

  it('suprimir duas vezes é seguro e não duplica a entrada', async () => {
    const contact = await makeContact(tenant);

    const first = await suppressContact({
      workspaceId: tenant.workspaceId,
      contactId: contact.id,
      actorUserId: tenant.userId,
    });
    const second = await suppressContact({
      workspaceId: tenant.workspaceId,
      contactId: contact.id,
      actorUserId: tenant.userId,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    await expect(
      prisma.suppressionEntry.count({ where: { workspaceId: tenant.workspaceId } }),
    ).resolves.toBe(1);
  });

  it('mantém supressões independentes por canal', async () => {
    const contact = await makeContact(tenant);

    await suppressContact({
      workspaceId: tenant.workspaceId,
      contactId: contact.id,
      channel: ConsentChannel.WHATSAPP,
      actorUserId: tenant.userId,
    });
    await suppressContact({
      workspaceId: tenant.workspaceId,
      contactId: contact.id,
      channel: ConsentChannel.EMAIL,
      actorUserId: tenant.userId,
    });

    const entries = await listSuppressions(tenant.workspaceId, contact.phoneE164);
    expect(entries.map((entry) => entry.channel).sort()).toEqual(['EMAIL', 'WHATSAPP']);
  });

  it('recusa suprimir contato de outro workspace', async () => {
    const victim = await seedTenant('victim');
    const foreign = await makeContact(victim);

    const attempt = await suppressContact({
      workspaceId: tenant.workspaceId,
      contactId: foreign.id,
      actorUserId: tenant.userId,
    }).catch((error: unknown) => error);

    expect(isAppError(attempt) && attempt.code).toBe('NOT_FOUND');
    await expect(prisma.suppressionEntry.count()).resolves.toBe(0);
  });

  it('a supressão sobrevive à remoção do contato e reencontra um novo com o mesmo número', async () => {
    const contact = await makeContact(tenant);
    await suppressContact({
      workspaceId: tenant.workspaceId,
      contactId: contact.id,
      actorUserId: tenant.userId,
    });

    await prisma.contact.delete({ where: { id: contact.id } });

    const orphan = await prisma.suppressionEntry.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    expect(orphan.contactId).toBeNull();
    expect(orphan.phoneE164).toBe('+5585999999999');

    // Reimportar o mesmo número não devolve o contato ao alcance das campanhas.
    const recreated = await makeContact(tenant);
    const reconnected = await prisma.suppressionEntry.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    expect(reconnected.contactId).toBe(recreated.id);
  });

  it('edição do contato não remove a supressão', async () => {
    const contact = await makeContact(tenant);
    await suppressContact({
      workspaceId: tenant.workspaceId,
      contactId: contact.id,
      actorUserId: tenant.userId,
    });

    await prisma.contact.update({
      where: { id: contact.id },
      data: { firstName: 'Nome editado' },
    });
    await setConsent({
      workspaceId: tenant.workspaceId,
      contactId: contact.id,
      channel: ConsentChannel.WHATSAPP,
      status: ConsentStatus.GRANTED,
    });

    const entries = await listSuppressions(tenant.workspaceId, contact.phoneE164);
    expect(entries).toHaveLength(1);
  });
});

describe('unsuppressContact', () => {
  let tenant: SeededTenant;

  beforeEach(async () => {
    await resetDatabase();
    tenant = await seedTenant('unsupp');
  });

  it('remove a supressão e registra o motivo em auditoria', async () => {
    const contact = await makeContact(tenant);
    await suppressContact({
      workspaceId: tenant.workspaceId,
      contactId: contact.id,
      actorUserId: tenant.userId,
    });

    const result = await unsuppressContact({
      workspaceId: tenant.workspaceId,
      contactId: contact.id,
      reason: 'Cliente pediu por escrito para voltar a receber',
      actorUserId: tenant.userId,
    });

    expect(result.removed).toBe(true);
    await expect(listSuppressions(tenant.workspaceId, contact.phoneE164)).resolves.toHaveLength(0);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'contact.unsuppressed', resourceId: contact.id },
    });
    expect(JSON.stringify(audit.metadata)).toContain('por escrito');
  });

  it('NÃO devolve o consentimento a GRANTED', async () => {
    const contact = await makeContact(tenant);
    await suppressContact({
      workspaceId: tenant.workspaceId,
      contactId: contact.id,
      actorUserId: tenant.userId,
    });
    await unsuppressContact({
      workspaceId: tenant.workspaceId,
      contactId: contact.id,
      reason: 'Motivo suficiente para o teste',
      actorUserId: tenant.userId,
    });

    const consent = await prisma.contactConsent.findUniqueOrThrow({
      where: { contactId_channel: { contactId: contact.id, channel: ConsentChannel.WHATSAPP } },
    });
    expect(consent.status).toBe(ConsentStatus.REVOKED);
  });

  it('remover supressão inexistente devolve removed: false, sem erro', async () => {
    const contact = await makeContact(tenant);
    const result = await unsuppressContact({
      workspaceId: tenant.workspaceId,
      contactId: contact.id,
      reason: 'Nada a remover, apenas verificando',
      actorUserId: tenant.userId,
    });
    expect(result.removed).toBe(false);
  });

  it('recusa remover supressão de contato de outro workspace', async () => {
    const victim = await seedTenant('victim');
    const foreign = await makeContact(victim);
    await suppressContact({
      workspaceId: victim.workspaceId,
      contactId: foreign.id,
      actorUserId: victim.userId,
    });

    const attempt = await unsuppressContact({
      workspaceId: tenant.workspaceId,
      contactId: foreign.id,
      reason: 'Tentativa indevida de remoção',
      actorUserId: tenant.userId,
    }).catch((error: unknown) => error);

    expect(isAppError(attempt) && attempt.code).toBe('NOT_FOUND');
    await expect(
      listSuppressions(victim.workspaceId, foreign.phoneE164),
    ).resolves.toHaveLength(1);
  });
});
