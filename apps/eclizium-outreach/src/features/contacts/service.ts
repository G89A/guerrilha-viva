import 'server-only';
import type { Contact, Prisma } from '@prisma/client';
import { ConsentChannel, ConsentSource, ConsentStatus, ContactStatus } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { AppError } from '@/lib/errors/app-error';
import { isUniqueConstraintError } from '@/lib/db/errors';
import { normalizePhone } from '@/features/contacts/phone';
import type { ContactInput } from '@/features/contacts/schemas';

export interface WorkspaceRef {
  id: string;
  defaultPhoneRegion: string;
}

/**
 * Normaliza o telefone com a região do workspace ou lança VALIDATION_ERROR
 * já no formato que o formulário espera.
 */
export function normalizeOrThrow(raw: string, workspace: WorkspaceRef): string {
  const result = normalizePhone(raw, workspace.defaultPhoneRegion);
  if (!result.ok) {
    throw AppError.validation('Telefone inválido.', { phone: [result.message] });
  }
  return result.phone.e164;
}

function scalarData(input: ContactInput): Omit<Prisma.ContactCreateInput, 'workspace' | 'phoneE164'> {
  return {
    phone: input.phone,
    firstName: input.firstName ?? null,
    lastName: input.lastName ?? null,
    email: input.email ?? null,
    company: input.company ?? null,
    segment: input.segment ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    country: input.country ?? null,
    source: input.source ?? null,
    notes: input.notes ?? null,
  };
}

/**
 * Carrega um contato garantindo que ele pertence ao workspace autorizado.
 * Um id de outro tenant resulta em NOT_FOUND — do ponto de vista do chamador
 * aquele contato simplesmente não existe.
 */
export async function getContactOrThrow(
  workspaceId: string,
  contactId: string,
): Promise<Contact> {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, workspaceId } });
  if (!contact) throw AppError.notFound('Contato não encontrado.');
  return contact;
}

export async function createContact(
  workspace: WorkspaceRef,
  input: ContactInput & { whatsappConsent?: ConsentStatus },
): Promise<Contact> {
  const phoneE164 = normalizeOrThrow(input.phone, workspace);
  const consentStatus = input.whatsappConsent ?? ConsentStatus.UNKNOWN;

  try {
    return await prisma.$transaction(async (tx) => {
      const contact = await tx.contact.create({
        data: {
          ...scalarData(input),
          phoneE164,
          workspace: { connect: { id: workspace.id } },
        },
      });

      // Registrar o consentimento junto com o contato mantém a decisão de
      // compliance explícita desde a criação, mesmo quando é UNKNOWN.
      await tx.contactConsent.create({
        data: {
          workspaceId: workspace.id,
          contactId: contact.id,
          channel: ConsentChannel.WHATSAPP,
          status: consentStatus,
          source: ConsentSource.MANUAL,
          capturedAt: consentStatus === ConsentStatus.GRANTED ? new Date() : null,
          revokedAt: consentStatus === ConsentStatus.REVOKED ? new Date() : null,
        },
      });

      // Uma supressão órfã (contato anterior removido) reencontra o novo
      // registro pelo telefone. Sem isso, o número voltaria a parecer liberado.
      await tx.suppressionEntry.updateMany({
        where: { workspaceId: workspace.id, phoneE164, contactId: null },
        data: { contactId: contact.id },
      });

      return contact;
    });
  } catch (error) {
    if (isUniqueConstraintError(error, 'phone_e164')) {
      throw AppError.conflict('Já existe um contato com este telefone neste workspace.', {
        phoneE164,
      });
    }
    throw error;
  }
}

export async function updateContact(
  workspace: WorkspaceRef,
  contactId: string,
  input: ContactInput,
): Promise<Contact> {
  const existing = await getContactOrThrow(workspace.id, contactId);
  const phoneE164 = normalizeOrThrow(input.phone, workspace);

  try {
    // updateMany com o filtro de tenant: mesmo que `existing` estivesse
    // desatualizado, a escrita não alcança outro workspace.
    const result = await prisma.contact.updateMany({
      where: { id: contactId, workspaceId: workspace.id },
      data: { ...scalarData(input), phoneE164 },
    });
    if (result.count === 0) throw AppError.notFound('Contato não encontrado.');
  } catch (error) {
    if (isUniqueConstraintError(error, 'phone_e164')) {
      throw AppError.conflict('Outro contato deste workspace já usa este telefone.', {
        phoneE164,
      });
    }
    throw error;
  }

  return { ...existing, ...scalarData(input), phoneE164 } as Contact;
}

export interface ArchiveResult {
  changed: boolean;
  status: ContactStatus;
}

/**
 * Arquivamento é soft delete. Repetir a operação é inofensivo e reportado como
 * `changed: false`, em vez de erro — duplo clique não pode virar exceção.
 */
export async function archiveContact(
  workspaceId: string,
  contactId: string,
): Promise<ArchiveResult> {
  await getContactOrThrow(workspaceId, contactId);

  const result = await prisma.contact.updateMany({
    where: { id: contactId, workspaceId, status: { not: ContactStatus.ARCHIVED } },
    data: { status: ContactStatus.ARCHIVED, archivedAt: new Date() },
  });

  return { changed: result.count > 0, status: ContactStatus.ARCHIVED };
}

export async function restoreContact(
  workspaceId: string,
  contactId: string,
): Promise<ArchiveResult> {
  await getContactOrThrow(workspaceId, contactId);

  const result = await prisma.contact.updateMany({
    where: { id: contactId, workspaceId, status: ContactStatus.ARCHIVED },
    data: { status: ContactStatus.ACTIVE, archivedAt: null },
  });

  return { changed: result.count > 0, status: ContactStatus.ACTIVE };
}

/** Campos que valem uma entrada no audit log quando mudam. */
const AUDITED_FIELDS = [
  'phoneE164',
  'firstName',
  'lastName',
  'email',
  'company',
  'segment',
  'city',
  'state',
  'country',
  'source',
] as const;

export type ContactDiff = Record<string, { from: string | null; to: string | null }>;

/** Diferença auditável entre duas versões do contato. Só campos escalares. */
export function diffContact(before: Contact, after: Contact): ContactDiff {
  const changes: ContactDiff = {};
  for (const field of AUDITED_FIELDS) {
    if (before[field] !== after[field]) {
      changes[field] = { from: before[field] ?? null, to: after[field] ?? null };
    }
  }
  return changes;
}
