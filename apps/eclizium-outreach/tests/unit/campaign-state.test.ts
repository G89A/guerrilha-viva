import { describe, expect, it } from 'vitest';
import { CampaignStatus } from '@prisma/client';
import {
  allowedTransitions,
  canPerform,
  canTransition,
  isTerminal,
  transitionRefusalMessage,
} from '@/features/campaigns/campaign-state';

const ALL = Object.values(CampaignStatus);

describe('transições permitidas', () => {
  it.each([
    [CampaignStatus.DRAFT, CampaignStatus.PREPARING],
    [CampaignStatus.PREPARING, CampaignStatus.READY],
    [CampaignStatus.READY, CampaignStatus.RUNNING],
    [CampaignStatus.READY, CampaignStatus.SCHEDULED],
    [CampaignStatus.SCHEDULED, CampaignStatus.RUNNING],
    [CampaignStatus.RUNNING, CampaignStatus.PAUSED],
    [CampaignStatus.PAUSED, CampaignStatus.RUNNING],
    [CampaignStatus.RUNNING, CampaignStatus.COMPLETED],
    [CampaignStatus.RUNNING, CampaignStatus.CANCELLED],
    [CampaignStatus.PAUSED, CampaignStatus.CANCELLED],
  ])('permite %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });
});

describe('transições proibidas', () => {
  it('COMPLETED → RUNNING é recusada', () => {
    expect(canTransition(CampaignStatus.COMPLETED, CampaignStatus.RUNNING)).toBe(false);
  });

  it('uma campanha cancelada nunca ressuscita', () => {
    for (const to of ALL) {
      expect(canTransition(CampaignStatus.CANCELLED, to), `CANCELLED → ${to}`).toBe(false);
    }
  });

  it('uma campanha concluída nunca volta atrás', () => {
    for (const to of ALL) {
      expect(canTransition(CampaignStatus.COMPLETED, to), `COMPLETED → ${to}`).toBe(false);
    }
  });

  it.each([
    [CampaignStatus.DRAFT, CampaignStatus.RUNNING],
    [CampaignStatus.DRAFT, CampaignStatus.COMPLETED],
    [CampaignStatus.PREPARING, CampaignStatus.RUNNING],
    [CampaignStatus.SCHEDULED, CampaignStatus.PAUSED],
    [CampaignStatus.PAUSED, CampaignStatus.PREPARING],
  ])('recusa %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('nenhum estado transita para si mesmo', () => {
    for (const status of ALL) {
      expect(canTransition(status, status), `${status} → ${status}`).toBe(false);
    }
  });

  it('a tabela cobre todos os estados, sem buraco', () => {
    for (const status of ALL) {
      expect(allowedTransitions(status), `${status} sem entrada`).toBeDefined();
    }
  });
});

describe('estados terminais', () => {
  it.each([CampaignStatus.COMPLETED, CampaignStatus.CANCELLED])('%s é terminal', (status) => {
    expect(isTerminal(status)).toBe(true);
    expect(allowedTransitions(status)).toHaveLength(0);
  });

  it.each([
    CampaignStatus.DRAFT,
    CampaignStatus.PREPARING,
    CampaignStatus.READY,
    CampaignStatus.SCHEDULED,
    CampaignStatus.RUNNING,
    CampaignStatus.PAUSED,
    CampaignStatus.FAILED,
  ])('%s não é terminal', (status) => {
    expect(isTerminal(status)).toBe(false);
    expect(allowedTransitions(status).length).toBeGreaterThan(0);
  });

  it('FAILED permite recomeçar do rascunho', () => {
    expect(canTransition(CampaignStatus.FAILED, CampaignStatus.DRAFT)).toBe(true);
  });
});

describe('pré-condições das ações', () => {
  it.each([
    ['prepare', CampaignStatus.DRAFT, true],
    ['prepare', CampaignStatus.RUNNING, false],
    ['prepare', CampaignStatus.CANCELLED, false],
    ['start', CampaignStatus.READY, true],
    ['start', CampaignStatus.DRAFT, false],
    ['pause', CampaignStatus.RUNNING, true],
    ['pause', CampaignStatus.PAUSED, false],
    ['resume', CampaignStatus.PAUSED, true],
    ['resume', CampaignStatus.CANCELLED, false],
    ['resume', CampaignStatus.COMPLETED, false],
    ['resume', CampaignStatus.FAILED, false],
    ['cancel', CampaignStatus.RUNNING, true],
    ['cancel', CampaignStatus.COMPLETED, false],
    ['cancel', CampaignStatus.CANCELLED, false],
  ] as const)('%s a partir de %s → %s', (action, status, expected) => {
    expect(canPerform(action, status)).toBe(expected);
  });

  it('nenhuma ação é possível a partir de um estado terminal', () => {
    for (const status of [CampaignStatus.COMPLETED, CampaignStatus.CANCELLED]) {
      for (const action of ['prepare', 'schedule', 'start', 'pause', 'resume', 'cancel'] as const) {
        expect(canPerform(action, status), `${action} em ${status}`).toBe(false);
      }
    }
  });

  it('toda pré-condição corresponde a uma transição real', () => {
    // Se a UI habilita o botão, o serviço tem de conseguir executar.
    const destino = {
      prepare: CampaignStatus.PREPARING,
      pause: CampaignStatus.PAUSED,
      resume: CampaignStatus.RUNNING,
      cancel: CampaignStatus.CANCELLED,
    } as const;

    for (const [action, target] of Object.entries(destino)) {
      for (const status of Object.values(CampaignStatus)) {
        if (!canPerform(action as keyof typeof destino, status)) continue;
        expect(
          canTransition(status, target),
          `${action} habilitado em ${status} mas ${status}→${target} é inválido`,
        ).toBe(true);
      }
    }
  });
});

describe('mensagem de recusa', () => {
  it('explica que o estado é terminal', () => {
    const message = transitionRefusalMessage(CampaignStatus.CANCELLED, CampaignStatus.RUNNING);
    expect(message).toContain('cancelada');
    expect(message).toContain('não pode mais');
  });

  it('nomeia origem e destino quando não é terminal', () => {
    const message = transitionRefusalMessage(CampaignStatus.DRAFT, CampaignStatus.RUNNING);
    expect(message).toContain('rascunho');
    expect(message).toContain('em execução');
  });
});
