import { describe, expect, it } from 'vitest';
import {
  buildMetaGraphUrl,
  classifyMetaFailure,
  MetaGraphClient,
  parseMetaError,
} from '@/providers/messaging/meta/graph-client';
import { isProviderError, ProviderError } from '@/providers/messaging/types';
import { fakeGraph, metaError } from '../helpers/fake-graph';

function client(fetchImpl: ReturnType<typeof fakeGraph>['fetchImpl'], timeoutMs?: number) {
  return new MetaGraphClient({
    accessToken: 'EAAG-token-secreto',
    graphApiVersion: 'v21.0',
    fetchImpl,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

describe('buildMetaGraphUrl', () => {
  it('monta a URL com host, versão e caminho', () => {
    expect(buildMetaGraphUrl('v21.0', '123/messages')).toBe(
      'https://graph.facebook.com/v21.0/123/messages',
    );
  });

  it('aceita caminho com barra inicial', () => {
    expect(buildMetaGraphUrl('v21.0', '/123')).toBe('https://graph.facebook.com/v21.0/123');
  });

  it('usa a versão informada, sem constante fixa', () => {
    expect(buildMetaGraphUrl('v19.0', '123')).toContain('/v19.0/');
    expect(buildMetaGraphUrl('v23.0', '123')).toContain('/v23.0/');
  });

  it('anexa query e ignora valores indefinidos', () => {
    const url = buildMetaGraphUrl('v21.0', '123', { limit: 10, after: undefined, fields: 'id,name' });
    expect(url).toContain('limit=10');
    expect(url).toContain('fields=id%2Cname');
    expect(url).not.toContain('after');
  });

  it.each(['21.0', 'v21', 'latest', '', 'v21.0/../evil'])(
    'recusa versão inválida %j',
    (version) => {
      expect(() => buildMetaGraphUrl(version, '123')).toThrow(ProviderError);
    },
  );
});

describe('parseMetaError', () => {
  it('extrai código, subcódigo, tipo e fbtrace_id', () => {
    const detail = parseMetaError(metaError('Invalid OAuth token', 190, { error_subcode: 463 }));
    expect(detail).toMatchObject({
      message: 'Invalid OAuth token',
      code: 190,
      subcode: 463,
      type: 'OAuthException',
      fbtraceId: 'A1bC2dE3fG4',
    });
  });

  it.each([
    ['null', null],
    ['string', 'erro'],
    ['objeto sem error', { ok: true }],
    ['error não objeto', { error: 'boom' }],
  ])('devolve null para payload %s', (_label, payload) => {
    expect(parseMetaError(payload)).toBeNull();
  });

  it('sobrevive a campos com tipo inesperado', () => {
    const detail = parseMetaError({ error: { message: 42, code: 'x', fbtrace_id: [] } });
    expect(detail?.message).toBe('Erro não descrito pelo provedor.');
    expect(detail?.code).toBeUndefined();
  });
});

describe('classifyMetaFailure', () => {
  it.each([
    [190, 'AUTHENTICATION'],
    [200, 'PERMISSION'],
    [10, 'PERMISSION'],
    [4, 'RATE_LIMITED'],
    [130429, 'RATE_LIMITED'],
    [803, 'NOT_FOUND'],
    [100, 'INVALID_REQUEST'],
  ])('classifica o código %i da Meta como %s', (code, expected) => {
    expect(classifyMetaFailure(400, { message: 'x', code })).toBe(expected);
  });

  it.each([
    [401, 'AUTHENTICATION'],
    [403, 'PERMISSION'],
    [404, 'NOT_FOUND'],
    [429, 'RATE_LIMITED'],
    [500, 'PROVIDER_UNAVAILABLE'],
    [503, 'PROVIDER_UNAVAILABLE'],
    [422, 'INVALID_REQUEST'],
  ])('usa o status HTTP %i quando não há código', (status, expected) => {
    expect(classifyMetaFailure(status, null)).toBe(expected);
  });
});

describe('MetaGraphClient', () => {
  it('envia o token como Bearer e pede JSON', async () => {
    const { fetchImpl, calls } = fakeGraph([{ json: { id: '1' } }]);
    await client(fetchImpl).request({ method: 'GET', path: '1', operation: 'test' });

    expect(calls[0]?.headers.authorization).toBe('Bearer EAAG-token-secreto');
    expect(calls[0]?.headers.accept).toBe('application/json');
  });

  it('serializa o corpo em POST', async () => {
    const { fetchImpl, calls } = fakeGraph([{ json: {} }]);
    await client(fetchImpl).request({
      method: 'POST',
      path: '1/messages',
      operation: 'test',
      body: { messaging_product: 'whatsapp' },
    });

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.body).toEqual({ messaging_product: 'whatsapp' });
  });

  it('devolve o payload em caso de sucesso', async () => {
    const { fetchImpl } = fakeGraph([{ json: { id: '42', name: 'ok' } }]);
    const result = await client(fetchImpl).request<{ id: string }>({
      method: 'GET',
      path: '42',
      operation: 'test',
    });
    expect(result.id).toBe('42');
  });

  it('traduz token inválido em AUTHENTICATION, não retentável', async () => {
    const { fetchImpl } = fakeGraph([{ status: 401, json: metaError('Invalid OAuth token', 190) }]);
    const error = await client(fetchImpl)
      .request({ method: 'GET', path: '1', operation: 'test' })
      .catch((caught: unknown) => caught);

    expect(isProviderError(error)).toBe(true);
    if (!isProviderError(error)) return;
    expect(error.kind).toBe('AUTHENTICATION');
    expect(error.retryable).toBe(false);
    expect(error.detail?.fbtraceId).toBe('A1bC2dE3fG4');
  });

  it('traduz permissão negada em PERMISSION, não retentável', async () => {
    const { fetchImpl } = fakeGraph([
      { status: 403, json: metaError('Permissions error', 200) },
    ]);
    const error = await client(fetchImpl)
      .request({ method: 'GET', path: '1', operation: 'test' })
      .catch((caught: unknown) => caught);

    expect(isProviderError(error) && error.kind).toBe('PERMISSION');
    expect(isProviderError(error) && error.retryable).toBe(false);
  });

  it('marca 429 e 5xx como retentáveis', async () => {
    for (const [status, code] of [
      [429, 4],
      [500, 0],
      [503, 0],
    ] as const) {
      const { fetchImpl } = fakeGraph([
        { status, json: code ? metaError('slow down', code) : { error: { message: 'boom' } } },
      ]);
      const error = await client(fetchImpl)
        .request({ method: 'GET', path: '1', operation: 'test' })
        .catch((caught: unknown) => caught);

      expect(isProviderError(error) && error.retryable, `status ${status}`).toBe(true);
    }
  });

  it('aborta e reporta TIMEOUT quando o provedor não responde', async () => {
    const { fetchImpl } = fakeGraph([{ hang: true }]);
    const error = await client(fetchImpl, 50)
      .request({ method: 'GET', path: '1', operation: 'test' })
      .catch((caught: unknown) => caught);

    expect(isProviderError(error) && error.kind).toBe('TIMEOUT');
    expect(isProviderError(error) && error.retryable).toBe(true);
  });

  it('reporta NETWORK quando o transporte falha', async () => {
    const { fetchImpl } = fakeGraph([{ throws: new Error('ECONNREFUSED') }]);
    const error = await client(fetchImpl)
      .request({ method: 'GET', path: '1', operation: 'test' })
      .catch((caught: unknown) => caught);

    expect(isProviderError(error) && error.kind).toBe('NETWORK');
  });

  it('reporta MALFORMED_RESPONSE para corpo que não é JSON', async () => {
    const { fetchImpl } = fakeGraph([{ raw: '<html>502 Bad Gateway</html>' }]);
    const error = await client(fetchImpl)
      .request({ method: 'GET', path: '1', operation: 'test' })
      .catch((caught: unknown) => caught);

    expect(isProviderError(error) && error.kind).toBe('MALFORMED_RESPONSE');
    expect(isProviderError(error) && error.retryable).toBe(false);
  });

  it('nunca inclui o token na mensagem de erro', async () => {
    const { fetchImpl } = fakeGraph([{ status: 401, json: metaError('Invalid token', 190) }]);
    const error = await client(fetchImpl)
      .request({ method: 'GET', path: '1', operation: 'test' })
      .catch((caught: unknown) => caught);

    expect(JSON.stringify(isProviderError(error) ? error.detail : {})).not.toContain('EAAG');
    expect(String(error)).not.toContain('EAAG-token-secreto');
  });

  it('recusa ser construído sem token', () => {
    expect(
      () => new MetaGraphClient({ accessToken: '', graphApiVersion: 'v21.0' }),
    ).toThrow(ProviderError);
  });
});
