import 'server-only';
import type { Prisma } from '@prisma/client';
import {
  parseWebhookPayload,
  type InboundMessageEvent,
  type ParsedEvent,
  type ProviderMessageStatus,
  type StatusEvent,
  type WebhookMetadata,
} from '@/features/webhooks/parser';

/**
 * Serialização do evento persistido.
 *
 * O evento deixou de ser processado dentro da requisição (Sprint 6): quem
 * processa é o worker, minutos depois se preciso. Para isso o que está gravado
 * precisa bastar — não dá para depender de nada que só existia em memória
 * durante a entrega.
 *
 * Formato `v: 1` guarda o evento já tipado. Eventos gravados antes desta sprint
 * têm o formato antigo (`{ metadata, event }`) e continuam legíveis: o
 * fragmento cru é reembrulhado num envelope da Meta e passa pelo mesmo parser
 * de sempre. Nenhum evento antigo vira inútil por causa da mudança.
 */

export const EVENT_PAYLOAD_VERSION = 1;

export function serializeEvent(parsed: ParsedEvent): Prisma.InputJsonValue {
  const base = {
    v: EVENT_PAYLOAD_VERSION,
    kind: parsed.kind,
    eventId: parsed.eventId,
    metadata: parsed.metadata,
    raw: parsed.raw,
  };

  if (parsed.kind === 'MESSAGE_STATUS_CHANGED') {
    return {
      ...base,
      providerMessageId: parsed.providerMessageId,
      status: parsed.status,
      recipientId: parsed.recipientId,
      timestamp: parsed.timestamp?.toISOString() ?? null,
      errors: parsed.errors,
    } as unknown as Prisma.InputJsonValue;
  }

  if (parsed.kind === 'INBOUND_MESSAGE') {
    return {
      ...base,
      providerMessageId: parsed.providerMessageId,
      from: parsed.from,
      profileName: parsed.profileName,
      messageType: parsed.messageType,
      text: parsed.text,
      media: parsed.media,
      timestamp: parsed.timestamp?.toISOString() ?? null,
    } as unknown as Prisma.InputJsonValue;
  }

  return { ...base, description: parsed.description } as unknown as Prisma.InputJsonValue;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asDate(value: unknown): Date | null {
  const raw = asString(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asMetadata(value: unknown): WebhookMetadata {
  const record = asRecord(value);
  return {
    phoneNumberId: asString(record?.phoneNumberId),
    displayPhoneNumber: asString(record?.displayPhoneNumber),
    wabaId: asString(record?.wabaId),
  };
}

/**
 * Reembrulha um fragmento antigo no envelope da Meta e reaproveita o parser.
 *
 * Custa uma serialização extra e só roda para eventos gravados antes da
 * Sprint 6 — preferível a manter uma segunda implementação de parsing viva.
 */
function fromLegacyPayload(eventType: string | null, payload: unknown): ParsedEvent | null {
  const record = asRecord(payload);
  const fragment = record?.event;
  if (!fragment) return null;

  const metadata = asRecord(record?.metadata);
  const bucket =
    eventType === 'MESSAGE_STATUS_CHANGED'
      ? 'statuses'
      : eventType === 'INBOUND_MESSAGE'
        ? 'messages'
        : null;
  if (!bucket) return null;

  const envelope = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: asString(metadata?.wabaId),
        changes: [
          {
            field: 'messages',
            value: {
              metadata: {
                phone_number_id: asString(metadata?.phoneNumberId),
                display_phone_number: asString(metadata?.displayPhoneNumber),
              },
              [bucket]: [fragment],
            },
          },
        ],
      },
    ],
  };

  const outcome = parseWebhookPayload(JSON.stringify(envelope));
  if (!outcome.ok || outcome.events.length === 0) return null;
  return outcome.events[0] ?? null;
}

/** Reconstrói o evento tipado a partir do que está gravado. */
export function deserializeEvent(eventType: string | null, payload: unknown): ParsedEvent | null {
  const record = asRecord(payload);
  if (!record) return null;

  if (record.v !== EVENT_PAYLOAD_VERSION) return fromLegacyPayload(eventType, payload);

  const metadata = asMetadata(record.metadata);
  const eventId = asString(record.eventId);
  if (!eventId) return null;

  if (record.kind === 'MESSAGE_STATUS_CHANGED') {
    const providerMessageId = asString(record.providerMessageId);
    const status = asString(record.status);
    if (!providerMessageId || !status) return null;

    const event: StatusEvent = {
      kind: 'MESSAGE_STATUS_CHANGED',
      eventId,
      metadata,
      providerMessageId,
      status: status as ProviderMessageStatus,
      recipientId: asString(record.recipientId),
      timestamp: asDate(record.timestamp),
      errors: Array.isArray(record.errors) ? (record.errors as StatusEvent['errors']) : [],
      raw: record.raw,
    };
    return event;
  }

  if (record.kind === 'INBOUND_MESSAGE') {
    const providerMessageId = asString(record.providerMessageId);
    const from = asString(record.from);
    if (!providerMessageId || !from) return null;

    const media = asRecord(record.media);
    const event: InboundMessageEvent = {
      kind: 'INBOUND_MESSAGE',
      eventId,
      metadata,
      providerMessageId,
      from,
      profileName: asString(record.profileName),
      messageType: asString(record.messageType) ?? 'unknown',
      text: asString(record.text),
      media: media
        ? {
            id: asString(media.id),
            mimeType: asString(media.mimeType),
            sha256: asString(media.sha256),
            filename: asString(media.filename),
            caption: asString(media.caption),
          }
        : null,
      timestamp: asDate(record.timestamp),
      raw: record.raw,
    };
    return event;
  }

  return {
    kind: 'UNKNOWN_EVENT',
    eventId,
    metadata,
    description: asString(record.description) ?? 'Evento sem descrição.',
    raw: record.raw,
  };
}
