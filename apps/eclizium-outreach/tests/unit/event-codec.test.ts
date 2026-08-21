import { describe, expect, it } from 'vitest';
import { deserializeEvent, serializeEvent } from '@/features/webhooks/event-codec';
import { parseWebhookPayload } from '@/features/webhooks/parser';
import { statusPayload, textMessagePayload, mediaMessagePayload } from '../helpers/webhook-fixtures';

function firstEvent(payload: unknown) {
  const parsed = parseWebhookPayload(JSON.stringify(payload));
  if (!parsed.ok) throw new Error(parsed.reason);
  const event = parsed.events[0];
  if (!event) throw new Error('nenhum evento');
  return event;
}

describe('codec de evento — ida e volta', () => {
  it('mensagem recebida sobrevive à serialização', () => {
    const original = firstEvent(textMessagePayload({ wamid: 'wamid.C1', body: 'Olá' }));
    const restored = deserializeEvent(original.kind, serializeEvent(original));

    expect(restored).toEqual(original);
  });

  it('o nome do perfil sobrevive — ele NÃO está no fragmento cru', () => {
    const original = firstEvent(textMessagePayload({ wamid: 'wamid.C2', body: 'Oi' }));
    if (original.kind !== 'INBOUND_MESSAGE') throw new Error('tipo inesperado');
    expect(original.profileName).toBe('Larissa Melo');

    const restored = deserializeEvent(original.kind, serializeEvent(original));
    expect(restored?.kind).toBe('INBOUND_MESSAGE');
    if (restored?.kind !== 'INBOUND_MESSAGE') return;
    expect(restored.profileName).toBe('Larissa Melo');
  });

  it('metadados de mídia sobrevivem', () => {
    const original = firstEvent(mediaMessagePayload({ wamid: 'wamid.C3', type: 'document' }));
    const restored = deserializeEvent(original.kind, serializeEvent(original));
    expect(restored).toEqual(original);
  });

  it('status sobrevive, com timestamp e erros', () => {
    const original = firstEvent(statusPayload({ wamid: 'wamid.C4', status: 'delivered' }));
    const restored = deserializeEvent(original.kind, serializeEvent(original));
    expect(restored).toEqual(original);
  });

  it('evento desconhecido sobrevive com a descrição', () => {
    const parsed = parseWebhookPayload(
      JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [{ id: '222', changes: [{ field: 'account_alerts', value: {} }] }],
      }),
    );
    if (!parsed.ok) throw new Error('parse falhou');
    const original = parsed.events[0];
    if (!original) throw new Error('nenhum evento');

    const restored = deserializeEvent(original.kind, serializeEvent(original));
    expect(restored?.kind).toBe('UNKNOWN_EVENT');
  });
});

describe('codec de evento — formato antigo', () => {
  it('lê o formato { metadata, event } gravado antes da Sprint 6', () => {
    const original = firstEvent(textMessagePayload({ wamid: 'wamid.L1', body: 'legado' }));
    if (original.kind !== 'INBOUND_MESSAGE') throw new Error('tipo inesperado');

    const legacy = { metadata: original.metadata, event: original.raw };
    const restored = deserializeEvent('INBOUND_MESSAGE', legacy);

    expect(restored?.kind).toBe('INBOUND_MESSAGE');
    if (restored?.kind !== 'INBOUND_MESSAGE') return;
    expect(restored.providerMessageId).toBe('wamid.L1');
    expect(restored.text).toBe('legado');
    // O nome do perfil não estava no fragmento cru; perder isso é o preço do
    // formato antigo, e é o motivo do formato novo existir.
    expect(restored.profileName).toBeNull();
  });

  it('lê um status no formato antigo', () => {
    const original = firstEvent(statusPayload({ wamid: 'wamid.L2', status: 'read' }));
    const legacy = { metadata: original.metadata, event: original.raw };
    const restored = deserializeEvent('MESSAGE_STATUS_CHANGED', legacy);

    expect(restored?.kind).toBe('MESSAGE_STATUS_CHANGED');
    if (restored?.kind !== 'MESSAGE_STATUS_CHANGED') return;
    expect(restored.status).toBe('read');
  });
});

describe('codec de evento — entrada hostil', () => {
  it.each([
    ['nulo', null],
    ['número', 42],
    ['array', []],
    ['string', 'x'],
    ['objeto vazio', {}],
    ['versão desconhecida sem fragmento', { v: 99 }],
  ])('devolve null para %s em vez de fabricar evento', (_label, payload) => {
    expect(deserializeEvent('INBOUND_MESSAGE', payload)).toBeNull();
  });

  it('recusa evento tipado sem id de mensagem', () => {
    expect(
      deserializeEvent('INBOUND_MESSAGE', {
        v: 1,
        kind: 'INBOUND_MESSAGE',
        eventId: 'msg:x',
        metadata: {},
        from: '5585988887777',
      }),
    ).toBeNull();
  });

  it('recusa status tipado sem status', () => {
    expect(
      deserializeEvent('MESSAGE_STATUS_CHANGED', {
        v: 1,
        kind: 'MESSAGE_STATUS_CHANGED',
        eventId: 'status:x',
        metadata: {},
        providerMessageId: 'wamid.X',
      }),
    ).toBeNull();
  });

  it('timestamp inválido vira null em vez de Invalid Date', () => {
    const restored = deserializeEvent('MESSAGE_STATUS_CHANGED', {
      v: 1,
      kind: 'MESSAGE_STATUS_CHANGED',
      eventId: 'status:y',
      metadata: {},
      providerMessageId: 'wamid.Y',
      status: 'sent',
      timestamp: 'não é data',
    });
    expect(restored?.kind).toBe('MESSAGE_STATUS_CHANGED');
    if (restored?.kind !== 'MESSAGE_STATUS_CHANGED') return;
    expect(restored.timestamp).toBeNull();
  });
});
