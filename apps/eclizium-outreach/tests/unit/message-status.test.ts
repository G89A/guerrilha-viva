import { describe, expect, it } from 'vitest';
import { MessageStatus } from '@prisma/client';
import {
  canTransition,
  evaluateTransition,
  timestampFieldFor,
  toInternalStatus,
} from '@/features/messaging/message-status';

describe('toInternalStatus', () => {
  it.each([
    ['sent', MessageStatus.SENT],
    ['delivered', MessageStatus.DELIVERED],
    ['read', MessageStatus.READ],
    ['failed', MessageStatus.FAILED],
  ] as const)('mapeia %s da Meta', (provider, expected) => {
    expect(toInternalStatus(provider)).toBe(expected);
  });
});

describe('avanço normal', () => {
  it.each([
    [MessageStatus.SENDING, MessageStatus.SENT],
    [MessageStatus.SENT, MessageStatus.DELIVERED],
    [MessageStatus.DELIVERED, MessageStatus.READ],
    [MessageStatus.SENT, MessageStatus.READ],
    [MessageStatus.QUEUED, MessageStatus.SENT],
  ])('permite %s → %s', (current, next) => {
    expect(canTransition(current, next)).toBe(true);
  });
});

describe('proteção contra webhook fora de ordem', () => {
  it.each([
    [MessageStatus.READ, MessageStatus.DELIVERED],
    [MessageStatus.READ, MessageStatus.SENT],
    [MessageStatus.DELIVERED, MessageStatus.SENT],
    [MessageStatus.SENT, MessageStatus.SENDING],
  ])('recusa a regressão %s → %s', (current, next) => {
    const decision = evaluateTransition(current, next);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('WOULD_REGRESS');
  });

  it('READ continua READ mesmo recebendo DELIVERED depois', () => {
    let status: MessageStatus = MessageStatus.SENT;
    for (const incoming of [MessageStatus.READ, MessageStatus.DELIVERED]) {
      if (canTransition(status, incoming)) status = incoming;
    }
    expect(status).toBe(MessageStatus.READ);
  });

  it('a ordem de chegada não altera o resultado final', () => {
    const ordens = [
      [MessageStatus.SENT, MessageStatus.DELIVERED, MessageStatus.READ],
      [MessageStatus.READ, MessageStatus.SENT, MessageStatus.DELIVERED],
      [MessageStatus.DELIVERED, MessageStatus.READ, MessageStatus.SENT],
      [MessageStatus.READ, MessageStatus.DELIVERED, MessageStatus.SENT],
    ];

    for (const ordem of ordens) {
      let status: MessageStatus = MessageStatus.SENDING;
      for (const incoming of ordem) {
        if (canTransition(status, incoming)) status = incoming;
      }
      expect(status, `ordem ${ordem.join('→')}`).toBe(MessageStatus.READ);
    }
  });
});

describe('idempotência', () => {
  it.each([
    MessageStatus.SENT,
    MessageStatus.DELIVERED,
    MessageStatus.READ,
    MessageStatus.FAILED,
  ])('repetir o mesmo status (%s) não é transição', (status) => {
    const decision = evaluateTransition(status, status);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('SAME_STATE');
  });
});

describe('falha', () => {
  it.each([MessageStatus.QUEUED, MessageStatus.SENDING, MessageStatus.SENT])(
    'aceita falha vindo de %s',
    (current) => {
      expect(canTransition(current, MessageStatus.FAILED)).toBe(true);
    },
  );

  it.each([MessageStatus.DELIVERED, MessageStatus.READ])(
    'recusa falha depois de prova de entrega (%s)',
    (current) => {
      const decision = evaluateTransition(current, MessageStatus.FAILED);
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('ALREADY_DELIVERED');
    },
  );

  it('mensagem que falhou não volta ao ciclo por webhook atrasado', () => {
    for (const next of [MessageStatus.SENT, MessageStatus.DELIVERED, MessageStatus.READ]) {
      const decision = evaluateTransition(MessageStatus.FAILED, next);
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('NOT_OUTBOUND_CYCLE');
    }
  });
});

describe('mensagem recebida', () => {
  it('não participa do ciclo de entrega', () => {
    for (const next of [MessageStatus.SENT, MessageStatus.DELIVERED, MessageStatus.READ]) {
      expect(canTransition(MessageStatus.RECEIVED, next)).toBe(false);
    }
  });
});

describe('timestampFieldFor', () => {
  it.each([
    [MessageStatus.SENT, 'sentAt'],
    [MessageStatus.DELIVERED, 'deliveredAt'],
    [MessageStatus.READ, 'readAt'],
    [MessageStatus.FAILED, 'failedAt'],
  ] as const)('%s carimba %s', (status, field) => {
    expect(timestampFieldFor(status)).toBe(field);
  });

  it('estados sem marco não carimbam nada', () => {
    expect(timestampFieldFor(MessageStatus.QUEUED)).toBeNull();
    expect(timestampFieldFor(MessageStatus.RECEIVED)).toBeNull();
  });
});
