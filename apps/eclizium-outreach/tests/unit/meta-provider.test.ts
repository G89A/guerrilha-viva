import { describe, expect, it } from 'vitest';
import {
  extractSendResult,
  MetaWhatsAppProvider,
  parseProviderTemplate,
} from '@/providers/messaging/meta/meta-whatsapp';
import { isProviderError, ProviderError } from '@/providers/messaging/types';
import {
  fakeGraph,
  metaError,
  PHONE_NUMBER_RESPONSE,
  SEND_SUCCESS_RESPONSE,
  templateEntry,
  WABA_RESPONSE,
  type FakeResponse,
} from '../helpers/fake-graph';

function provider(responses: FakeResponse[]) {
  const { fetchImpl, calls } = fakeGraph(responses);
  return {
    calls,
    instance: new MetaWhatsAppProvider({
      accessToken: 'EAAG-token-secreto',
      wabaId: '222222222222222',
      phoneNumberId: '111111111111111',
      graphApiVersion: 'v21.0',
      fetchImpl,
      timeoutMs: 500,
    }),
  };
}

describe('testConnection', () => {
  it('reporta ok quando número, WABA e templates respondem', async () => {
    const { instance } = provider([
      { json: PHONE_NUMBER_RESPONSE },
      { json: WABA_RESPONSE },
      { json: { data: [] } },
    ]);

    const result = await instance.testConnection();

    expect(result.ok).toBe(true);
    expect(result.displayPhoneNumber).toBe('+55 85 99999-0000');
    expect(result.verifiedName).toBe('ECLIZIUM Teste');
    expect(result.qualityRating).toBe('GREEN');
    expect(result.wabaName).toBe('ECLIZIUM WABA');
    expect(result.checks.every((check) => check.ok)).toBe(true);
  });

  it('token inválido reprova a conexão e não segue para as demais chamadas', async () => {
    const { instance, calls } = provider([
      { status: 401, json: metaError('Invalid OAuth access token', 190) },
    ]);

    const result = await instance.testConnection();

    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.name === 'token')?.ok).toBe(false);
    // Falhou na primeira chamada: não insiste contra WABA nem templates.
    expect(calls).toHaveLength(1);
  });

  it('WABA errada reprova apenas a checagem da WABA', async () => {
    const { instance } = provider([
      { json: PHONE_NUMBER_RESPONSE },
      { status: 404, json: metaError('Unsupported get request', 803) },
      { json: { data: [] } },
    ]);

    const result = await instance.testConnection();

    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.name === 'phone_number')?.ok).toBe(true);
    expect(result.checks.find((check) => check.name === 'waba')?.ok).toBe(false);
  });

  it('permissão faltando é reportada com o nome da permissão', async () => {
    const { instance } = provider([
      { json: PHONE_NUMBER_RESPONSE },
      { json: WABA_RESPONSE },
      { status: 403, json: metaError('Permissions error', 200) },
    ]);

    const result = await instance.testConnection();
    const check = result.checks.find((item) => item.name === 'templates_permission');

    expect(result.ok).toBe(false);
    expect(check?.ok).toBe(false);
    expect(check?.detail).toContain('whatsapp_business_management');
  });

  it('timeout não derruba a verificação com stack trace', async () => {
    const { instance } = provider([{ hang: true }]);
    const result = await instance.testConnection();

    expect(result.ok).toBe(false);
    // A mensagem exibida é nossa, não o texto cru do transporte.
    expect(result.checks.some((check) => /não respondeu a tempo/.test(check.detail))).toBe(true);
    expect(result.checks.every((check) => !/AbortError|stack/i.test(check.detail))).toBe(true);
  });
});

describe('getTemplates', () => {
  it('normaliza header, body, footer e botões', async () => {
    const { instance } = provider([{ json: { data: [templateEntry()] } }]);
    const [template] = await instance.getTemplates();

    expect(template).toBeDefined();
    expect(template?.name).toBe('boas_vindas');
    expect(template?.language).toBe('pt_BR');
    expect(template?.status).toBe('APPROVED');
    expect(template?.headerFormat).toBe('TEXT');
    expect(template?.headerText).toBe('Olá {{1}}');
    expect(template?.body).toContain('{{2}}');
    expect(template?.footerText).toBe('ECLIZIUM');
    expect(template?.buttons).toHaveLength(2);
    expect(template?.buttons[1]).toMatchObject({ type: 'URL', url: 'https://example.test' });
    expect(template?.qualityScore).toBe('GREEN');
  });

  it('segue a paginação por cursor até o fim', async () => {
    const { instance, calls } = provider([
      {
        json: {
          data: [templateEntry({ id: 'tpl_1', name: 'a' })],
          paging: { next: 'https://graph.facebook.com/next', cursors: { after: 'CURSOR_1' } },
        },
      },
      {
        json: {
          data: [templateEntry({ id: 'tpl_2', name: 'b' })],
          paging: { next: 'https://graph.facebook.com/next', cursors: { after: 'CURSOR_2' } },
        },
      },
      { json: { data: [templateEntry({ id: 'tpl_3', name: 'c' })] } },
    ]);

    const templates = await instance.getTemplates();

    expect(templates.map((template) => template.name)).toEqual(['a', 'b', 'c']);
    expect(calls).toHaveLength(3);
    expect(calls[1]?.url).toContain('after=CURSOR_1');
    expect(calls[2]?.url).toContain('after=CURSOR_2');
  });

  it('para quando não há cursor, mesmo com next presente', async () => {
    const { instance, calls } = provider([
      { json: { data: [templateEntry()], paging: { next: 'https://x' } } },
    ]);

    await instance.getTemplates();
    expect(calls).toHaveLength(1);
  });

  it('ignora entradas malformadas sem quebrar a lista', async () => {
    const { instance } = provider([
      { json: { data: [null, 'texto', {}, { name: 'sem_idioma' }, templateEntry()] } },
    ]);

    const templates = await instance.getTemplates();
    expect(templates).toHaveLength(1);
  });

  it('devolve lista vazia quando data não é array', async () => {
    const { instance } = provider([{ json: { data: 'nada disso' } }]);
    await expect(instance.getTemplates()).resolves.toEqual([]);
  });

  it('propaga erro de permissão em vez de devolver lista vazia', async () => {
    const { instance } = provider([{ status: 403, json: metaError('Permissions error', 200) }]);
    const error = await instance.getTemplates().catch((caught: unknown) => caught);
    expect(isProviderError(error) && error.kind).toBe('PERMISSION');
  });
});

