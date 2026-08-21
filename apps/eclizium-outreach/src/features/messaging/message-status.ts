import { MessageStatus } from '@prisma/client';
import type { ProviderMessageStatus } from '@/features/webhooks/parser';

/**
 * Máquina de transição do status de uma mensagem enviada.
 *
 * A Meta não garante ordem de entrega dos webhooks: `read` pode chegar antes de
 * `delivered`. Sem uma regra central, o último webhook a chegar venceria e o
 * status regrediria — uma mensagem lida voltaria a "entregue".
 *
 * A regra é: o status só avança. Nunca retrocede.
 */

/** Posto de avanço. Maior significa "mais adiante no ciclo de vida". */
const RANK: Record<MessageStatus, number> = {
  [MessageStatus.QUEUED]: 0,
  [MessageStatus.SENDING]: 1,
  [MessageStatus.SENT]: 2,
  [MessageStatus.DELIVERED]: 3,
  [MessageStatus.READ]: 4,
  // Falha é terminal em seu próprio eixo; nunca é comparada por posto.
  [MessageStatus.FAILED]: -1,
  // Mensagem recebida não participa deste ciclo.
  [MessageStatus.RECEIVED]: -1,
};

const PROVIDER_STATUS_MAP: Record<ProviderMessageStatus, MessageStatus> = {
  sent: MessageStatus.SENT,
  delivered: MessageStatus.DELIVERED,
  read: MessageStatus.READ,
  failed: MessageStatus.FAILED,
};

/** Traduz o status do provider. Nada é inventado: são os quatro documentados. */
export function toInternalStatus(status: ProviderMessageStatus): MessageStatus {
  return PROVIDER_STATUS_MAP[status];
}

/**
 * Prova de que a mensagem chegou ao destinatário. Um `failed` que chegue depois
 * disso é atraso ou ruído — a entrega já aconteceu e não se desfaz.
 */
function hasDeliveryProof(status: MessageStatus): boolean {
  return status === MessageStatus.DELIVERED || status === MessageStatus.READ;
}

export interface TransitionDecision {
  allowed: boolean;
  reason: 'ADVANCE' | 'SAME_STATE' | 'WOULD_REGRESS' | 'ALREADY_DELIVERED' | 'NOT_OUTBOUND_CYCLE';
}

export function evaluateTransition(
  current: MessageStatus,
  next: MessageStatus,
): TransitionDecision {
  if (current === next) return { allowed: false, reason: 'SAME_STATE' };

  if (next === MessageStatus.FAILED) {
    return hasDeliveryProof(current)
      ? { allowed: false, reason: 'ALREADY_DELIVERED' }
      : { allowed: true, reason: 'ADVANCE' };
  }

  // Uma mensagem já marcada como falha não volta ao ciclo por um webhook
  // atrasado; e mensagem recebida não tem ciclo de entrega.
  if (current === MessageStatus.FAILED || current === MessageStatus.RECEIVED) {
    return { allowed: false, reason: 'NOT_OUTBOUND_CYCLE' };
  }

  return RANK[next] > RANK[current]
    ? { allowed: true, reason: 'ADVANCE' }
    : { allowed: false, reason: 'WOULD_REGRESS' };
}

export function canTransition(current: MessageStatus, next: MessageStatus): boolean {
  return evaluateTransition(current, next).allowed;
}

/**
 * Carimbo de tempo correspondente ao novo status. Cada marco tem seu próprio
 * campo, então avançar não apaga a história dos anteriores.
 */
export function timestampFieldFor(
  status: MessageStatus,
): 'sentAt' | 'deliveredAt' | 'readAt' | 'failedAt' | null {
  switch (status) {
    case MessageStatus.SENT:
      return 'sentAt';
    case MessageStatus.DELIVERED:
      return 'deliveredAt';
    case MessageStatus.READ:
      return 'readAt';
    case MessageStatus.FAILED:
      return 'failedAt';
    default:
      return null;
  }
}

export const MESSAGE_STATUS_LABELS: Record<MessageStatus, string> = {
  [MessageStatus.QUEUED]: 'Na fila',
  [MessageStatus.SENDING]: 'Enviando',
  [MessageStatus.SENT]: 'Enviada',
  [MessageStatus.DELIVERED]: 'Entregue',
  [MessageStatus.READ]: 'Lida',
  [MessageStatus.FAILED]: 'Falhou',
  [MessageStatus.RECEIVED]: 'Recebida',
};
