import { describe, expect, it } from 'vitest';
import { MAX_WEBHOOK_BYTES, parseWebhookPayload } from '@/features/webhooks/parser';
import {
  FAILED_ERROR,
  mediaMessagePayload,
  multiEventPayload,
  PHONE_NUMBER_ID,
  statusPayload,
  textMessagePayload,
  unknownFieldPayload,
  WABA_ID,
} from '../helpers/webhook-fixtures';

function parse(payload: unknown) {
  const outcome = parseWebhookPayload(JSON.stringify(payload));
  if (!outcome.ok) throw new Error(`esperava sucesso, veio ${outcome.reason}`);
  return outcome.events;
}

describe('payload malformado', () => {
  it.each([
    ['JSON inválido', '{não é json', 'INVALID_JSON'],
    ['vazio', '', 'INVALID_JSON'],
    ['array na raiz', '[]', 'NOT_AN_OBJECT'],
    ['string', '"texto"', 'NOT_AN_OBJECT'],
    ['null', 'null', 'NOT_AN_OBJECT'],
    ['objeto errado', '{"object":"page"}', 'UNSUPPORTED_OBJECT'],
  ])('recusa %s', (_label, body, reason) => {
    const outcome = parseWebhookPayload(body);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe(reason);
  });

  it('recusa payload gigante antes de tentar interpretar', () => {
    const outcome = parseWebhookPayload('x'.repeat(MAX_WEBHOOK_BYTES + 1));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('TOO_LARGE');
  });

  it.each([
    ['sem entry', { object: 'whatsapp_business_account' }],
    ['entry não array', { object: 'whatsapp_business_account', entry: 'x' }],
    ['entry com lixo', { object: 'whatsapp_business_account', entry: [null, 'x', 42] }],
  ])('aceita %s devolvendo lista vazia', (_label, payload) => {
    expect(parse(payload)).toEqual([]);
  });
});

describe('status de mensagem', () => {
  it.each(['sent', 'delivered', 'read', 'failed'] as const)('interpreta %s', (status) => {
    const [event] = parse(statusPayload({ wamid: 'wamid.ABC', status }));
    expect(event?.kind).toBe('MESSAGE_STATUS_CHANGED');
    if (event?.kind !== 'MESSAGE_STATUS_CHANGED') return;
    expect(event.status).toBe(status);
    expect(event.providerMessageId).toBe('wamid.ABC');
    expect(event.recipientId).toBe('5585988887777');
  });

  it('extrai a metadata que identifica o canal', () => {
    const [event] = parse(statusPayload({ wamid: 'wamid.ABC', status: 'sent' }));
    expect(event?.metadata).toEqual({
      phoneNumberId: PHONE_NUMBER_ID,
      displayPhoneNumber: '+55 85 99999-0000',
      wabaId: WABA_ID,
    });
  });

  it('converte o timestamp de segundos para data', () => {
    const [event] = parse(statusPayload({ wamid: 'wamid.A', status: 'sent', timestamp: 1755734400 }));
    if (event?.kind !== 'MESSAGE_STATUS_CHANGED') throw new Error('tipo errado');
    expect(event.timestamp?.toISOString()).toBe('2025-08-21T00:00:00.000Z');
  });

  it('extrai erros do status failed sem perder detalhe', () => {
    const [event] = parse(
      statusPayload({ wamid: 'wamid.A', status: 'failed', errors: FAILED_ERROR }),
    );
    if (event?.kind !== 'MESSAGE_STATUS_CHANGED') throw new Error('tipo errado');
    expect(event.errors[0]).toEqual({
      code: 131047,
      title: 'Re-engagement message',
      message: 'Message failed to send because more than 24 hours have passed.',
      details: 'Fora da janela de atendimento.',
    });
  });

  it('a chave de idempotência é o par mensagem+status', () => {
    const [primeiro] = parse(statusPayload({ wamid: 'wamid.A', status: 'delivered' }));
    const [repetido] = parse(statusPayload({ wamid: 'wamid.A', status: 'delivered', timestamp: 999 }));
    const [outro] = parse(statusPayload({ wamid: 'wamid.A', status: 'read' }));

    // Mesmo com timestamp diferente, o mesmo fato tem a mesma chave.
    expect(primeiro?.eventId).toBe(repetido?.eventId);
    expect(primeiro?.eventId).not.toBe(outro?.eventId);
  });

  it('status desconhecido vira UNKNOWN_EVENT, não é forçado a um estado', () => {
    const [event] = parse(
      statusPayload({ wamid: 'wamid.A', status: 'deleted' as unknown as 'sent' }),
    );
    expect(event?.kind).toBe('UNKNOWN_EVENT');
    if (event?.kind !== 'UNKNOWN_EVENT') return;
    expect(event.description).toContain('deleted');
  });

  it('status sem id vira UNKNOWN_EVENT', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: WABA_ID,
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                statuses: [{ status: 'sent' }],
              },
            },
          ],
        },
      ],
    };
    expect(parse(payload)[0]?.kind).toBe('UNKNOWN_EVENT');
  });
});

