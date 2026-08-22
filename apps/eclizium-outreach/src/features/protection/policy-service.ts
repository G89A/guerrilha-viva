import 'server-only';
import { prisma } from '@/lib/db/client';
import { isValidTimeZone } from '@/features/analytics/range';

/**
 * Política de envio do workspace.
 *
 * Ler nunca falha por falta de linha: workspace sem política configurada recebe
 * os padrões, então um tenant novo já nasce protegido em vez de nascer sem
 * freio nenhum.
 */

export interface SendingPolicyView {
  optOutEnabled: boolean;
  optOutKeywords: string[];
  frequencyCapMessages: number;
  frequencyCapWindowDays: number;
  quietHoursEnabled: boolean;
  quietHoursStart: number;
  quietHoursEnd: number;
  timeZone: string;
  pauseOnRedQuality: boolean;
  pauseOnYellowQuality: boolean;
}

export const DEFAULT_POLICY: SendingPolicyView = {
  optOutEnabled: true,
  optOutKeywords: ['PARAR', 'SAIR', 'CANCELAR', 'DESCADASTRAR', 'STOP', 'REMOVER'],
  frequencyCapMessages: 4,
  frequencyCapWindowDays: 7,
  quietHoursEnabled: true,
  quietHoursStart: 21,
  quietHoursEnd: 8,
  timeZone: 'America/Sao_Paulo',
  pauseOnRedQuality: true,
  pauseOnYellowQuality: false,
};

export async function getSendingPolicy(workspaceId: string): Promise<SendingPolicyView> {
  const stored = await prisma.sendingPolicy.findUnique({ where: { workspaceId } });
  if (!stored) return DEFAULT_POLICY;

  return {
    optOutEnabled: stored.optOutEnabled,
    optOutKeywords: stored.optOutKeywords,
    frequencyCapMessages: stored.frequencyCapMessages,
    frequencyCapWindowDays: stored.frequencyCapWindowDays,
    quietHoursEnabled: stored.quietHoursEnabled,
    quietHoursStart: stored.quietHoursStart,
    quietHoursEnd: stored.quietHoursEnd,
    timeZone: stored.timeZone,
    pauseOnRedQuality: stored.pauseOnRedQuality,
    pauseOnYellowQuality: stored.pauseOnYellowQuality,
  };
}

export type PolicyUpdate = Partial<SendingPolicyView>;

export interface PolicyOutcome {
  ok: boolean;
  reason?: string;
}

/**
 * Grava a política, validando os limites.
 *
 * `upsert` aqui é seguro: a chave é `workspaceId` unique e a operação NÃO roda
 * dentro de transação — o caso do 25P02 não se aplica.
 *
 * Nenhum limite pode ser desligado por acidente: teto de frequência zero seria
 * "nunca enviar", não "sem limite", então o mínimo é 1.
 */
export async function updateSendingPolicy(
  workspaceId: string,
  update: PolicyUpdate,
): Promise<PolicyOutcome> {
  if (update.timeZone !== undefined && !isValidTimeZone(update.timeZone)) {
    return { ok: false, reason: 'Fuso horário inválido.' };
  }
  if (update.frequencyCapMessages !== undefined && update.frequencyCapMessages < 1) {
    return { ok: false, reason: 'O teto de frequência precisa ser pelo menos 1.' };
  }
  if (update.frequencyCapWindowDays !== undefined && update.frequencyCapWindowDays < 1) {
    return { ok: false, reason: 'A janela precisa ser de pelo menos 1 dia.' };
  }
  for (const hour of [update.quietHoursStart, update.quietHoursEnd]) {
    if (hour !== undefined && (hour < 0 || hour > 23 || !Number.isInteger(hour))) {
      return { ok: false, reason: 'Horário silencioso precisa ser uma hora entre 0 e 23.' };
    }
  }

  const keywords = update.optOutKeywords
    ?.map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0)
    .slice(0, 40);

  if (update.optOutEnabled === true && keywords !== undefined && keywords.length === 0) {
    return { ok: false, reason: 'Descadastro ligado exige ao menos uma palavra-chave.' };
  }

  const data = {
    ...(update.optOutEnabled === undefined ? {} : { optOutEnabled: update.optOutEnabled }),
    ...(keywords === undefined ? {} : { optOutKeywords: keywords }),
    ...(update.frequencyCapMessages === undefined
      ? {}
      : { frequencyCapMessages: update.frequencyCapMessages }),
    ...(update.frequencyCapWindowDays === undefined
      ? {}
      : { frequencyCapWindowDays: update.frequencyCapWindowDays }),
    ...(update.quietHoursEnabled === undefined
      ? {}
      : { quietHoursEnabled: update.quietHoursEnabled }),
    ...(update.quietHoursStart === undefined ? {} : { quietHoursStart: update.quietHoursStart }),
    ...(update.quietHoursEnd === undefined ? {} : { quietHoursEnd: update.quietHoursEnd }),
    ...(update.timeZone === undefined ? {} : { timeZone: update.timeZone }),
    ...(update.pauseOnRedQuality === undefined
      ? {}
      : { pauseOnRedQuality: update.pauseOnRedQuality }),
    ...(update.pauseOnYellowQuality === undefined
      ? {}
      : { pauseOnYellowQuality: update.pauseOnYellowQuality }),
  };

  await prisma.sendingPolicy.upsert({
    where: { workspaceId },
    create: { workspaceId, ...DEFAULT_POLICY, ...data },
    update: data,
  });

  return { ok: true };
}
