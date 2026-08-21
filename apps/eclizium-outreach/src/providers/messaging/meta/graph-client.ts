import { ProviderError, type ProviderErrorDetail, type ProviderErrorKind } from '@/providers/messaging/types';
import { logger } from '@/lib/logging/logger';

/**
 * Cliente HTTP único para a Graph API da Meta.
 *
 * Todo acesso à Meta passa por aqui: base URL, versão, autenticação, timeout,
 * parsing e tradução de erro moram em um lugar só. Nenhum outro arquivo pode
 * conter `graph.facebook.com`.
 */

export const META_GRAPH_HOST = 'https://graph.facebook.com';

/**
 * 20 segundos. A Cloud API costuma responder em centenas de milissegundos;
 * 20s cobre uma cauda ruim sem prender um handler de Server Action por tempo
 * suficiente para o usuário achar que travou. Sincronização de templates com
 * paginação usa o mesmo teto por página, não pelo total.
 */
export const DEFAULT_TIMEOUT_MS = 20_000;

/** Versão aceita apenas no formato `vNN.N`, para não montar URL inválida. */
const VERSION_PATTERN = /^v\d+\.\d+$/;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface MetaGraphClientOptions {
  accessToken: string;
  graphApiVersion: string;
  timeoutMs?: number;
  /** Injetável para teste. Em produção é sempre o `fetch` global. */
  fetchImpl?: FetchLike;
  /** Contexto de log; nunca contém credencial. */
  logContext?: Record<string, unknown>;
}

export interface GraphRequest {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Categoria usada em log e métrica, sem identificadores. */
  operation: string;
}

/**
 * Monta a URL da Graph API. Função central: a versão vem da configuração do
 * canal, nunca de uma constante espalhada pelo código.
 */
export function buildMetaGraphUrl(
  version: string,
  path: string,
  query: Record<string, string | number | undefined> = {},
): string {
  if (!VERSION_PATTERN.test(version)) {
    throw new ProviderError('INVALID_REQUEST', `Versão da Graph API inválida: ${version}`);
  }

  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  const url = new URL(`${META_GRAPH_HOST}/${version}/${normalizedPath}`);

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  return url.toString();
}

interface MetaErrorEnvelope {
  error?: {
    message?: unknown;
    type?: unknown;
    code?: unknown;
    error_subcode?: unknown;
    fbtrace_id?: unknown;
  };
}

/** Traduz o corpo de erro da Meta para a forma interna, sem confiar em nada. */
export function parseMetaError(payload: unknown): ProviderErrorDetail | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const envelope = (payload as MetaErrorEnvelope).error;
  if (typeof envelope !== 'object' || envelope === null) return null;

  const detail: ProviderErrorDetail = {
    message:
      typeof envelope.message === 'string' && envelope.message.length > 0
        ? envelope.message
        : 'Erro não descrito pelo provedor.',
  };

  if (typeof envelope.code === 'number') detail.code = envelope.code;
  if (typeof envelope.error_subcode === 'number') detail.subcode = envelope.error_subcode;
  if (typeof envelope.type === 'string') detail.type = envelope.type;
  if (typeof envelope.fbtrace_id === 'string') detail.fbtraceId = envelope.fbtrace_id;

  return detail;
}

/**
 * Classifica a falha a partir do status HTTP e do código da Meta.
 *
 * Códigos relevantes: 190 = token inválido/expirado; 200/10 = permissão;
 * 4/80007/130429 = limite de taxa; 100 = parâmetro inválido; 803 = objeto
 * inexistente. O que não for reconhecido cai em UNKNOWN e NÃO é retentável.
 */
export function classifyMetaFailure(
  httpStatus: number,
  detail: ProviderErrorDetail | null,
): ProviderErrorKind {
  const code = detail?.code;

  if (code === 190) return 'AUTHENTICATION';
  if (code === 200 || code === 10 || code === 299) return 'PERMISSION';
  if (code === 4 || code === 80007 || code === 130429 || code === 131048) return 'RATE_LIMITED';
  if (code === 803) return 'NOT_FOUND';
  if (code === 100) return 'INVALID_REQUEST';

  if (httpStatus === 401) return 'AUTHENTICATION';
  if (httpStatus === 403) return 'PERMISSION';
  if (httpStatus === 404) return 'NOT_FOUND';
  if (httpStatus === 429) return 'RATE_LIMITED';
  if (httpStatus >= 500) return 'PROVIDER_UNAVAILABLE';
  if (httpStatus >= 400) return 'INVALID_REQUEST';

  return 'UNKNOWN';
}

export class MetaGraphClient {
  private readonly accessToken: string;
  private readonly version: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly logContext: Record<string, unknown>;

  constructor(options: MetaGraphClientOptions) {
    if (!options.accessToken) {
      throw new ProviderError('AUTHENTICATION', 'Access token ausente.');
    }
    this.accessToken = options.accessToken;
    this.version = options.graphApiVersion;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    // `globalThis.fetch` é resolvido na chamada, não na importação: assim o
    // build nunca depende de rede e o teste injeta seu próprio transporte.
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.logContext = options.logContext ?? {};
  }

