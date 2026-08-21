/**
 * Fixtures no formato real da Meta (WhatsApp Business Cloud API).
 *
 * São payloads de exemplo montados à mão a partir do formato documentado —
 * NÃO capturas de tráfego real. Nenhum wamid aqui veio de um envio de verdade.
 */

export const PHONE_NUMBER_ID = '111111111111111';
export const WABA_ID = '222222222222222';
export const DISPLAY_PHONE = '+55 85 99999-0000';

interface ChangeValue {
  messaging_product: string;
  metadata: { display_phone_number: string; phone_number_id: string };
  contacts?: unknown[];
  messages?: unknown[];
  statuses?: unknown[];
}

function envelope(value: ChangeValue, field = 'messages'): unknown {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: WABA_ID, changes: [{ value, field }] }],
  };
}

function baseValue(phoneNumberId = PHONE_NUMBER_ID): ChangeValue {
  return {
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: DISPLAY_PHONE, phone_number_id: phoneNumberId },
  };
}

export function statusPayload(options: {
  wamid: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  recipient?: string;
  timestamp?: number;
  phoneNumberId?: string;
  errors?: unknown[];
}): unknown {
  return envelope({
    ...baseValue(options.phoneNumberId),
    statuses: [
      {
        id: options.wamid,
        status: options.status,
        timestamp: String(options.timestamp ?? 1755734400),
        recipient_id: options.recipient ?? '5585988887777',
        conversation: { id: 'conv_1', origin: { type: 'service' } },
        pricing: { billable: true, category: 'service' },
        ...(options.errors ? { errors: options.errors } : {}),
      },
    ],
  });
}

export function textMessagePayload(options: {
  wamid: string;
  from?: string;
  body?: string;
  profileName?: string;
  timestamp?: number;
  phoneNumberId?: string;
}): unknown {
  const from = options.from ?? '5585988887777';
  return envelope({
    ...baseValue(options.phoneNumberId),
    contacts: [{ profile: { name: options.profileName ?? 'Larissa Melo' }, wa_id: from }],
    messages: [
      {
        from,
        id: options.wamid,
        timestamp: String(options.timestamp ?? 1755734400),
        type: 'text',
        text: { body: options.body ?? 'Oi, quero saber mais.' },
      },
    ],
  });
}

export function mediaMessagePayload(options: {
  wamid: string;
  type: 'image' | 'document' | 'audio' | 'video';
  from?: string;
  phoneNumberId?: string;
}): unknown {
  const from = options.from ?? '5585988887777';
  return envelope({
    ...baseValue(options.phoneNumberId),
    contacts: [{ profile: { name: 'Larissa Melo' }, wa_id: from }],
    messages: [
      {
        from,
        id: options.wamid,
        timestamp: '1755734400',
        type: options.type,
        [options.type]: {
          id: 'media_abc123',
          mime_type: options.type === 'image' ? 'image/jpeg' : 'application/pdf',
          sha256: 'a'.repeat(64),
          ...(options.type === 'document' ? { filename: 'orcamento.pdf' } : {}),
          caption: 'segue em anexo',
        },
      },
    ],
  });
}

export const FAILED_ERROR = [
  {
    code: 131047,
    title: 'Re-engagement message',
    message: 'Message failed to send because more than 24 hours have passed.',
    error_data: { details: 'Fora da janela de atendimento.' },
  },
];

export function unknownFieldPayload(): unknown {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: WABA_ID,
        changes: [{ value: { something: true }, field: 'message_template_status_update' }],
      },
    ],
  };
}

export function multiEventPayload(): unknown {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: WABA_ID,
        changes: [
          {
            field: 'messages',
            value: {
              ...baseValue(),
              contacts: [{ profile: { name: 'Larissa' }, wa_id: '5585988887777' }],
              messages: [
                {
                  from: '5585988887777',
                  id: 'wamid.INBOUND_A',
                  timestamp: '1755734400',
                  type: 'text',
                  text: { body: 'primeira' },
                },
              ],
              statuses: [
                { id: 'wamid.OUT_A', status: 'delivered', timestamp: '1755734400', recipient_id: '5585988887777' },
                { id: 'wamid.OUT_B', status: 'read', timestamp: '1755734401', recipient_id: '5585988887777' },
              ],
            },
          },
        ],
      },
    ],
  };
}
