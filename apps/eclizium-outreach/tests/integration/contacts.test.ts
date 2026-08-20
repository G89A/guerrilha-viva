/**
 * Casos obrigatórios 1, 2, 3 e 6 do SPRINT 1, mais o ciclo de vida do contato.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ConsentChannel, ConsentStatus, ContactStatus } from '@prisma/client';
import {
  archiveContact,
  createContact,
  diffContact,
  getContactOrThrow,
  restoreContact,
  updateContact,
} from '@/features/contacts/service';
import { setConsent } from '@/features/consent/service';
import { isAppError } from '@/lib/errors/app-error';
import { disconnectTestPrisma, resetDatabase, testPrisma } from '../helpers/db';
import { seedTenant, workspaceRef, type SeededTenant } from '../helpers/factories';

const prisma = testPrisma();

const baseInput = {
  phone: '85 99999-9999',
  firstName: 'João',
  lastName: 'Silva',
  email: 'joao@example.com',
  company: 'ACME',
  segment: 'Varejo',
  city: 'Fortaleza',
  state: 'CE',
  country: 'BR',
  source: 'manual',
  notes: null,
};

describe('contatos — ciclo de vida', () => {
  let tenant: SeededTenant;

  beforeEach(async () => {
    await resetDatabase();
    tenant = await seedTenant('crm');
  });

  afterAll(disconnectTestPrisma);

  // CASO 1
  it('cria contato válido e normaliza o telefone para E.164', async () => {
    const contact = await createContact(workspaceRef(tenant.workspaceId), baseInput);

    expect(contact.phoneE164).toBe('+5585999999999');
    expect(contact.phone).toBe('85 99999-9999');
    expect(contact.status).toBe(ContactStatus.ACTIVE);
    expect(contact.city).toBe('Fortaleza');
  });

  it('cria o registro de consentimento junto com o contato', async () => {
    const contact = await createContact(workspaceRef(tenant.workspaceId), {
      ...baseInput,
      whatsappConsent: ConsentStatus.GRANTED,
    });

    const consent = await prisma.contactConsent.findUniqueOrThrow({
      where: { contactId_channel: { contactId: contact.id, channel: ConsentChannel.WHATSAPP } },
    });
    expect(consent.status).toBe(ConsentStatus.GRANTED);
    expect(consent.capturedAt).not.toBeNull();
  });

  it('usa UNKNOWN como consentimento padrão, nunca GRANTED', async () => {
    const contact = await createContact(workspaceRef(tenant.workspaceId), baseInput);
    const consent = await prisma.contactConsent.findUniqueOrThrow({
      where: { contactId_channel: { contactId: contact.id, channel: ConsentChannel.WHATSAPP } },
    });
    expect(consent.status).toBe(ConsentStatus.UNKNOWN);
  });

  // CASO 2
  it('rejeita telefone duplicado no mesmo workspace, em qualquer formato', async () => {
    await createContact(workspaceRef(tenant.workspaceId), baseInput);

    const attempt = await createContact(workspaceRef(tenant.workspaceId), {
      ...baseInput,
      phone: '+55 85 99999-9999',
      email: 'outro@example.com',
    }).catch((error: unknown) => error);

    expect(isAppError(attempt) && attempt.code).toBe('CONFLICT');
    expect(isAppError(attempt) && attempt.message).toContain('telefone');
    await expect(prisma.contact.count({ where: { workspaceId: tenant.workspaceId } })).resolves.toBe(1);
  });

  // CASO 3
  it('permite o mesmo telefone em workspaces diferentes', async () => {
    const other = await seedTenant('outro');

    await createContact(workspaceRef(tenant.workspaceId), baseInput);
    const twin = await createContact(workspaceRef(other.workspaceId), baseInput);

    expect(twin.phoneE164).toBe('+5585999999999');
    await expect(prisma.contact.count({ where: { phoneE164: '+5585999999999' } })).resolves.toBe(2);
  });

  it('recusa telefone inválido com erro de campo, não erro técnico', async () => {
    const attempt = await createContact(workspaceRef(tenant.workspaceId), {
      ...baseInput,
      phone: 'não é telefone',
    }).catch((error: unknown) => error);

    expect(isAppError(attempt) && attempt.code).toBe('VALIDATION_ERROR');
    expect(isAppError(attempt) && attempt.fieldErrors?.phone).toBeTruthy();
  });

  it('edita contato preservando o id e registrando o diff', async () => {
    const contact = await createContact(workspaceRef(tenant.workspaceId), baseInput);

    const updated = await updateContact(workspaceRef(tenant.workspaceId), contact.id, {
      ...baseInput,
      company: 'Nova Empresa',
      city: 'Recife',
    });

    expect(updated.company).toBe('Nova Empresa');
    const changes = diffContact(contact, updated);
    expect(Object.keys(changes).sort()).toEqual(['city', 'company']);

    const stored = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(stored.city).toBe('Recife');
  });

  it('recusa edição que colide com o telefone de outro contato', async () => {
    await createContact(workspaceRef(tenant.workspaceId), baseInput);
    const second = await createContact(workspaceRef(tenant.workspaceId), {
      ...baseInput,
      phone: '85 98888-8888',
      email: 'outro@example.com',
    });

    const attempt = await updateContact(workspaceRef(tenant.workspaceId), second.id, {
      ...baseInput,
      phone: '85 99999-9999',
    }).catch((error: unknown) => error);

    expect(isAppError(attempt) && attempt.code).toBe('CONFLICT');
  });

  it('permite salvar o contato mantendo o próprio telefone', async () => {
    const contact = await createContact(workspaceRef(tenant.workspaceId), baseInput);
    const updated = await updateContact(workspaceRef(tenant.workspaceId), contact.id, {
      ...baseInput,
      firstName: 'João Paulo',
    });
    expect(updated.firstName).toBe('João Paulo');
  });

  it('arquiva por soft delete e é idempotente', async () => {
    const contact = await createContact(workspaceRef(tenant.workspaceId), baseInput);

    const first = await archiveContact(tenant.workspaceId, contact.id);
    const second = await archiveContact(tenant.workspaceId, contact.id);

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);

    const stored = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(stored.status).toBe(ContactStatus.ARCHIVED);
    expect(stored.archivedAt).not.toBeNull();
  });

  it('restaura contato arquivado', async () => {
    const contact = await createContact(workspaceRef(tenant.workspaceId), baseInput);
    await archiveContact(tenant.workspaceId, contact.id);

    const result = await restoreContact(tenant.workspaceId, contact.id);
    expect(result.changed).toBe(true);

    const stored = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(stored.status).toBe(ContactStatus.ACTIVE);
    expect(stored.archivedAt).toBeNull();
  });

  it('nunca apaga fisicamente ao arquivar', async () => {
    const contact = await createContact(workspaceRef(tenant.workspaceId), baseInput);
    await archiveContact(tenant.workspaceId, contact.id);
    await expect(getContactOrThrow(tenant.workspaceId, contact.id)).resolves.toBeTruthy();
  });

  // CASO 6
  it('persiste a revogação de consentimento com a data', async () => {
    const contact = await createContact(workspaceRef(tenant.workspaceId), {
      ...baseInput,
      whatsappConsent: ConsentStatus.GRANTED,
    });

    const result = await setConsent({
      workspaceId: tenant.workspaceId,
      contactId: contact.id,
      channel: ConsentChannel.WHATSAPP,
      status: ConsentStatus.REVOKED,
    });

    expect(result.previousStatus).toBe(ConsentStatus.GRANTED);
    expect(result.changed).toBe(true);

    const stored = await prisma.contactConsent.findUniqueOrThrow({
      where: { contactId_channel: { contactId: contact.id, channel: ConsentChannel.WHATSAPP } },
    });
    expect(stored.status).toBe(ConsentStatus.REVOKED);
    expect(stored.revokedAt).not.toBeNull();
    // A data da concessão original permanece: é histórico, não estado.
    expect(stored.capturedAt).not.toBeNull();
  });

  it('gravar o mesmo consentimento duas vezes não duplica registro', async () => {
    const contact = await createContact(workspaceRef(tenant.workspaceId), baseInput);

    await setConsent({
      workspaceId: tenant.workspaceId,
      contactId: contact.id,
      channel: ConsentChannel.WHATSAPP,
      status: ConsentStatus.GRANTED,
    });
    const second = await setConsent({
      workspaceId: tenant.workspaceId,
      contactId: contact.id,
      channel: ConsentChannel.WHATSAPP,
      status: ConsentStatus.GRANTED,
    });

    expect(second.changed).toBe(false);
    await expect(
      prisma.contactConsent.count({ where: { contactId: contact.id } }),
    ).resolves.toBe(1);
  });

  it('mantém consentimentos independentes por canal', async () => {
    const contact = await createContact(workspaceRef(tenant.workspaceId), baseInput);

    await setConsent({
      workspaceId: tenant.workspaceId,
      contactId: contact.id,
      channel: ConsentChannel.EMAIL,
      status: ConsentStatus.GRANTED,
    });

    const whatsapp = await prisma.contactConsent.findUniqueOrThrow({
      where: { contactId_channel: { contactId: contact.id, channel: ConsentChannel.WHATSAPP } },
    });
    expect(whatsapp.status).toBe(ConsentStatus.UNKNOWN);
  });
});
