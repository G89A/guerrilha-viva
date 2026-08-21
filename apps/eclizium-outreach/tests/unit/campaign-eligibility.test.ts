import { describe, expect, it } from 'vitest';
import {
  ChannelStatus,
  ConsentChannel,
  ConsentStatus,
  ContactStatus,
  MissingVariablePolicy,
  RecipientStatus,
  TemplateAvailability,
  TemplateStatus,
} from '@prisma/client';
import {
  accumulate,
  buildEligibilityContext,
  emptyBreakdown,
  evaluateCampaignRecipientEligibility,
} from '@/features/campaigns/eligibility';
import type { AudienceContact } from '@/features/campaigns/audience-service';

function contact(overrides: Partial<AudienceContact> = {}): AudienceContact {
  return {
    id: 'c1',
    phoneE164: '+5585999990000',
    firstName: 'Ana',
    lastName: 'Souza',
    company: 'Clínica XPTO',
    city: 'Fortaleza',
    segment: 'Saúde',
    status: ContactStatus.ACTIVE,
    consents: [{ channel: ConsentChannel.WHATSAPP, status: ConsentStatus.GRANTED }],
    suppressions: [],
    ...overrides,
  };
}

const CHANNEL = { status: ChannelStatus.CONNECTED } as never;

function template(overrides: Record<string, unknown> = {}) {
  return {
    status: TemplateStatus.APPROVED,
    availability: TemplateAvailability.AVAILABLE,
    body: 'Olá {{1}}, tudo bem?',
    variables: [{ key: '1', component: 'body' }],
    ...overrides,
  } as never;
}

function context(overrides: Parameters<typeof buildEligibilityContext>[0] | null = null) {
  return buildEligibilityContext(
    overrides ?? {
      channel: CHANNEL,
      template: template(),
      mapping: { 'body:1': { source: 'contact.firstName' } },
    },
  );
}

describe('elegível', () => {
  it('consentimento concedido, telefone válido, sem supressão', () => {
    const result = evaluateCampaignRecipientEligibility(contact(), context());

    expect(result.eligible).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.status).toBe(RecipientStatus.ELIGIBLE);
    expect(result.resolved?.bodyParameters).toEqual(['Ana']);
    expect(result.preview).toBe('Olá Ana, tudo bem?');
  });
});

