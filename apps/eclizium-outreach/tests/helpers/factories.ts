import {
  ChannelEnvironment,
  ChannelKind,
  ChannelProvider,
  ChannelStatus,
  ConsentChannel,
  ConsentStatus,
  CredentialSource,
  TemplateAvailability,
  TemplateStatus,
  WorkspaceRole,
  CampaignStatus,
  type Campaign,
  type MessageTemplate,
  type MessagingChannel,
} from '@prisma/client';
import { hashPassword } from '@/lib/auth/password';
import { sealSecret } from '@/lib/security/secret-box';
import { testPrisma } from './db';

let counter = 0;

function unique(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export interface SeededTenant {
  userId: string;
  email: string;
  workspaceId: string;
  workspaceSlug: string;
}

/** Creates an isolated user + workspace + OWNER membership. */
export async function seedTenant(label = 'tenant'): Promise<SeededTenant> {
  const prisma = testPrisma();
  const email = `${unique(label)}@example.test`;
  const slug = unique(label);

  const user = await prisma.user.create({
    data: {
      email,
      name: `User ${label}`,
      // Fixed low-cost hash: factories run per-test and scrypt is deliberately slow.
      passwordHash: 'scrypt$1024$8$1$c2FsdHNhbHRzYWx0c2E=$bm90LWEtcmVhbC1oYXNo',
    },
  });

  const workspace = await prisma.workspace.create({
    data: {
      name: `Workspace ${label}`,
      slug,
      members: { create: { userId: user.id, role: WorkspaceRole.OWNER } },
    },
  });

  return { userId: user.id, email, workspaceId: workspace.id, workspaceSlug: workspace.slug };
}

export async function seedContact(
  workspaceId: string,
  phoneE164: string,
  overrides: Partial<{
    firstName: string;
    lastName: string;
    email: string;
    company: string;
    city: string;
    source: string;
  }> = {},
): Promise<string> {
  const contact = await testPrisma().contact.create({
    data: { workspaceId, phoneE164, firstName: 'Contato', ...overrides },
  });
  return contact.id;
}

/** Workspace no formato que os serviços de contato esperam. */
export function workspaceRef(workspaceId: string, region = 'BR') {
  return { id: workspaceId, defaultPhoneRegion: region };
}

export async function seedUserWithPassword(
  email: string,
  password: string,
): Promise<string> {
  const user = await testPrisma().user.create({
    data: { email, name: 'Usuário Teste', passwordHash: await hashPassword(password) },
  });
  return user.id;
}

// ---------------------------------------------------------------------------
// Sprint 2 — canal Meta e templates
// ---------------------------------------------------------------------------

/** Canal Meta pronto para uso, com credencial cifrada por padrão. */
export async function seedChannel(
  workspaceId: string,
  overrides: Partial<{
    status: ChannelStatus;
    environment: ChannelEnvironment;
    credentialSource: CredentialSource;
    accessTokenCipher: string | null;
    wabaId: string;
    phoneNumberId: string;
    graphApiVersion: string;
  }> = {},
): Promise<MessagingChannel> {
  return testPrisma().messagingChannel.create({
    data: {
      workspaceId,
      provider: ChannelProvider.META,
      channel: ChannelKind.WHATSAPP,
      displayName: 'WhatsApp',
      status: ChannelStatus.CONNECTED,
      environment: ChannelEnvironment.TEST,
      credentialSource: CredentialSource.ENCRYPTED,
      accessTokenCipher: sealSecret('EAAG-token-de-teste'),
      tokenFingerprint: '••••abc12345',
      wabaId: '222222222222222',
      phoneNumberId: '111111111111111',
      graphApiVersion: 'v21.0',
      ...overrides,
    },
  });
}

export async function seedTemplate(
  workspaceId: string,
  channelId: string,
  overrides: Partial<{
    name: string;
    language: string;
    status: TemplateStatus;
    availability: TemplateAvailability;
    body: string;
    variables: unknown;
    variableCount: number;
    providerTemplateId: string;
  }> = {},
): Promise<MessageTemplate> {
  const body = overrides.body ?? 'Olá {{1}}, tudo bem?';
  const variables = overrides.variables ?? [{ key: '1', component: 'body' }];

  return testPrisma().messageTemplate.create({
    data: {
      workspaceId,
      channelId,
      provider: ChannelProvider.META,
      providerTemplateId: overrides.providerTemplateId ?? unique('tpl'),
      name: overrides.name ?? unique('template').replace(/-/g, '_'),
      language: overrides.language ?? 'pt_BR',
      status: overrides.status ?? TemplateStatus.APPROVED,
      availability: overrides.availability ?? TemplateAvailability.AVAILABLE,
      body,
      variables: variables as never,
      variableCount: overrides.variableCount ?? 1,
      syncedAt: new Date(),
    },
  });
}

/** Contato pronto para envio: ativo, com consentimento concedido. */
export async function seedEligibleContact(
  workspaceId: string,
  phoneE164: string,
  overrides: Parameters<typeof seedContact>[2] = {},
): Promise<string> {
  const contactId = await seedContact(workspaceId, phoneE164, {
    firstName: 'Ana',
    company: 'Clínica XPTO',
    ...overrides,
  });

  await testPrisma().contactConsent.create({
    data: {
      workspaceId,
      contactId,
      channel: ConsentChannel.WHATSAPP,
      status: ConsentStatus.GRANTED,
      capturedAt: new Date(),
    },
  });

  return contactId;
}

// ---------------------------------------------------------------------------
// Sprint 4 — campanhas
// ---------------------------------------------------------------------------

export async function seedCampaign(
  workspaceId: string,
  overrides: Partial<{
    name: string;
    status: CampaignStatus;
    channelId: string;
    templateId: string;
    audienceFilters: unknown;
    variableMap: unknown;
    createdById: string;
  }> = {},
): Promise<Campaign> {
  return testPrisma().campaign.create({
    data: {
      workspaceId,
      name: overrides.name ?? unique('campanha'),
      status: overrides.status ?? CampaignStatus.DRAFT,
      channelId: overrides.channelId ?? null,
      templateId: overrides.templateId ?? null,
      audienceFilters: (overrides.audienceFilters ?? {}) as never,
      variableMap: (overrides.variableMap ?? {
        'body:1': { source: 'contact.firstName' },
      }) as never,
      createdById: overrides.createdById ?? null,
    },
  });
}

/**
 * Cria `count` contatos elegíveis de uma vez. Usado nos testes de escala —
 * criar um a um tornaria a suíte lenta demais para valer a pena.
 */
export async function seedContactsBulk(
  workspaceId: string,
  count: number,
  options: { consent?: ConsentStatus; city?: string; prefix?: string } = {},
): Promise<number> {
  const prefix = options.prefix ?? '5585';
  const base = 900000000 + Math.floor(Math.random() * 50_000_000);

  const contacts = Array.from({ length: count }, (_value, index) => ({
    workspaceId,
    phoneE164: `+${prefix}${String(base + index).slice(0, 9)}`,
    firstName: `Contato ${index}`,
    company: `Empresa ${index % 50}`,
    city: options.city ?? (index % 2 === 0 ? 'Fortaleza' : 'Recife'),
    segment: index % 3 === 0 ? 'Saúde' : 'Varejo',
  }));

  const inserted = await testPrisma().contact.createMany({
    data: contacts,
    skipDuplicates: true,
  });

  if (options.consent) {
    const created = await testPrisma().contact.findMany({
      where: { workspaceId },
      select: { id: true },
    });
    await testPrisma().contactConsent.createMany({
      data: created.map((contact) => ({
        workspaceId,
        contactId: contact.id,
        channel: ConsentChannel.WHATSAPP,
        status: options.consent as ConsentStatus,
        capturedAt: options.consent === ConsentStatus.GRANTED ? new Date() : null,
      })),
      skipDuplicates: true,
    });
  }

  return inserted.count;
}