  /**
   * Baixa um binário de uma URL absoluta da Meta (mídia).
   *
   * Separado de `request` de propósito: a resposta não é JSON, e tentar
   * interpretá-la como tal transformaria um arquivo válido em erro. O token vai
   * no header e nunca na URL — a URL de mídia da Meta é temporária e pode
   * aparecer em log de proxy.
   */
  async fetchBinary(
    url: string,
    options: { maxBytes: number; operation: string },
  ): Promise<{ bytes: Uint8Array; contentType: string | null }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = Date.now();

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        signal: controller.signal,
        headers: { authorization: `Bearer ${this.accessToken}` },
      });
    } catch (error) {
      clearTimeout(timer);
      const aborted = error instanceof Error && error.name === 'AbortError';
      const kind: ProviderErrorKind = aborted ? 'TIMEOUT' : 'NETWORK';
      this.log(options.operation, { result: 'error', kind, durationMs: Date.now() - startedAt });
      throw new ProviderError(
        kind,
        aborted ? 'Tempo esgotado ao baixar a mídia.' : 'Falha de rede ao baixar a mídia.',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const kind = classifyMetaFailure(response.status, null);
      this.log(options.operation, {
        result: 'error',
        kind,
        httpStatus: response.status,
        durationMs: Date.now() - startedAt,
      });
      throw new ProviderError(kind, `Provedor respondeu ${response.status} ao baixar a mídia.`, {
        httpStatus: response.status,
      });
    }

    const buffer = await response.arrayBuffer();

    // Teto aplicado depois de ler porque `content-length` é informado pelo
    // outro lado e não é confiável. Recusar é melhor que servir um arquivo que
    // estoura a memória do processo.
    if (buffer.byteLength > options.maxBytes) {
      throw new ProviderError('INVALID_REQUEST', 'Mídia maior que o limite suportado.', {
        httpStatus: response.status,
      });
    }

    this.log(options.operation, {
      result: 'ok',
      httpStatus: response.status,
      bytes: buffer.byteLength,
      durationMs: Date.now() - startedAt,
    });

    return {
      bytes: new Uint8Array(buffer),
      contentType: response.headers.get('content-type'),
    };
  }

  async request<T>(request: GraphRequest): Promise<T> {
    const url = buildMetaGraphUrl(this.version, request.path, request.query ?? {});
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = Date.now();

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: request.method,
        signal: controller.signal,
        headers: {
          // O token vive apenas neste header, montado no momento da chamada.
          authorization: `Bearer ${this.accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      });
    } catch (error) {
      clearTimeout(timer);
      const aborted = error instanceof Error && error.name === 'AbortError';
      const kind: ProviderErrorKind = aborted ? 'TIMEOUT' : 'NETWORK';

      this.log(request.operation, {
        result: 'error',
        kind,
        durationMs: Date.now() - startedAt,
      });

      throw new ProviderError(
        kind,
        aborted
          ? `Tempo esgotado ao falar com o provedor (${this.timeoutMs} ms).`
          : 'Falha de rede ao falar com o provedor.',
      );
    } finally {
      clearTimeout(timer);
    }

    const durationMs = Date.now() - startedAt;
    const raw = await response.text();

    let payload: unknown = null;
    if (raw.length > 0) {
      try {
        payload = JSON.parse(raw);
      } catch {
        this.log(request.operation, {
          result: 'error',
          kind: 'MALFORMED_RESPONSE',
          httpStatus: response.status,
          durationMs,
        });
        // Corpo ilegível com status de ERRO é quase sempre página de gateway
        // (502/503 em HTML): a requisição não chegou a ser processada, então
        // vale tentar de novo.
        //
        // Corpo ilegível com status de SUCESSO é outra história: a mensagem
        // pode ter sido enviada e apenas a resposta veio corrompida. Retentar
        // arriscaria mandar a mesma mensagem duas vezes para uma pessoa real,
        // então esse caso NÃO é retentável.
        throw new ProviderError('MALFORMED_RESPONSE', 'Resposta do provedor não é JSON válido.', {
          httpStatus: response.status,
          retryable: !response.ok,
        });
      }
    }

    if (!response.ok) {
      const detail = parseMetaError(payload);
      const kind = classifyMetaFailure(response.status, detail);

      this.log(request.operation, {
        result: 'error',
        kind,
        httpStatus: response.status,
        durationMs,
        // Códigos e fbtrace_id são diagnósticos e não são segredo.
        providerErrorCode: detail?.code ?? null,
        providerErrorSubcode: detail?.subcode ?? null,
        providerRequestId: detail?.fbtraceId ?? null,
      });

      throw new ProviderError(kind, detail?.message ?? `Provedor respondeu ${response.status}.`, {
        httpStatus: response.status,
        detail,
      });
    }

    this.log(request.operation, { result: 'ok', httpStatus: response.status, durationMs });
    return payload as T;
  }

  private log(operation: string, fields: Record<string, unknown>): void {
    // O logger redige chaves sensíveis, mas nada de credencial chega aqui:
    // apenas operação, resultado, duração e diagnóstico do provedor.
    logger.info('provider.meta.request', { provider: 'META', operation, ...this.logContext, ...fields });
  }
}
