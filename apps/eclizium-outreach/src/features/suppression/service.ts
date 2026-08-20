import 'server-only';
import type { Prisma, SuppressionEntry } from '@prisma/client';
import { ConsentChannel, ConsentSource, ConsentStatus, SuppressionReason } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { AppError } from '@/lib/errors/app-error';
import { writeAuditLog } from '@/lib/audit/audit-log';
import { setConsent } from '@/features/consent/service';
import { getContactOrThrow } from '@/features/contacts/service';

export interface SuppressionResult {
  entry: SuppressionEntry;
  /** `false` quando o contato já estava suprimido naquele canal. */
  created: boolean;
  consentRevoked: boolean;
}

/**
 * Serviço central de supressão — ponto único por onde um contato entra na
 * suppression list.
 *
 * Ele: verifica a posse do contato no workspace, cria a entrada, revoga o
 * consentimento do canal correspondente e registra o audit log. Chamar
 * duas vezes é seguro: a segunda chamada devolve `created: false` em vez de
 * estourar a constraint.
 *
 * A chave da supressão é o telefone, não o id do contato: um contato removido
 * e reimportado com o mesmo número continua suprimido.
 */
export async function suppressContact(input: {
  workspaceId: string;
  contactId: string;
  channel?: ConsentChannel;
  reason?: SuppressionReason;
  notes?: string | null;
  actorUserId: string | null;
  actorType?: 'USER' | 'SYSTEM';
}): Promise<SuppressionResult> {
  const channel = input.channel ?? ConsentChannel.WHATSAPP;
  const reason = input.reason ?? SuppressionReason.OPT_OUT;
  const contact = await getContactOrThrow(input.workspaceId, input.contactId);

  const outcome = await prisma.$transaction(async (tx) => {
    const key = {
      workspaceId_channel_phoneE164: {
        workspaceId: input.workspaceId,
        channel,
        phoneE164: contact.phoneE164,
      },
    };

    // Ler antes de escrever, e escrever com upsert.
    //
    // Tentar o INSERT e capturar a violação NÃO funciona aqui: o PostgreSQL
    // aborta a transação inteira ao violar a constraint, e qualquer consulta
    // seguinte falharia com "current transaction is aborted".
    const previous = await tx.suppressionEntry.findUnique({ where: key });

    const entry = await tx.suppressionEntry.upsert({
      where: key,
      create: {
        workspaceId: input.workspaceId,
        contactId: contact.id,
        phoneE164: contact.phoneE164,
        channel,
        reason,
        notes: input.notes ?? null,
        createdById: input.actorUserId,
      },
      // Supressão existente só é reconectada ao contato atual: motivo, autor e
      // data originais são preservados como registro histórico.
      update: { contactId: contact.id },
    });

    const created = previous === null;

    const consent = await setConsent(
      {
        workspaceId: input.workspaceId,
        contactId: contact.id,
        channel,
        status: ConsentStatus.REVOKED,
        source: ConsentSource.MANUAL,
      },
      tx,
    );

    return { entry, created, consentRevoked: consent.changed };
  });

  await writeAuditLog({
    action: 'contact.suppressed',
    resourceType: 'Contact',
    resourceId: contact.id,
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    actorType: input.actorType ?? 'USER',
    metadata: {
      channel,
      reason,
      alreadySuppressed: !outcome.created,
      consentRevoked: outcome.consentRevoked,
    },
  });

  return outcome;
}

/**
 * Remove um contato da suppression list. Operação explícita e auditada: nunca
 * acontece como efeito colateral de editar um contato.
 *
 * O consentimento NÃO volta a `GRANTED` — remover a supressão apenas desfaz o
 * bloqueio; um novo consentimento precisa ser capturado de novo.
 */
export async function unsuppressContact(input: {
  workspaceId: string;
  contactId: string;
  channel?: ConsentChannel;
  reason: string;
  actorUserId: string | null;
}): Promise<{ removed: boolean }> {
  const channel = input.channel ?? ConsentChannel.WHATSAPP;
  const contact = await getContactOrThrow(input.workspaceId, input.contactId);

  const result = await prisma.suppressionEntry.deleteMany({
    where: { workspaceId: input.workspaceId, channel, phoneE164: contact.phoneE164 },
  });

  await writeAuditLog({
    action: 'contact.unsuppressed',
    resourceType: 'Contact',
    resourceId: contact.id,
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    metadata: { channel, reason: input.reason, removed: result.count > 0 },
  });

  return { removed: result.count > 0 };
}

/** Supressões ativas de um contato, por canal. */
export async function listSuppressions(
  workspaceId: string,
  phoneE164: string,
): Promise<SuppressionEntry[]> {
  return prisma.suppressionEntry.findMany({
    where: { workspaceId, phoneE164 },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Consulta em lote usada pela listagem: evita N+1 ao marcar quais contatos
 * estão suprimidos.
 */
export async function suppressedPhoneSet(
  workspaceId: string,
  phones: string[],
  client: Prisma.TransactionClient = prisma,
): Promise<Set<string>> {
  if (phones.length === 0) return new Set();

  const entries = await client.suppressionEntry.findMany({
    where: { workspaceId, phoneE164: { in: phones } },
    select: { phoneE164: true },
  });

  return new Set(entries.map((entry) => entry.phoneE164));
}

export function assertNotSuppressed(suppressed: boolean): void {
  if (suppressed) {
    throw AppError.conflict('Contato está na lista de supressão.');
  }
}

export const SUPPRESSION_REASON_LABELS: Record<SuppressionReason, string> = {
  [SuppressionReason.OPT_OUT]: 'Opt-out',
  [SuppressionReason.BLOCKED]: 'Bloqueado',
  [SuppressionReason.COMPLAINT]: 'Denúncia',
  [SuppressionReason.INVALID]: 'Número inválido',
  [SuppressionReason.MANUAL]: 'Manual',
};