describe('mensagem recebida', () => {
  it('interpreta texto com nome de perfil', () => {
    const [event] = parse(textMessagePayload({ wamid: 'wamid.IN1', body: 'Olá!' }));
    expect(event?.kind).toBe('INBOUND_MESSAGE');
    if (event?.kind !== 'INBOUND_MESSAGE') return;
    expect(event.text).toBe('Olá!');
    expect(event.from).toBe('5585988887777');
    expect(event.profileName).toBe('Larissa Melo');
    expect(event.messageType).toBe('text');
    expect(event.eventId).toBe('msg:wamid.IN1');
  });

  it('extrai metadados de mídia sem baixar nada', () => {
    const [event] = parse(mediaMessagePayload({ wamid: 'wamid.IMG', type: 'image' }));
    if (event?.kind !== 'INBOUND_MESSAGE') throw new Error('tipo errado');
    expect(event.media).toMatchObject({ id: 'media_abc123', mimeType: 'image/jpeg' });
    expect(event.text).toBeNull();
  });

  it('documento traz o nome do arquivo', () => {
    const [event] = parse(mediaMessagePayload({ wamid: 'wamid.DOC', type: 'document' }));
    if (event?.kind !== 'INBOUND_MESSAGE') throw new Error('tipo errado');
    expect(event.media?.filename).toBe('orcamento.pdf');
  });

  it('tipo desconhecido não quebra: vira mensagem sem texto nem mídia', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: WABA_ID,
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                messages: [
                  { from: '5585988887777', id: 'wamid.X', type: 'tipo_do_futuro', timestamp: '1755734400' },
                ],
              },
            },
          ],
        },
      ],
    };
    const [event] = parse(payload);
    if (event?.kind !== 'INBOUND_MESSAGE') throw new Error('tipo errado');
    expect(event.messageType).toBe('tipo_do_futuro');
    expect(event.text).toBeNull();
    expect(event.media).toBeNull();
  });

  it('mensagem sem id ou sem remetente vira UNKNOWN_EVENT', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: WABA_ID,
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                messages: [{ type: 'text', text: { body: 'sem id' } }],
              },
            },
          ],
        },
      ],
    };
    expect(parse(payload)[0]?.kind).toBe('UNKNOWN_EVENT');
  });

  it('preserva conteúdo hostil como texto, sem interpretar', () => {
    const hostil = '<script>alert(1)</script> <img src=x onerror=alert(2)>';
    const [event] = parse(textMessagePayload({ wamid: 'wamid.XSS', body: hostil }));
    if (event?.kind !== 'INBOUND_MESSAGE') throw new Error('tipo errado');
    expect(event.text).toBe(hostil);
  });

  it('preserva unicode e emoji', () => {
    const texto = 'Olá 👋 acentuação ĩñtërnâtiônàl 中文 عربى';
    const [event] = parse(textMessagePayload({ wamid: 'wamid.U', body: texto }));
    if (event?.kind !== 'INBOUND_MESSAGE') throw new Error('tipo errado');
    expect(event.text).toBe(texto);
  });
});

describe('eventos não suportados', () => {
  it('campo diferente de messages vira UNKNOWN_EVENT com descrição', () => {
    const [event] = parse(unknownFieldPayload());
    expect(event?.kind).toBe('UNKNOWN_EVENT');
    if (event?.kind !== 'UNKNOWN_EVENT') return;
    expect(event.description).toContain('message_template_status_update');
  });

  it('alteração de messages sem conteúdo é registrada, não descartada', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: WABA_ID,
          changes: [{ field: 'messages', value: { metadata: { phone_number_id: PHONE_NUMBER_ID } } }],
        },
      ],
    };
    expect(parse(payload)[0]?.kind).toBe('UNKNOWN_EVENT');
  });
});

describe('múltiplos eventos numa entrega', () => {
  it('quebra em eventos independentes com chaves distintas', () => {
    const events = parse(multiEventPayload());
    expect(events).toHaveLength(3);
    expect(new Set(events.map((event) => event.eventId)).size).toBe(3);
    expect(events.filter((event) => event.kind === 'INBOUND_MESSAGE')).toHaveLength(1);
    expect(events.filter((event) => event.kind === 'MESSAGE_STATUS_CHANGED')).toHaveLength(2);
  });

  it('é determinístico: o mesmo payload gera as mesmas chaves', () => {
    const primeiro = parse(multiEventPayload()).map((event) => event.eventId);
    const segundo = parse(multiEventPayload()).map((event) => event.eventId);
    expect(primeiro).toEqual(segundo);
  });
});
