import {
  ProviderError,
  type MessagingProvider,
  type ProviderCheck,
  type ProviderConnectionResult,
  type ProviderName,
  type ProviderTemplate,
  type ProviderTemplateButton,
  type SendMessageResult,
  type SendTemplateInput,
  type SendTextInput,
} from '@/providers/messaging/types';
import { MetaGraphClient, type FetchLike } from '@/providers/messaging/meta/graph-client';
import { connectionFailureMessage } from '@/providers/messaging/messages';

/**
 * Implementação da WhatsApp Business Platform — Cloud API oficial da Meta.
 *
 * Somente endpoints oficiais da Graph API. Nenhuma automação de navegador,
 * cliente emulado ou API não oficial é usada, aqui ou em qualquer outro lugar
 * do projeto.
 */

export interface MetaWhatsAppProviderOptions {
  accessToken: string;
  wabaId: string;
  phoneNumberId: string;
  graphApiVersion: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  logContext?: Record<string, unknown>;
}

/** Quantos templates pedir por página. A Meta pagina por cursor. */
const TEMPLATE_PAGE_SIZE = 100;
/** Trava de segurança: mesmo com cursores, nunca girar para sempre. */
const MAX_TEMPLATE_PAGES = 50;

interface PhoneNumberResponse {
  id?: unknown;
  display_phone_number?: unknown;
  verified_name?: unknown;
  quality_rating?: unknown;
}

interface WabaResponse {
  id?: unknown;
  name?: unknown;
}

interface TemplateListResponse {
  data?: unknown;
  paging?: { next?: unknown; cursors?: { after?: unknown } };
}

interface SendResponse {
  messages?: unknown;
  contacts?: unknown;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export class MetaWhatsAppProvider implements MessagingProvider {
  readonly name: ProviderName = 'META';

  private readonly client: MetaGraphClient;
  private readonly wabaId: string;
  private readonly phoneNumberId: string;

  constructor(options: MetaWhatsAppProviderOptions) {
    this.client = new MetaGraphClient({
      accessToken: options.accessToken,
      graphApiVersion: options.graphApiVersion,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      ...(options.logContext === undefined ? {} : { logContext: options.logContext }),
    });
    this.wabaId = options.wabaId;
    this.phoneNumberId = options.phoneNumberId;
  }

  /**
   * Verifica de verdade: consulta o número e a WABA configurados, e tenta
   * listar templates para exercitar a permissão de gestão. "Token presente"
   * nunca é tratado como "integração funcionando".
   */
  async testConnection(): Promise<ProviderConnectionResult> {
    const checks: ProviderCheck[] = [];
    let phone: PhoneNumberResponse | null = null;
    let waba: WabaResponse | null = null;

    try {
      phone = await this.client.request<PhoneNumberResponse>({
        method: 'GET',
        path: this.phoneNumberId,
        query: { fields: 'id,display_phone_number,verified_name,quality_rating' },
        operation: 'phone_number.read',
      });
      checks.push({ name: 'token', ok: true, detail: 'Token aceito pela Graph API.' });
      checks.push({
        name: 'phone_number',
        ok: true,
        detail: asString(phone.display_phone_number) ?? 'Número acessível.',
      });
    } catch (error) {
      const failure = toProviderError(error);
      checks.push({
        name: 'token',
        ok: failure.kind !== 'AUTHENTICATION',
        detail:
          failure.kind === 'AUTHENTICATION'
            ? connectionFailureMessage('AUTHENTICATION')
            : 'Token aceito, mas a chamada falhou.',
      });
      checks.push({
        name: 'phone_number',
        ok: false,
        detail: connectionFailureMessage(failure.kind),
      });

      return {
        ok: false,
        phoneNumberId: null,
        displayPhoneNumber: null,
        verifiedName: null,
        qualityRating: null,
        wabaName: null,
        checks,
      };
    }

    try {
      waba = await this.client.request<WabaResponse>({
        method: 'GET',
        path: this.wabaId,
        query: { fields: 'id,name' },
        operation: 'waba.read',
      });
      checks.push({ name: 'waba', ok: true, detail: asString(waba.name) ?? 'WABA acessível.' });
    } catch (error) {
      checks.push({
        name: 'waba',
        ok: false,
        detail: connectionFailureMessage(toProviderError(error).kind),
      });
    }

    try {
      await this.client.request<TemplateListResponse>({
        method: 'GET',
        path: `${this.wabaId}/message_templates`,
        query: { limit: 1 },
        operation: 'templates.probe',
      });
      checks.push({
        name: 'templates_permission',
        ok: true,
        detail: 'Leitura de templates autorizada.',
      });
    } catch (error) {
      const failure = toProviderError(error);
      checks.push({
        name: 'templates_permission',
        ok: false,
        detail:
          failure.kind === 'PERMISSION'
            ? 'Falta a permissão whatsapp_business_management.'
            : connectionFailureMessage(failure.kind),
      });
    }

    return {
      ok: checks.every((check) => check.ok),
      phoneNumberId: asString(phone.id) ?? this.phoneNumberId,
      displayPhoneNumber: asString(phone.display_phone_number),
      verifiedName: asString(phone.verified_name),
      qualityRating: asString(phone.quality_rating),
      wabaName: waba ? asString(waba.name) : null,
      checks,
    };
  }

  /**
   * Lista todos os templates da WABA, seguindo os cursores de paginação.
   * Não assume que tudo cabe em uma resposta.
   */
  async getTemplates(): Promise<ProviderTemplate[]> {
    const templates: ProviderTemplate[] = [];
    let after: string | undefined;

    for (let page = 0; page < MAX_TEMPLATE_PAGES; page += 1) {
      const response = await this.client.request<TemplateListResponse>({
        method: 'GET',
        path: `${this.wabaId}/message_templates`,
        query: {
          limit: TEMPLATE_PAGE_SIZE,
          fields: 'id,name,language,status,category,components,quality_score',
          ...(after === undefined ? {} : { after }),
        },
        operation: 'templates.list',
      });

      const data = Array.isArray(response.data) ? response.data : [];
      for (const entry of data) {
        const parsed = parseProviderTemplate(entry);
        if (parsed) templates.push(parsed);
      }

      const nextCursor = asString(response.paging?.cursors?.after);
      const hasNext = asString(response.paging?.next) !== null;
      if (!hasNext || !nextCursor || data.length === 0) break;
      after = nextCursor;
    }

    return templates;
  }

  /**
   * `POST /{Phone-Number-ID}/messages` com `messaging_product: whatsapp`.
   * O `wamid` devolvido vem da resposta e nunca é fabricado localmente.
   */
  async sendTemplate(input: SendTemplateInput): Promise<SendMessageResult> {
    const components: unknown[] = [];

    if (input.headerParameters && input.headerParameters.length > 0) {
      components.push({
        type: 'header',
        parameters: input.headerParameters.map((text) => ({ type: 'text', text })),
      });
    }
    if (input.bodyParameters.length > 0) {
      components.push({
        type: 'body',
        parameters: input.bodyParameters.map((text) => ({ type: 'text', text })),
      });
    }

    const response = await this.client.request<SendResponse>({
      method: 'POST',
      path: `${this.phoneNumberId}/messages`,
      operation: 'messages.send_template',
      body: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        // A Meta aceita E.164 sem o '+'; enviar sem ele evita normalização dupla.
        to: input.toPhoneE164.replace(/^\+/, ''),
        type: 'template',
        template: {
          name: input.templateName,
          language: { code: input.languageCode },
          ...(components.length > 0 ? { components } : {}),
        },
      },
    });

    return extractSendResult(response);
  }

