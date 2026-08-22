import 'server-only';
import { MessageDirection, NumberQuality } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import type { SendingPolicyView } from '@/features/protection/policy-service';

/**
 * Freios verificados imediatamente antes de cada envio de campanha.
 *
 * O que derruba um número no WhatsApp é reclamação de quem recebe: bloqueio e
 * denúncia. Estes freios existem para reduzir a chance disso — não para
 * disfarçar automação, não para escapar de detecção, não para "parecer humano".
 *
 * A diferença é observável no código: tudo aqui é determinístico, configurável
 * pelo operador e visível na tela. Não há aleatoriedade escondida, nem variação
 * de texto, nem rotação de identidade — e não deve haver.
 */

export type GuardrailDecision =
  | { allow: true }
  /** Não enviar agora, mas tentar depois. Não é falha do destinatário. */
  | { allow: false; kind: 'DEFER'; retryAtMs: number; reason: string }
  /** Não enviar a este contato nesta campanha. */
  | { allow: false; kind: 'BLOCK'; reason: string };

/**
 * Horário silencioso.
 *
 * Não é sobre parecer gente: é sobre não acordar ninguém às 3 da manhã, que é
 * como se ganha uma denúncia. A janela é explícita, configurável e some da conta
 * quando desligada.
 */
export function quietHoursDecision(
  policy: SendingPolicyView,
  now: Date,
): { silent: boolean; resumeAtMs: number } {
  if (!policy.quietHoursEnabled) return { silent: false, resumeAtMs: 0 };

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: policy.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const hourPart = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const hour = hourPart === 24 ? 0 : hourPart;
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');

  const { quietHoursStart: start, quietHoursEnd: end } = policy;
  // Início igual ao fim seria "silêncio o dia inteiro"; tratamos como desligado.
  if (start === end) return { silent: false, resumeAtMs: 0 };

  const silent = start < end ? hour >= start && hour < end : hour >= start || hour < end;
  if (!silent) return { silent: false, resumeAtMs: 0 };

  // Quantas horas faltam até a janela abrir, contando a virada do dia.
  const hoursUntilEnd = (end - hour + 24) % 24;
  const resumeAtMs = hoursUntilEnd * 60 * 60 * 1000 - minute * 60 * 1000;

  return { silent: true, resumeAtMs: Math.max(60_000, resumeAtMs) };
}

/**
 * Quantas mensagens de campanha este contato já recebeu na janela.
 *
 * Conta só saída de campanha: resposta manual da Inbox é conversa iniciada pelo
 * contato, e limitá-la seria impedir atendimento.
 */
export async function campaignMessagesInWindow(input: {
  workspaceId: string;
  contactId: string;
  windowDays: number;
  now: Date;
}): Promise<number> {
  const since = new Date(input.now.getTime() - input.windowDays * 24 * 60 * 60 * 1000);

  return prisma.message.count({
    where: {
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      direction: MessageDirection.OUTBOUND,
      campaignId: { not: null },
      createdAt: { gte: since },
    },
  });
}

export interface GuardrailInput {
  workspaceId: string;
  contactId: string;
  policy: SendingPolicyView;
  quality: NumberQuality;
  now?: Date;
}

/**
 * Decide se este envio pode acontecer agora.
 *
 * A ordem importa: primeiro o que impede para sempre (qualidade do número,
 * frequência), depois o que só adia (horário silencioso). Adiar um envio que
 * seria bloqueado de qualquer jeito só gastaria fila.
 */
export async function evaluateGuardrails(input: GuardrailInput): Promise<GuardrailDecision> {
  const now = input.now ?? new Date();

  if (input.quality === NumberQuality.RED && input.policy.pauseOnRedQuality) {
    return {
      allow: false,
      kind: 'BLOCK',
      reason:
        'Qualidade do número classificada como VERMELHA pela Meta. Enviar agora acelera a restrição.',
    };
  }
  if (input.quality === NumberQuality.YELLOW && input.policy.pauseOnYellowQuality) {
    return {
      allow: false,
      kind: 'BLOCK',
      reason: 'Qualidade do número classificada como AMARELA e a política manda parar nesse caso.',
    };
  }

  const recent = await campaignMessagesInWindow({
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    windowDays: input.policy.frequencyCapWindowDays,
    now,
  });

  if (recent >= input.policy.frequencyCapMessages) {
    return {
      allow: false,
      kind: 'BLOCK',
      reason: `Teto de frequência atingido: ${recent} mensagem(ns) de campanha nos últimos ${input.policy.frequencyCapWindowDays} dias.`,
    };
  }

  const quiet = quietHoursDecision(input.policy, now);
  if (quiet.silent) {
    return {
      allow: false,
      kind: 'DEFER',
      retryAtMs: quiet.resumeAtMs,
      reason: 'Dentro do horário silencioso configurado.',
    };
  }

  return { allow: true };
}
