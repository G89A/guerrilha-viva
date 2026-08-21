import { createHash } from 'node:crypto';

/**
 * Tradução do payload da Meta em eventos internos tipados.
 *
 * Todo parsing de webhook mora aqui: o Route Handler não interpreta nada, e o
 * processador só vê tipos nossos. O payload externo é tratado como hostil —
 * nenhum campo é assumido presente ou do tipo esperado.
 */

export const MAX_WEBHOOK_BYTES = 1024 * 1024; // 1 MB — a Meta manda muito menos

export type ParsedEventKind = 'MESSAGE_STATUS_CHANGED' | 'INBOUND_MESSAGE' | 'UNKNOWN_EVENT';

/** Status de entrega, exatamente os documentados pela Meta. */
export type ProviderMessageStatus = 'sent' | 'delivered' | 'read' | 'failed';

export interface WebhookMetadata {
  /** Identifica o canal — e portanto o workspace. Nunca vem do payload como id interno. */
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  wabaId: string | null;
}

export interface ProviderError {
  code: number | null;
  title: string | null;
  message: string | null;
  details: string | null;
}

export interface StatusEvent {
  kind: 'MESSAGE_STATUS_CHANGED';
  /** Chave determinística de idempotência. */
  eventId: string;
  metadata: WebhookMetadata;
  providerMessageId: string;
  status: ProviderMessageStatus;
  recipientId: string | null;
  timestamp: Date | null;
  errors: ProviderError[];
  raw: unknown;
}

export interface InboundMessageEvent {
  kind: 'INBOUND_MESSAGE';
  eventId: string;
  metadata: WebhookMetadata;
  providerMessageId: string;
  from: string;
  /** Nome do perfil no WhatsApp. Texto de terceiro: nunca usado como HTML. */
  profileName: string | null;
  messageType: string;
  text: string | null;
  media: {
    id: string | null;
    mimeType: string | null;
    sha256: string | null;
    filename: string | null;
    caption: string | null;
  } | null;
  timestamp: Date | null;
  raw: unknown;
}

export interface UnknownEvent {
  kind: 'UNKNOWN_EVENT';
  eventId: string;
  metadata: WebhookMetadata;
  /** Motivo pelo qual não sabemos tratar — vai para o log e para o registro. */
  description: string;
  raw: unknown;
}

export type ParsedEvent = StatusEvent | InboundMessageEvent | UnknownEvent;

export type ParseOutcome =
  | { ok: true; events: ParsedEvent[] }
  | { ok: false; reason: 'INVALID_JSON' | 'NOT_AN_OBJECT' | 'UNSUPPORTED_OBJECT' | 'TOO_LARGE' };

const KNOWN_STATUSES: readonly string[] = ['sent', 'delivered', 'read', 'failed'];

/**
 * O PostgreSQL recusa o byte NUL (`\u0000`) tanto em `text` quanto em `jsonb`.
 * Uma única mensagem contendo esse byte derrubaria o processamento inteiro do
 * webhook — um jeito trivial de negar o serviço. Ele é removido; todo o resto
 * do conteúdo, inclusive unicode invisível, é preservado como veio.
 */
export function stripNullBytes(value: string): string {
  return value.includes('\u0000') ? value.replaceAll('\u0000', '') : value;
}

/** Aplica a limpeza recursivamente ao fragmento cru antes de persistir. */
export function sanitizeForStorage(value: unknown): unknown {
  if (typeof value === 'string') return stripNullBytes(value);
  if (Array.isArray(value)) return value.map(sanitizeForStorage);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        stripNullBytes(key),
        sanitizeForStorage(entry),
      ]),
    );
  }
  return value;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const cleaned = stripNullBytes(value);
  return cleaned.length > 0 ? cleaned : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Timestamps da Meta vêm em segundos, como string. */
function parseTimestamp(value: unknown): Date | null {
  const raw = typeof value === 'number' ? String(value) : asString(value);
  if (!raw) return null;

  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;

  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex').slice(0, 32);
}

function parseMetadata(value: Record<string, unknown> | null, wabaId: string | null): WebhookMetadata {
  const metadata = asRecord(value?.metadata);
  return {
    phoneNumberId: asString(metadata?.phone_number_id),
    displayPhoneNumber: asString(metadata?.display_phone_number),
    wabaId,
  };
}

function parseErrors(value: unknown): ProviderError[] {
  return asArray(value).flatMap((entry) => {
    const record = asRecord(entry);
    if (!record) return [];
    const data = asRecord(record.error_data);
    return [
      {
        code: typeof record.code === 'number' ? record.code : null,
        title: asString(record.title),
        message: asString(record.message),
        details: asString(data?.details),
      },
    ];
  });
}

/**
 * Quebra o payload em eventos individuais.
 *
 * Cada evento carrega sua própria chave de idempotência:
 *   entrada   → `msg:<wamid>`      (o wamid identifica a mensagem)
 *   status    → `status:<wamid>:<status>` (um estado por mensagem é um fato só)
 *   restante  → `unknown:<hash do fragmento>`
 *
 * Isso é o que permite a unique no banco fazer o trabalho de deduplicação, sem
 * depender de um id de evento que a Meta não fornece.
 */
