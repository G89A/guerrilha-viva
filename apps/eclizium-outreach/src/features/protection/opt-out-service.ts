import 'server-only';
import { ConsentChannel, ConsentSource, ConsentStatus, SuppressionReason } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging/logger';
import { writeAuditLog } from '@/lib/audit/audit-log';
import { isOptOutMessage } from '@/features/protection/opt-out';
import { getSendingPolicy } from '@/features/protection/policy-service';

/**
 * Aplica o descadastro pedido pelo contato.
 *
 * Faz TRÊS coisas, e as três importam:
 *
 *   1. entra na lista de supressão, que é a barreira que vence tudo — inclusive
 *      consentimento concedido e importação futura, porque é chaveada por
 *      telefone e não por contato;
 *   2. revoga o consentimento de WhatsApp, para a base refletir a verdade;
 *   3. registra na auditoria com origem, para haver prova de quando e por quê.
 *
 * Só a supressão bastaria para parar o envio. As outras duas existem porque um
 * relatório que mostra "consentimento concedido" em quem pediu para sair é um
 * relatório que leva alguém a reimportar essa pessoa depois.
 */

export interface OptOutOutcome {
  applied: boolean;
  alreadySuppressed?: boolean;
}

export async function applyOptOut(input: {
  workspaceId: string;
  contactId: string;
  phoneE164: string;
  /** Trecho da mensagem que disparou, para o registro. Nunca a mensagem toda. */
  trigger: string;
  now?: Date;
}): Promise<OptOutOutcome> {
  const now = input.now ?? new Date();

  // `createMany` com skipDuplicates: duas mensagens "PARAR" seguidas não
  // estouram a unique nem abortam nada.
  const inserted = await prisma.suppressionEntry.createMany({
    skipDuplicates: true,
    data: [
      {
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        phoneE164: input.phoneE164,
        reason: SuppressionReason.OPT_OUT,
        notes: `Pedido do contato por mensagem: "${input.trigger.slice(0, 60)}"`,
        createdAt: now,
      },
    ],
  });

  if (inserted.count === 0) {
    return { applied: false, alreadySuppressed: true };
  }

  await prisma.contactConsent.updateMany({
    where: {
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      channel: ConsentChannel.WHATSAPP,
      status: { not: ConsentStatus.REVOKED },
    },
    data: {
      status: ConsentStatus.REVOKED,
      source: ConsentSource.INBOUND_MESSAGE,
      revokedAt: now,
    },
  });

  await writeAuditLog({
    action: 'contact.suppressed',
    resourceType: 'Contact',
    resourceId: input.contactId,
    workspaceId: input.workspaceId,
    actorUserId: null,
    actorType: 'SYSTEM',
    // Nunca a mensagem inteira: o audit log não é arquivo de conversa.
    metadata: { reason: 'OPT_OUT', origin: 'INBOUND_KEYWORD' },
  });

  logger.info('protection.opt_out_applied', {
    workspaceId: input.workspaceId,
    contactId: input.contactId,
  });

  return { applied: true };
}

/**
 * Verifica a mensagem recebida e descadastra se for o caso.
 *
 * Roda FORA da transação de recepção, depois que a mensagem já está gravada: o
 * descadastro é um efeito adicional, e uma falha nele não pode desfazer o
 * registro da mensagem que o contato mandou.
 */
export async function handlePossibleOptOut(input: {
  workspaceId: string;
  contactId: string;
  phoneE164: string;
  body: string | null;
  now?: Date;
}): Promise<OptOutOutcome> {
  const policy = await getSendingPolicy(input.workspaceId);
  if (!policy.optOutEnabled) return { applied: false };
  if (!isOptOutMessage(input.body, policy.optOutKeywords)) return { applied: false };

  return applyOptOut({
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    phoneE164: input.phoneE164,
    trigger: input.body ?? '',
    ...(input.now ? { now: input.now } : {}),
  });
}

/** Tipo auxiliar para chamadas dentro de transação, quando necessário. */
export type OptOutClient = Prisma.TransactionClient | typeof prisma;