describe('sendTemplate', () => {
  it('usa o endpoint oficial com messaging_product whatsapp', async () => {
    const { instance, calls } = provider([{ json: SEND_SUCCESS_RESPONSE }]);

    await instance.sendTemplate({
      toPhoneE164: '+5585999990000',
      templateName: 'boas_vindas',
      languageCode: 'pt_BR',
      bodyParameters: ['Ana', '10/09'],
    });

    expect(calls[0]?.url).toBe('https://graph.facebook.com/v21.0/111111111111111/messages');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.body).toMatchObject({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '5585999990000',
      type: 'template',
      template: {
        name: 'boas_vindas',
        language: { code: 'pt_BR' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'Ana' }, { type: 'text', text: '10/09' }] }],
      },
    });
  });

  it('extrai o wamid da resposta', async () => {
    const { instance } = provider([{ json: SEND_SUCCESS_RESPONSE }]);
    const result = await instance.sendTemplate({
      toPhoneE164: '+5585999990000',
      templateName: 'boas_vindas',
      languageCode: 'pt_BR',
      bodyParameters: [],
    });

    expect(result.providerMessageId).toBe('wamid.HBgNNTU4NTk5OTk5MDAwMBUCABEYEjZDN0EyRTM=');
    expect(result.providerContactId).toBe('5585999990000');
  });

  it('omite components quando não há variáveis', async () => {
    const { instance, calls } = provider([{ json: SEND_SUCCESS_RESPONSE }]);
    await instance.sendTemplate({
      toPhoneE164: '+5585999990000',
      templateName: 'sem_variaveis',
      languageCode: 'pt_BR',
      bodyParameters: [],
    });

    const body = calls[0]?.body as { template: Record<string, unknown> };
    expect(body.template.components).toBeUndefined();
  });

  it('inclui parâmetros de header quando informados', async () => {
    const { instance, calls } = provider([{ json: SEND_SUCCESS_RESPONSE }]);
    await instance.sendTemplate({
      toPhoneE164: '+5585999990000',
      templateName: 'com_header',
      languageCode: 'pt_BR',
      bodyParameters: ['b1'],
      headerParameters: ['h1'],
    });

    const body = calls[0]?.body as { template: { components: Array<{ type: string }> } };
    expect(body.template.components[0]?.type).toBe('header');
    expect(body.template.components[1]?.type).toBe('body');
  });

  it('propaga falha de envio como ProviderError classificado', async () => {
    const { instance } = provider([
      { status: 400, json: metaError('Template name does not exist', 132001) },
    ]);

    const error = await instance
      .sendTemplate({
        toPhoneE164: '+5585999990000',
        templateName: 'inexistente',
        languageCode: 'pt_BR',
        bodyParameters: [],
      })
      .catch((caught: unknown) => caught);

    expect(isProviderError(error)).toBe(true);
    expect(isProviderError(error) && error.retryable).toBe(false);
  });
});

describe('extractSendResult', () => {
  it('extrai wamid e wa_id', () => {
    expect(extractSendResult({ messages: [{ id: 'wamid.TEST' }] }).providerMessageId).toBe(
      'wamid.TEST',
    );
  });

  it.each([
    ['sem messages', {}],
    ['messages vazio', { messages: [] }],
    ['messages não array', { messages: 'x' }],
    ['sem id', { messages: [{}] }],
    ['id vazio', { messages: [{ id: '' }] }],
    ['null', null],
  ])('recusa resposta %s em vez de inventar um id', (_label, response) => {
    expect(() => extractSendResult(response)).toThrow(ProviderError);
  });

  it('aceita ausência de contacts', () => {
    expect(extractSendResult({ messages: [{ id: 'wamid.X' }] }).providerContactId).toBeNull();
  });
});

describe('parseProviderTemplate', () => {
  it('devolve null sem nome ou idioma', () => {
    expect(parseProviderTemplate({ name: 'x' })).toBeNull();
    expect(parseProviderTemplate({ language: 'pt_BR' })).toBeNull();
    expect(parseProviderTemplate(null)).toBeNull();
  });

  it('aceita template sem componentes', () => {
    const template = parseProviderTemplate({ name: 'x', language: 'pt_BR' });
    expect(template?.body).toBe('');
    expect(template?.buttons).toEqual([]);
  });

  it('aceita quality_score como string simples', () => {
    const template = parseProviderTemplate({ name: 'x', language: 'pt_BR', quality_score: 'YELLOW' });
    expect(template?.qualityScore).toBe('YELLOW');
  });

  it('preserva status desconhecido em vez de descartar', () => {
    const template = parseProviderTemplate(templateEntry({ status: 'ESTADO_NOVO_DA_META' }));
    expect(template?.status).toBe('ESTADO_NOVO_DA_META');
  });
});
