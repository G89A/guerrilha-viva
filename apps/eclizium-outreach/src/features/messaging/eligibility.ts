import 'server-only';
import type { MessagingChannel, MessageTemplate } from '@prisma/client';
import {
  ChannelStatus,
  ConsentChannel,
  ConsentStatus,
  ContactStatus,
  TemplateAvailability,
  TemplateStatus,
} from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { normalizePhone } from '@/features/contacts/phone';
import { resolveVariables, type VariableMapping } from '@/features/messaging/template-render';
import type { TemplateVariable } from '@/features/messaging/template-normalize';

/**
 * Motor de elegibilidade.
 *
 * Nenhum caminho de envio pode chamar a Meta sem passar por aqui. A função
 * devolve TODOS os motivos de bloqueio, não apenas o primeiro, para que o
 * operador conserte tudo de uma vez.
 */

export type EligibilityReasonCode =
  | 'CONTACT_NOT_FOUND'
  | 'CONTACT_NOT_ACTIVE'
  | 'INVALID_PHONE'
  | 'CONSENT_MISSING'
  | 'CONSENT_REVOKED'
  | 'SUPPRESSED'
  | 'CHANNEL_NOT_CONNECTED'
  | 'TEMPLATE_NOT_FOUND'
  | 'TEMPLATE_NOT_APPROVED'
  | 'TEMPLATE_UNAVAILABLE'
  | 'VARIABLES_UNRESOLVED';

export interface EligibilityReason {
  code: EligibilityReasonCode;
  message: string;
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: EligibilityReason[];
  /** Parâmetros já resolvidos, presentes só quando elegível. */
  resolved: { headerParameters: string[]; bodyParameters: string[] } | null;
}

export interface EligibilityInput {
  workspaceId: string;
  contactId: string;
  channel: MessagingChannel;
  template: MessageTemplate | null;
  mapping: VariableMapping;
}

/**
 * Avalia um contato para envio via WhatsApp.
 *
 * Ordem deliberada: identidade e posse primeiro, compliance depois,
 * configuração do canal e template por último. Todos os checks rodam.
 */
export async function evaluateContactEligibility(
  input: EligibilityInput,
): Promise<EligibilityResult> {
  const reasons: EligibilityReason[] = [];

  // Sempre relido do banco e escopado ao workspace: um objeto de contato vindo
  // do navegador nunca é fonte de verdade.
  const contact = await prisma.contact.findFirst({
    where: { id: input.contactId, workspaceId: input.workspaceId },
    include: {
      consents: { where: { channel: ConsentChannel.WHATSAPP }, take: 1 },
      suppressions: { where: { channel: ConsentChannel.WHATSAPP }, take: 1 },
    },
  });

  if (!contact) {
    return {
      eligible: false,
      reasons: [{ code: 'CONTACT_NOT_FOUND', message: 'Contato não encontrado neste workspace.' }],
      resolved: null,
    };
  }

  if (contact.status !== ContactStatus.ACTIVE) {
    reasons.push({
      code: 'CONTACT_NOT_ACTIVE',
      message: `Contato está ${contact.status === ContactStatus.ARCHIVED ? 'arquivado' : 'marcado como inválido'}.`,
    });
  }

  if (!normalizePhone(contact.phoneE164).ok) {
    reasons.push({ code: 'INVALID_PHONE', message: 'Telefone do contato não é um E.164 válido.' });
  }

  const consent = contact.consents[0];
  if (!consent || consent.status === ConsentStatus.UNKNOWN) {
    reasons.push({
      code: 'CONSENT_MISSING',
      message: 'Não há consentimento registrado para WhatsApp.',
    });
  } else if (consent.status === ConsentStatus.REVOKED) {
    reasons.push({ code: 'CONSENT_REVOKED', message: 'O contato revogou o consentimento.' });
  }

  if (contact.suppressions.length > 0) {
    reasons.push({
      code: 'SUPPRESSED',
      message: 'Contato está na lista de supressão para WhatsApp.',
    });
  }

  if (input.channel.status !== ChannelStatus.CONNECTED) {
    reasons.push({
      code: 'CHANNEL_NOT_CONNECTED',
      message: 'O canal WhatsApp não está conectado e verificado.',
    });
  }

  const template = input.template;
  if (!template) {
    reasons.push({ code: 'TEMPLATE_NOT_FOUND', message: 'Template não encontrado.' });
  } else {
    // Defesa em profundidade: o template já foi lido com escopo de workspace,
    // mas a checagem custa nada e fecha qualquer caminho futuro descuidado.
    if (template.workspaceId !== input.workspaceId) {
      reasons.push({ code: 'TEMPLATE_NOT_FOUND', message: 'Template não encontrado.' });
    }
    if (template.status !== TemplateStatus.APPROVED) {
      reasons.push({
        code: 'TEMPLATE_NOT_APPROVED',
        message: `Template está ${template.providerStatus ?? template.status} na Meta, não APPROVED.`,
      });
    }
    if (template.availability !== TemplateAvailability.AVAILABLE) {
      reasons.push({
        code: 'TEMPLATE_UNAVAILABLE',
        message: 'Template não existe mais na Meta. Sincronize novamente.',
      });
    }
  }

  let resolved: EligibilityResult['resolved'] = null;

  if (template) {
    const variables = (template.variables as unknown as TemplateVariable[]) ?? [];
    const header = resolveVariables(variables, input.mapping, contact, 'header');
    const body = resolveVariables(variables, input.mapping, contact, 'body');

    if (!header.ok || !body.ok) {
      const missing = [...(header.ok ? [] : header.missing), ...(body.ok ? [] : body.missing)];
      reasons.push({
        code: 'VARIABLES_UNRESOLVED',
        message: `Variáveis sem valor para este contato: ${missing.join(', ')}.`,
      });
    } else {
      resolved = { headerParameters: header.values, bodyParameters: body.values };
    }
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    resolved: reasons.length === 0 ? resolved : null,
  };
}
