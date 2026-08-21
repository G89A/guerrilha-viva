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