export function parseWebhookPayload(rawBody: string): ParseOutcome {
  if (rawBody.length > MAX_WEBHOOK_BYTES) return { ok: false, reason: 'TOO_LARGE' };

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { ok: false, reason: 'INVALID_JSON' };
  }

  const root = asRecord(payload);
  if (!root) return { ok: false, reason: 'NOT_AN_OBJECT' };

  const object = asString(root.object);
  if (object !== 'whatsapp_business_account') {
    return { ok: false, reason: 'UNSUPPORTED_OBJECT' };
  }

  const events: ParsedEvent[] = [];

  for (const entry of asArray(root.entry)) {
    const entryRecord = asRecord(entry);
    if (!entryRecord) continue;
    const wabaId = asString(entryRecord.id);

    for (const change of asArray(entryRecord.changes)) {
      const changeRecord = asRecord(change);
      if (!changeRecord) continue;

      const value = asRecord(changeRecord.value);
      const metadata = parseMetadata(value, wabaId);
      const field = asString(changeRecord.field);

      if (field !== 'messages' || !value) {
        events.push({
          kind: 'UNKNOWN_EVENT',
          eventId: `unknown:${fingerprint(change)}`,
          metadata,
          description: field ? `Campo não suportado: ${field}` : 'Alteração sem campo reconhecível',
          raw: sanitizeForStorage(change),
        });
        continue;
      }

      const contactNames = new Map<string, string>();
      for (const contact of asArray(value.contacts)) {
        const record = asRecord(contact);
        const waId = asString(record?.wa_id);
        const name = asString(asRecord(record?.profile)?.name);
        if (waId && name) contactNames.set(waId, name);
      }

      for (const status of asArray(value.statuses)) {
        const parsed = parseStatus(status, metadata);
        if (parsed) events.push(parsed);
      }

      for (const message of asArray(value.messages)) {
        const parsed = parseInboundMessage(message, metadata, contactNames);
        if (parsed) events.push(parsed);
      }

      // Uma alteração de `messages` sem statuses nem messages não é erro —
      // pode ser um campo que ainda não tratamos dentro do mesmo evento.
      const hadPayload =
        asArray(value.statuses).length > 0 || asArray(value.messages).length > 0;
      if (!hadPayload) {
        events.push({
          kind: 'UNKNOWN_EVENT',
          eventId: `unknown:${fingerprint(change)}`,
          metadata,
          description: 'Evento de messages sem statuses nem messages',
          raw: sanitizeForStorage(change),
        });
      }
    }
  }

  return { ok: true, events };
}

function parseStatus(value: unknown, metadata: WebhookMetadata): StatusEvent | UnknownEvent | null {
  const record = asRecord(value);
  if (!record) return null;

  const providerMessageId = asString(record.id);
  const status = asString(record.status)?.toLowerCase();

  if (!providerMessageId || !status) {
    return {
      kind: 'UNKNOWN_EVENT',
      eventId: `unknown:${fingerprint(value)}`,
      metadata,
      description: 'Status sem id de mensagem ou sem status',
      raw: sanitizeForStorage(value),
    };
  }

  if (!KNOWN_STATUSES.includes(status)) {
    // Um status novo da Meta é registrado e ignorado, nunca mapeado na força.
    return {
      kind: 'UNKNOWN_EVENT',
      eventId: `unknown:status:${providerMessageId}:${status}`,
      metadata,
      description: `Status não suportado: ${status}`,
      raw: sanitizeForStorage(value),
    };
  }

  return {
    kind: 'MESSAGE_STATUS_CHANGED',
    eventId: `status:${providerMessageId}:${status}`,
    metadata,
    providerMessageId,
    status: status as ProviderMessageStatus,
    recipientId: asString(record.recipient_id),
    timestamp: parseTimestamp(record.timestamp),
    errors: parseErrors(record.errors),
    raw: sanitizeForStorage(value),
  };
}

/** Tipos de mídia cujos metadados sabemos extrair. */
const MEDIA_TYPES = ['image', 'video', 'audio', 'document', 'sticker'] as const;

function parseInboundMessage(
  value: unknown,
  metadata: WebhookMetadata,
  contactNames: Map<string, string>,
): InboundMessageEvent | UnknownEvent | null {
  const record = asRecord(value);
  if (!record) return null;

  const providerMessageId = asString(record.id);
  const from = asString(record.from);

  if (!providerMessageId || !from) {
    return {
      kind: 'UNKNOWN_EVENT',
      eventId: `unknown:${fingerprint(value)}`,
      metadata,
      description: 'Mensagem recebida sem id ou sem remetente',
      raw: sanitizeForStorage(value),
    };
  }

  const messageType = asString(record.type) ?? 'unknown';
  const text = asString(asRecord(record.text)?.body);

  let media: InboundMessageEvent['media'] = null;
  for (const type of MEDIA_TYPES) {
    if (messageType !== type) continue;
    const payload = asRecord(record[type]);
    if (!payload) continue;
    media = {
      id: asString(payload.id),
      mimeType: asString(payload.mime_type),
      sha256: asString(payload.sha256),
      filename: asString(payload.filename),
      caption: asString(payload.caption),
    };
    break;
  }

  return {
    kind: 'INBOUND_MESSAGE',
    eventId: `msg:${providerMessageId}`,
    metadata,
    providerMessageId,
    from,
    profileName: contactNames.get(from) ?? null,
    messageType,
    text,
    media,
    timestamp: parseTimestamp(record.timestamp),
    raw: sanitizeForStorage(value),
  };
}