  async sendText(input: SendTextInput): Promise<SendMessageResult> {
    const response = await this.client.request<SendResponse>({
      method: 'POST',
      path: `${this.phoneNumberId}/messages`,
      operation: 'messages.send_text',
      body: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: input.toPhoneE164.replace(/^\+/, ''),
        type: 'text',
        text: { preview_url: false, body: input.text },
      },
    });

    return extractSendResult(response);
  }
}

/**
 * Extrai o `wamid`. Uma resposta 200 sem id é tratada como falha: sem o id do
 * provedor não há como reconciliar status depois, e inventar um seria mentir.
 */
export function extractSendResult(response: unknown): SendMessageResult {
  const envelope = response as SendResponse | null;
  const messages = Array.isArray(envelope?.messages) ? envelope.messages : [];
  const first = messages[0];
  const providerMessageId =
    typeof first === 'object' && first !== null ? asString((first as { id?: unknown }).id) : null;

  if (!providerMessageId) {
    throw new ProviderError(
      'MALFORMED_RESPONSE',
      'O provedor respondeu sem identificador de mensagem.',
    );
  }

  const contacts = Array.isArray(envelope?.contacts) ? envelope.contacts : [];
  const firstContact = contacts[0];
  const providerContactId =
    typeof firstContact === 'object' && firstContact !== null
      ? asString((firstContact as { wa_id?: unknown }).wa_id)
      : null;

  return { providerMessageId, providerContactId };
}

/** Converte um componente de template da Meta na forma normalizada. */
export function parseProviderTemplate(entry: unknown): ProviderTemplate | null {
  if (typeof entry !== 'object' || entry === null) return null;

  const record = entry as Record<string, unknown>;
  const name = asString(record.name);
  const language = asString(record.language);
  if (!name || !language) return null;

  const components = Array.isArray(record.components) ? record.components : [];

  let headerFormat: string | null = null;
  let headerText: string | null = null;
  let body = '';
  let footerText: string | null = null;
  const buttons: ProviderTemplateButton[] = [];

  for (const component of components) {
    if (typeof component !== 'object' || component === null) continue;
    const part = component as Record<string, unknown>;
    const type = asString(part.type)?.toUpperCase();

    if (type === 'HEADER') {
      headerFormat = asString(part.format);
      headerText = asString(part.text);
    } else if (type === 'BODY') {
      body = asString(part.text) ?? '';
    } else if (type === 'FOOTER') {
      footerText = asString(part.text);
    } else if (type === 'BUTTONS') {
      const list = Array.isArray(part.buttons) ? part.buttons : [];
      for (const raw of list) {
        if (typeof raw !== 'object' || raw === null) continue;
        const button = raw as Record<string, unknown>;
        buttons.push({
          type: asString(button.type) ?? 'UNKNOWN',
          text: asString(button.text),
          url: asString(button.url),
          phoneNumber: asString(button.phone_number),
        });
      }
    }
  }

  const quality = record.quality_score;
  const qualityScore =
    typeof quality === 'object' && quality !== null
      ? asString((quality as { score?: unknown }).score)
      : asString(quality);

  return {
    providerTemplateId: asString(record.id),
    name,
    language,
    status: asString(record.status),
    category: asString(record.category),
    headerFormat,
    headerText,
    body,
    footerText,
    buttons,
    components,
    qualityScore,
  };
}

function toProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  return new ProviderError('UNKNOWN', 'Falha inesperada ao falar com o provedor.');
}
