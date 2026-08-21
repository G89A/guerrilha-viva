import { CampaignStatus } from '@prisma/client';

/**
 * Máquina de estados da campanha.
 *
 * Existe UMA tabela de transições. Nenhum componente, action ou serviço decide
 * por conta própria se uma mudança é válida — espalhar `if (status === …)` foi
 * exatamente o que este módulo evita.
 */

/** Para onde cada estado pode ir. Vazio significa terminal. */
const TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> = {
  [CampaignStatus.DRAFT]: [
    CampaignStatus.PREPARING,
    CampaignStatus.CANCELLED,
  ],
  [CampaignStatus.PREPARING]: [
    CampaignStatus.READY,
    // Preparação pode falhar (canal caiu, template sumiu) ou ser abortada.
    CampaignStatus.FAILED,
    CampaignStatus.CANCELLED,
    // Voltar a DRAFT permite corrigir a audiência e preparar de novo.
    CampaignStatus.DRAFT,
  ],
  [CampaignStatus.READY]: [
    CampaignStatus.SCHEDULED,
    CampaignStatus.RUNNING,
    // Reabrir para edição descarta a audiência materializada.
    CampaignStatus.DRAFT,
    CampaignStatus.PREPARING,
    CampaignStatus.CANCELLED,
  ],
  [CampaignStatus.SCHEDULED]: [
    CampaignStatus.RUNNING,
    CampaignStatus.READY,
    CampaignStatus.CANCELLED,
  ],
  [CampaignStatus.RUNNING]: [
    CampaignStatus.PAUSED,
    CampaignStatus.COMPLETED,
    CampaignStatus.CANCELLED,
    CampaignStatus.FAILED,
  ],
  [CampaignStatus.PAUSED]: [
    CampaignStatus.RUNNING,
    CampaignStatus.CANCELLED,
    CampaignStatus.COMPLETED,
  ],
  // Terminais. Uma campanha concluída ou cancelada NUNCA ressuscita.
  [CampaignStatus.COMPLETED]: [],
  [CampaignStatus.CANCELLED]: [],
  // Falha permite repreparar direto, ou voltar ao rascunho para mexer na
  // audiência antes de tentar de novo.
  [CampaignStatus.FAILED]: [
    CampaignStatus.PREPARING,
    CampaignStatus.DRAFT,
    CampaignStatus.CANCELLED,
  ],
};

export const TERMINAL_STATUSES: readonly CampaignStatus[] = [
  CampaignStatus.COMPLETED,
  CampaignStatus.CANCELLED,
];

export function isTerminal(status: CampaignStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function canTransition(from: CampaignStatus, to: CampaignStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: CampaignStatus): readonly CampaignStatus[] {
  return TRANSITIONS[from];
}

/**
 * Estados a partir dos quais uma ação pode ser iniciada. Usado tanto pela UI
 * (para desabilitar botão) quanto pelo serviço (para o compare-and-set) —
 * a mesma fonte, então não podem divergir.
 */
export const ACTION_PRECONDITIONS = {
  prepare: [CampaignStatus.DRAFT, CampaignStatus.READY, CampaignStatus.FAILED],
  schedule: [CampaignStatus.READY, CampaignStatus.SCHEDULED],
  start: [CampaignStatus.READY, CampaignStatus.SCHEDULED],
  pause: [CampaignStatus.RUNNING],
  resume: [CampaignStatus.PAUSED],
  cancel: [
    CampaignStatus.DRAFT,
    CampaignStatus.PREPARING,
    CampaignStatus.READY,
    CampaignStatus.SCHEDULED,
    CampaignStatus.RUNNING,
    CampaignStatus.PAUSED,
    CampaignStatus.FAILED,
  ],
} as const satisfies Record<string, readonly CampaignStatus[]>;

export type CampaignAction = keyof typeof ACTION_PRECONDITIONS;

export function canPerform(action: CampaignAction, status: CampaignStatus): boolean {
  return (ACTION_PRECONDITIONS[action] as readonly CampaignStatus[]).includes(status);
}

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  [CampaignStatus.DRAFT]: 'Rascunho',
  [CampaignStatus.PREPARING]: 'Preparando',
  [CampaignStatus.READY]: 'Pronta',
  [CampaignStatus.SCHEDULED]: 'Agendada',
  [CampaignStatus.RUNNING]: 'Em execução',
  [CampaignStatus.PAUSED]: 'Pausada',
  [CampaignStatus.COMPLETED]: 'Concluída',
  [CampaignStatus.CANCELLED]: 'Cancelada',
  [CampaignStatus.FAILED]: 'Falhou',
};

/** Mensagem para quando a transição é recusada — precisa dizer o porquê. */
export function transitionRefusalMessage(
  from: CampaignStatus,
  to: CampaignStatus,
): string {
  if (isTerminal(from)) {
    return `A campanha está ${CAMPAIGN_STATUS_LABELS[from].toLowerCase()} e não pode mais mudar de estado.`;
  }
  return `Não é possível ir de ${CAMPAIGN_STATUS_LABELS[from].toLowerCase()} para ${CAMPAIGN_STATUS_LABELS[to].toLowerCase()}.`;
}
