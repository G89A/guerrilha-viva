import type { FetchLike } from '@/providers/messaging/meta/graph-client';

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface FakeResponse {
  status?: number;
  json?: unknown;
  /** Corpo cru, para simular resposta não-JSON. */
  raw?: string;
  /** Lança este erro em vez de responder (rede caída, abort). */
  throws?: Error;
  /** Nunca resolve — usado com timeout curto para exercitar o AbortController. */
  hang?: boolean;
}

/**
 * Transporte falso, INJETADO no cliente. O `fetch` global nunca é substituído,
 * então nenhum mock pode escapar para produção: o código de produção sempre usa
 * `globalThis.fetch`, e só o teste passa outra coisa.
 */
export function fakeGraph(responses: FakeResponse[]): {
  fetchImpl: FetchLike;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let index = 0;

  const fetchImpl: FetchLike = async (url, init) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({
      url,
      method: init.method ?? 'GET',
      headers,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
    });

    const spec = responses[Math.min(index, responses.length - 1)] ?? { status: 200, json: {} };
    index += 1;

    if (spec.throws) throw spec.throws;

    if (spec.hang) {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init.signal;
        signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    }

    const body = spec.raw ?? JSON.stringify(spec.json ?? {});
    return new Response(body, {
      status: spec.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  return { fetchImpl, calls };
}

export const PHONE_NUMBER_RESPONSE = {
  id: '111111111111111',
  display_phone_number: '+55 85 99999-0000',
  verified_name: 'ECLIZIUM Teste',
  quality_rating: 'GREEN',
};

export const WABA_RESPONSE = { id: '222222222222222', name: 'ECLIZIUM WABA' };

export function templateEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tpl_1',
    name: 'boas_vindas',
    language: 'pt_BR',
    status: 'APPROVED',
    category: 'MARKETING',
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'Olá {{1}}' },
      { type: 'BODY', text: 'Sua consulta com {{1}} está marcada para {{2}}.' },
      { type: 'FOOTER', text: 'ECLIZIUM' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Confirmar' },
          { type: 'URL', text: 'Abrir', url: 'https://example.test' },
        ],
      },
    ],
    quality_score: { score: 'GREEN' },
    ...overrides,
  };
}

export const SEND_SUCCESS_RESPONSE = {
  messaging_product: 'whatsapp',
  contacts: [{ input: '5585999990000', wa_id: '5585999990000' }],
  messages: [{ id: 'wamid.HBgNNTU4NTk5OTk5MDAwMBUCABEYEjZDN0EyRTM=' }],
};

export function metaError(
  message: string,
  code: number,
  extra: Record<string, unknown> = {},
): unknown {
  return {
    error: {
      message,
      type: 'OAuthException',
      code,
      fbtrace_id: 'A1bC2dE3fG4',
      ...extra,
    },
  };
}
