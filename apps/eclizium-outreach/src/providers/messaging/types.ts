/**
 * Contrato de provider de mensageria.
 *
 * A camada de aplicação fala com esta interface, nunca com a Meta diretamente.
 * Trocar de provider, ou acrescentar um segundo, não deve exigir mudança nos
 * serviços de domínio.
 */

export type ProviderName = 'META';

// ---------------------------------------------------------------------------
// Erros
// ---------------------------------------------------------------------------

/** Erro estruturado devolvido pela Graph API, já normalizado. */
export interface ProviderErrorDetail {
  code?: number;
  subcode?: number;
  type?: string;
  message: string;
  fbtraceId?: string;
}

export type ProviderErrorKind =
  | 'AUTHENTICATION'
  | 'PERMISSION'
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'MALFORMED_RESPONSE'
  | 'UNKNOWN';

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly httpStatus: number | null;
  readonly detail: ProviderErrorDetail | null;
  /**
   * Se faz sentido tentar de novo. Credencial inválida, payload inválido e
   * permissão negada NUNCA são retentáveis — repetir só gasta cota e piora a
   * reputação do número.
   */
  readonly retryable: boolean;

  constructor(
    kind: ProviderErrorKind,
    message: string,
    options: {
      httpStatus?: number | null;
      detail?: ProviderErrorDetail | null;
      retryable?: boolean;
    } = {},
  ) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.httpStatus = options.httpStatus ?? null;
    this.detail = options.detail ?? null;
    this.retryable = options.retryable ?? DEFAULT_RETRYABLE[kind];
  }
}

const DEFAULT_RETRYABLE: Record<ProviderErrorKind, boolean> = {
  AUTHENTICATION: false,
  PERMISSION: false,
  INVALID_REQUEST: false,
  NOT_FOUND: false,
  RATE_LIMITED: true,
  PROVIDER_UNAVAILABLE: true,
  TIMEOUT: true,
  NETWORK: true,
  MALFORMED_RESPONSE: false,
  UNKNOWN: false,
};

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}

// ---------------------------------------------------------------------------
// Conexão
// ---------------------------------------------------------------------------

export interface ProviderConnectionResult {
  ok: boolean;
  /** Dados do número, quando acessível. */
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  /** Nome da conta de negócio (WABA), quando acessível. */
  wabaName: string | null;
  /** Verificações individuais, para a UI dizer o que exatamente falhou. */
  checks: ProviderCheck[];
}

export interface ProviderCheck {
  name: 'token' | 'waba' | 'phone_number' | 'templates_permission';
  ok: boolean;
  detail: string;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export interface ProviderTemplateButton {
  type: string;
  text: string | null;
  url: string | null;
  phoneNumber: string | null;
}

export interface ProviderTemplate {
  providerTemplateId: string | null;
  name: string;
  language: string;
  /** Valores brutos, exatamente como vieram. A normalização é da aplicação. */
  status: string | null;
  category: string | null;
  headerFormat: string | null;
  headerText: string | null;
  body: string;
  footerText: string | null;
  buttons: ProviderTemplateButton[];
  components: unknown[];
  qualityScore: string | null;
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

export interface SendTemplateInput {
  toPhoneE164: string;
  templateName: string;
  languageCode: string;
  /** Parâmetros posicionais do corpo, na ordem de {{1}}, {{2}}, … */
  bodyParameters: string[];
  headerParameters?: string[];
}

export interface SendTextInput {
  toPhoneE164: string;
  text: string;
}

export interface SendMessageResult {
  /** `wamid.…` devolvido pela Meta. Nunca inventado. */
  providerMessageId: string;
  /** Telefone como a Meta normalizou, quando informado. */
  providerContactId: string | null;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/** Binário de mídia recebida, buscado sob demanda. Nunca é armazenado. */
export interface ProviderMedia {
  bytes: Uint8Array;
  mimeType: string | null;
  sizeBytes: number;
}

export interface MessagingProvider {
  readonly name: ProviderName;
  testConnection(): Promise<ProviderConnectionResult>;
  getTemplates(): Promise<ProviderTemplate[]>;
  sendTemplate(input: SendTemplateInput): Promise<SendMessageResult>;
  sendText?(input: SendTextInput): Promise<SendMessageResult>;
  /** Confirma ao provedor que a mensagem do contato foi lida pela equipe. */
  markRead?(providerMessageId: string): Promise<void>;
  /** Busca o binário de uma mídia recebida. O provedor é a única fonte. */
  fetchMedia?(mediaId: string, maxBytes: number): Promise<ProviderMedia>;
}
