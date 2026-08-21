import type { MessagingChannel, MessageTemplate } from '@prisma/client';
import {
  ChannelStatus,
  ConsentStatus,
  ContactStatus,
  MissingVariablePolicy,
  RecipientStatus,
  TemplateAvailability,
  TemplateStatus,
} from '@prisma/client';
import { normalizePhone } from '@/features/contacts/phone';
import type { TemplateVariable } from '@/features/messaging/template-normalize';
import {
  renderTemplateText,
  resolveVariables,
  type VariableMapping,
} from '@/features/messaging/template-render';
import type { AudienceContact } from '@/features/campaigns/audience-service';

/**
 * Elegibilidade de destinatário de campanha.
 *
 * Avaliação em MEMÓRIA, sobre contatos já carregados com consentimentos e
 * supressões. Isso é deliberado: a versão unitária da Sprint 2 consulta o banco
 * por contato, o que numa audiência de dez mil viraria dez mil consultas.
 *
 * O contexto caro — canal, template, variáveis do template — é resolvido UMA
 * vez e reaproveitado para todos.
 */

export type CampaignEligibilityReason =
  | 'CONTACT_NOT_ACTIVE'
  | 'INVALID_PHONE'
  | 'CONSENT_MISSING'
  | 'CONSENT_REVOKED'
  | 'SUPPRESSED'
  | 'CHANNEL_NOT_CONNECTED'
  | 'TEMPLATE_MISSING'
  | 'TEMPLATE_NOT_APPROVED'
  | 'TEMPLATE_UNAVAILABLE'
  | 'VARIABLES_UNRESOLVED';

export const REASON_LABELS: Record<CampaignEligibilityReason, string> = {
  CONTACT_NOT_ACTIVE: 'Contato não está ativo',
  INVALID_PHONE: 'Telefone inválido',
  CONSENT_MISSING: 'Sem consentimento registrado',
  CONSENT_REVOKED: 'Consentimento revogado',
  SUPPRESSED: 'Na lista de supressão',
  CHANNEL_NOT_CONNECTED: 'Canal não conectado',
  TEMPLATE_MISSING: 'Template não definido',
  TEMPLATE_NOT_APPROVED: 'Template não aprovado pela Meta',
  TEMPLATE_UNAVAILABLE: 'Template removido da Meta',
  VARIABLES_UNRESOLVED: 'Variável sem valor para este contato',
};

export interface RecipientEvaluation {
  eligible: boolean;
  reasons: CampaignEligibilityReason[];
  /** Status a gravar no destinatário. */
  status: RecipientStatus;
  /** Parâmetros resolvidos, presentes só quando elegível. */
  resolved: { headerParameters: string[]; bodyParameters: string[] } | null;
  /** Texto final que o contato receberia. */
  preview: string | null;
}

/**
 * Contexto compartilhado por toda a avaliação. Montado uma vez por campanha.
 *
 * `blockedForAll` guarda os motivos que independem do contato — canal caído,
 * template rejeitado. Se houver algum, ninguém é elegível, e isso é dito com
 * clareza em vez de aparecer como "todos sem consentimento".
 */
export interface EligibilityContext {
  channel: MessagingChannel | null;
  template: MessageTemplate | null;
  mapping: VariableMapping;
  variablePolicy: MissingVariablePolicy;
  variableFallbacks: Record<string, string>;
  variables: TemplateVariable[];
  templateBody: string;
  blockedForAll: CampaignEligibilityReason[];
}

export function buildEligibilityContext(input: {
  channel: MessagingChannel | null;
  template: MessageTemplate | null;
  mapping: VariableMapping;
  variablePolicy?: MissingVariablePolicy;
  variableFallbacks?: Record<string, string>;
}): EligibilityContext {
  const blockedForAll: CampaignEligibilityReason[] = [];

  if (!input.channel || input.channel.status !== ChannelStatus.CONNECTED) {
    blockedForAll.push('CHANNEL_NOT_CONNECTED');
  }

  if (!input.template) {
    blockedForAll.push('TEMPLATE_MISSING');
  } else {
    // Campanha iniciada pela empresa exige template APROVADO pela Meta.
    if (input.template.status !== TemplateStatus.APPROVED) {
      blockedForAll.push('TEMPLATE_NOT_APPROVED');
    }
    if (input.template.availability !== TemplateAvailability.AVAILABLE) {
      blockedForAll.push('TEMPLATE_UNAVAILABLE');
    }
  }

  return {
    channel: input.channel,
    template: input.template,
    mapping: input.mapping,
    variablePolicy: input.variablePolicy ?? MissingVariablePolicy.BLOCK_RECIPIENT,
    variableFallbacks: input.variableFallbacks ?? {},
    variables: (input.template?.variables as unknown as TemplateVariable[]) ?? [],
    templateBody: input.template?.body ?? '',
    blockedForAll,
  };
}