describe('bloqueios por contato', () => {
  it.each([
    ['sem consentimento', { consents: [] }, 'CONSENT_MISSING', RecipientStatus.INELIGIBLE],
    [
      'consentimento desconhecido',
      { consents: [{ channel: ConsentChannel.WHATSAPP, status: ConsentStatus.UNKNOWN }] },
      'CONSENT_MISSING',
      RecipientStatus.INELIGIBLE,
    ],
    [
      'consentimento revogado',
      { consents: [{ channel: ConsentChannel.WHATSAPP, status: ConsentStatus.REVOKED }] },
      'CONSENT_REVOKED',
      RecipientStatus.INELIGIBLE,
    ],
    ['suprimido', { suppressions: [{ id: 's1' }] }, 'SUPPRESSED', RecipientStatus.SUPPRESSED],
    ['telefone inválido', { phoneE164: '123' }, 'INVALID_PHONE', RecipientStatus.INVALID],
    [
      'arquivado',
      { status: ContactStatus.ARCHIVED },
      'CONTACT_NOT_ACTIVE',
      RecipientStatus.INELIGIBLE,
    ],
  ] as const)('bloqueia %s', (_label, overrides, reason, status) => {
    const result = evaluateCampaignRecipientEligibility(
      contact(overrides as Partial<AudienceContact>),
      context(),
    );

    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain(reason);
    expect(result.status).toBe(status);
    expect(result.resolved).toBeNull();
  });

  it('supressão vence consentimento concedido', () => {
    const result = evaluateCampaignRecipientEligibility(
      contact({
        consents: [{ channel: ConsentChannel.WHATSAPP, status: ConsentStatus.GRANTED }],
        suppressions: [{ id: 's1' }],
      }),
      context(),
    );

    expect(result.eligible).toBe(false);
    expect(result.status).toBe(RecipientStatus.SUPPRESSED);
  });

  it('telefone existente NÃO vale como consentimento', () => {
    const result = evaluateCampaignRecipientEligibility(
      contact({ consents: [], phoneE164: '+5585999990000' }),
      context(),
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('CONSENT_MISSING');
  });

  it('reporta todos os motivos, não apenas o primeiro', () => {
    const result = evaluateCampaignRecipientEligibility(
      contact({ consents: [], suppressions: [{ id: 's' }], phoneE164: '123' }),
      context(),
    );

    expect(result.reasons).toEqual(
      expect.arrayContaining(['CONSENT_MISSING', 'SUPPRESSED', 'INVALID_PHONE']),
    );
  });
});

describe('bloqueios de configuração', () => {
  it.each([
    [
      'canal desconectado',
      { channel: { status: ChannelStatus.DISCONNECTED } as never, template: template() },
      'CHANNEL_NOT_CONNECTED',
    ],
    ['sem canal', { channel: null, template: template() }, 'CHANNEL_NOT_CONNECTED'],
    ['sem template', { channel: CHANNEL, template: null }, 'TEMPLATE_MISSING'],
    [
      'template pendente',
      { channel: CHANNEL, template: template({ status: TemplateStatus.PENDING }) },
      'TEMPLATE_NOT_APPROVED',
    ],
    [
      'template rejeitado',
      { channel: CHANNEL, template: template({ status: TemplateStatus.REJECTED }) },
      'TEMPLATE_NOT_APPROVED',
    ],
    [
      'template removido da Meta',
      {
        channel: CHANNEL,
        template: template({ availability: TemplateAvailability.UNAVAILABLE }),
      },
      'TEMPLATE_UNAVAILABLE',
    ],
  ] as const)('bloqueia todos quando %s', (_label, overrides, reason) => {
    const built = context({
      ...overrides,
      mapping: { 'body:1': { source: 'contact.firstName' } },
    });

    expect(built.blockedForAll).toContain(reason);
    const result = evaluateCampaignRecipientEligibility(contact(), built);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain(reason);
  });
});

describe('variáveis', () => {
  it('bloqueia quando falta valor e a política é bloquear', () => {
    const result = evaluateCampaignRecipientEligibility(
      contact({ firstName: null }),
      context(),
    );

    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('VARIABLES_UNRESOLVED');
  });

  it('usa o fallback configurado quando a política permite', () => {
    const built = buildEligibilityContext({
      channel: CHANNEL,
      template: template(),
      mapping: { 'body:1': { source: 'contact.firstName' } },
      variablePolicy: MissingVariablePolicy.FALLBACK_VALUE,
      variableFallbacks: { 'body:1': 'cliente' },
    });

    const result = evaluateCampaignRecipientEligibility(contact({ firstName: null }), built);

    expect(result.eligible).toBe(true);
    expect(result.resolved?.bodyParameters).toEqual(['cliente']);
    expect(result.preview).toBe('Olá cliente, tudo bem?');
  });

  it('sem fallback escrito, a política FALLBACK_VALUE ainda bloqueia', () => {
    // Nada é inventado: fallback tem de ser configurado explicitamente.
    const built = buildEligibilityContext({
      channel: CHANNEL,
      template: template(),
      mapping: { 'body:1': { source: 'contact.firstName' } },
      variablePolicy: MissingVariablePolicy.FALLBACK_VALUE,
      variableFallbacks: {},
    });

    const result = evaluateCampaignRecipientEligibility(contact({ firstName: null }), built);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('VARIABLES_UNRESOLVED');
  });

  it('fallback em branco não conta como valor', () => {
    const built = buildEligibilityContext({
      channel: CHANNEL,
      template: template(),
      mapping: { 'body:1': { source: 'contact.firstName' } },
      variablePolicy: MissingVariablePolicy.FALLBACK_VALUE,
      variableFallbacks: { 'body:1': '   ' },
    });

    expect(
      evaluateCampaignRecipientEligibility(contact({ firstName: null }), built).eligible,
    ).toBe(false);
  });

  it('o fallback não sobrescreve quem tem valor', () => {
    const built = buildEligibilityContext({
      channel: CHANNEL,
      template: template(),
      mapping: { 'body:1': { source: 'contact.firstName' } },
      variablePolicy: MissingVariablePolicy.FALLBACK_VALUE,
      variableFallbacks: { 'body:1': 'cliente' },
    });

    const result = evaluateCampaignRecipientEligibility(contact({ firstName: 'Ana' }), built);
    expect(result.resolved?.bodyParameters).toEqual(['Ana']);
  });

  it('template sem variáveis é elegível sem mapeamento', () => {
    const built = buildEligibilityContext({
      channel: CHANNEL,
      template: template({ body: 'Mensagem fixa', variables: [] }),
      mapping: {},
    });

    const result = evaluateCampaignRecipientEligibility(contact(), built);
    expect(result.eligible).toBe(true);
    expect(result.preview).toBe('Mensagem fixa');
  });
});

describe('recorte agregado', () => {
  it('classifica cada bloqueio no balde certo', () => {
    const breakdown = emptyBreakdown();
    const built = context();

    accumulate(breakdown, evaluateCampaignRecipientEligibility(contact(), built));
    accumulate(
      breakdown,
      evaluateCampaignRecipientEligibility(contact({ suppressions: [{ id: 's' }] }), built),
    );
    accumulate(
      breakdown,
      evaluateCampaignRecipientEligibility(contact({ phoneE164: '123' }), built),
    );
    accumulate(breakdown, evaluateCampaignRecipientEligibility(contact({ consents: [] }), built));

    expect(breakdown).toMatchObject({
      total: 4,
      eligible: 1,
      suppressed: 1,
      invalid: 1,
      ineligible: 1,
    });
    expect(breakdown.byReason.SUPPRESSED).toBe(1);
    expect(breakdown.byReason.CONSENT_MISSING).toBe(1);
  });

  it('recorte vazio é todo zero', () => {
    expect(emptyBreakdown()).toMatchObject({ total: 0, eligible: 0, byReason: {} });
  });
});
