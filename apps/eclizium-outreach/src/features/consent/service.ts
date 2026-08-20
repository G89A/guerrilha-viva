import 'server-only';
import type { ContactConsent, Prisma } from '@prisma/client';
import { ConsentChannel, ConsentSource, ConsentStatus } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { AppError } from '@/lib/errors/app-error';

export interface ConsentChange {
  consent: ContactConsent;
  previousStatus: ConsentStatus | null;
  changed: boolean;
}

/**
 * Grava o consentimento de um canal. Um contato tem no máximo um registro por
 * canal (`@@unique([contactId, channel])`), então o upsert é a operação
 * natural — e a única que não cria histórico duplicado sob duplo clique.
 *
 * `capturedAt` e `revokedAt` não são zerados ao mudar de estado: eles contam a
 * história de quando cada decisão foi tomada.
 */
export async function setConsent(
  input: {
    workspaceId: string;
    contactId: string;
    channel: ConsentChannel;
    status: ConsentStatus;
    source?: ConsentSource;
    proofReference?: string | null;
  },
  client: Prisma.TransactionClient = prisma,
): Promise<ConsentChange> {
  // A unique key do consentimento é (contactId, channel) — sem workspace. Sem
  // esta checagem, um chamador que passasse o contactId de outro tenant
  // atualizaria o registro alheio. O red team encontrou exatamente isso.
  const owned = await client.contact.findFirst({
    where: { id: input.contactId, workspaceId: input.workspaceId },
    select: { id: true },
  });
  if (!owned) throw AppError.notFound('Contato não encontrado.');

  const existing = await client.contactConsent.findUnique({
    where: { contactId_channel: { contactId: input.contactId, channel: input.channel } },
  });

  const now = new Date();
  const consent = await client.contactConsent.upsert({
    where: { contactId_channel: { contactId: input.contactId, channel: input.channel } },
    create: {
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      channel: input.channel,
      status: input.status,
      source: input.source ?? ConsentSource.MANUAL,
      proofReference: input.proofReference ?? null,
      capturedAt: input.status === ConsentStatus.GRANTED ? now : null,
      revokedAt: input.status === ConsentStatus.REVOKED ? now : null,
    },
    update: {
      status: input.status,
      ...(input.source ? { source: input.source } : {}),
      ...(input.proofReference === undefined ? {} : { proofReference: input.proofReference }),
      ...(input.status === ConsentStatus.GRANTED ? { capturedAt: now } : {}),
      ...(input.status === ConsentStatus.REVOKED ? { revokedAt: now } : {}),
    },
  });

  return {
    consent,
    previousStatus: existing?.status ?? null,
    changed: existing?.status !== input.status,
  };
}

export async function listConsents(
  workspaceId: string,
  contactId: string,
): Promise<ContactConsent[]> {
  return prisma.contactConsent.findMany({
    where: { workspaceId, contactId },
    orderBy: { channel: 'asc' },
  });
}

export const CONSENT_LABELS: Record<ConsentStatus, string> = {
  [ConsentStatus.GRANTED]: 'Concedido',
  [ConsentStatus.REVOKED]: 'Revogado',
  [ConsentStatus.UNKNOWN]: 'Desconhecido',
};

export const CHANNEL_LABELS: Record<ConsentChannel, string> = {
  [ConsentChannel.WHATSAPP]: 'WhatsApp',
  [ConsentChannel.SMS]: 'SMS',
  [ConsentChannel.EMAIL]: 'E-mail',
};