/**
 * Avalia UM contato já carregado. Sem I/O.
 *
 * Ordem deliberada: supressão é verificada sempre e vence tudo — mesmo com
 * consentimento GRANTED, mesmo pertencendo à lista, mesmo estando em campanha
 * anterior.
 */
export function evaluateCampaignRecipientEligibility(
  contact: AudienceContact,
  context: EligibilityContext,
): RecipientEvaluation {
  const reasons: CampaignEligibilityReason[] = [...context.blockedForAll];

  if (contact.status !== ContactStatus.ACTIVE) reasons.push('CONTACT_NOT_ACTIVE');
  if (!normalizePhone(contact.phoneE164).ok) reasons.push('INVALID_PHONE');

  const consent = contact.consents[0];
  if (!consent || consent.status === ConsentStatus.UNKNOWN) {
    // Telefone existente NUNCA é tratado como consentimento.
    reasons.push('CONSENT_MISSING');
  } else if (consent.status === ConsentStatus.REVOKED) {
    reasons.push('CONSENT_REVOKED');
  }

  const suppressed = contact.suppressions.length > 0;
  if (suppressed) reasons.push('SUPPRESSED');

  // Variáveis só são resolvidas se houver template — sem ele o motivo já está
  // registrado e tentar resolver não acrescenta informação.
  let resolved: RecipientEvaluation['resolved'] = null;
  let preview: string | null = null;

  if (context.template) {
    const applied = applyFallbacks(contact, context);
    const header = resolveVariables(context.variables, applied, contact, 'header');
    const body = resolveVariables(context.variables, applied, contact, 'body');

    if (!header.ok || !body.ok) {
      reasons.push('VARIABLES_UNRESOLVED');
    } else {
      resolved = { headerParameters: header.values, bodyParameters: body.values };
      preview = renderTemplateText(context.templateBody, body.values);
    }
  }

  const eligible = reasons.length === 0;

  return {
    eligible,
    reasons,
    status: statusFor(eligible, suppressed, reasons),
    resolved: eligible ? resolved : null,
    preview,
  };
}

/**
 * Aplica os fallbacks configurados, quando a política permite.
 *
 * Um fallback só entra se tiver sido escrito explicitamente para aquela
 * variável. Nada é inventado: sem fallback configurado, o destinatário é
 * bloqueado.
 */
function applyFallbacks(
  contact: AudienceContact,
  context: EligibilityContext,
): VariableMapping {
  if (context.variablePolicy !== MissingVariablePolicy.FALLBACK_VALUE) return context.mapping;

  const applied: VariableMapping = { ...context.mapping };

  for (const variable of context.variables) {
    const key = `${variable.component}:${variable.key}`;
    const fallback = context.variableFallbacks[key] ?? context.variableFallbacks[variable.key];
    if (!fallback || fallback.trim().length === 0) continue;

    const current = applied[key] ?? context.mapping[variable.key];
    const resolvedValue = current
      ? resolveVariables([variable], { [key]: current }, contact, variable.component)
      : { ok: false as const, missing: [variable.key] };

    if (!resolvedValue.ok) {
      applied[key] = { source: 'literal', value: fallback };
    }
  }

  return applied;
}

/** Supressão e telefone inválido têm status próprio, para o relatório. */
function statusFor(
  eligible: boolean,
  suppressed: boolean,
  reasons: CampaignEligibilityReason[],
): RecipientStatus {
  if (eligible) return RecipientStatus.ELIGIBLE;
  if (suppressed) return RecipientStatus.SUPPRESSED;
  if (reasons.includes('INVALID_PHONE')) return RecipientStatus.INVALID;
  return RecipientStatus.INELIGIBLE;
}

export interface EvaluationBreakdown {
  total: number;
  eligible: number;
  suppressed: number;
  invalid: number;
  ineligible: number;
  /** Quantos bloqueios de cada motivo — alimenta o relatório do wizard. */
  byReason: Record<string, number>;
}

export function emptyBreakdown(): EvaluationBreakdown {
  return { total: 0, eligible: 0, suppressed: 0, invalid: 0, ineligible: 0, byReason: {} };
}

export function accumulate(
  breakdown: EvaluationBreakdown,
  evaluation: RecipientEvaluation,
): void {
  breakdown.total += 1;

  if (evaluation.eligible) breakdown.eligible += 1;
  else if (evaluation.status === RecipientStatus.SUPPRESSED) breakdown.suppressed += 1;
  else if (evaluation.status === RecipientStatus.INVALID) breakdown.invalid += 1;
  else breakdown.ineligible += 1;

  for (const reason of evaluation.reasons) {
    breakdown.byReason[reason] = (breakdown.byReason[reason] ?? 0) + 1;
  }
}
