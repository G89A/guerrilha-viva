import 'server-only';
import type { MessagingChannel } from '@prisma/client';
import {
  type ChannelEnvironment,
  ChannelKind,
  ChannelProvider,
  ChannelStatus,
  CredentialSource,
} from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { AppError } from '@/lib/errors/app-error';
import { logger } from '@/lib/logging/logger';
import { isProviderError, type ProviderConnectionResult } from '@/providers/messaging/types';
import { connectionFailureMessage } from '@/providers/messaging/messages';
import {
  createProviderForChannel,
  describeCredentials,
  sealAccessToken,
  type CredentialSummary,
} from '@/features/messaging/credentials';

/**
 * Ciclo de vida do canal de mensageria de um workspace.
 *
 * Um canal pertence a um workspace (unique em workspace+provider+channel) e
 * toda leitura é escopada — não existe caminho que devolva o canal de outro
 * tenant.
 */

export async function findChannel(workspaceId: string): Promise<MessagingChannel | null> {
  return prisma.messagingChannel.findFirst({
    where: { workspaceId, provider: ChannelProvider.META, channel: ChannelKind.WHATSAPP },
  });
}

export async function requireChannel(workspaceId: string): Promise<MessagingChannel> {
  const channel = await findChannel(workspaceId);
  if (!channel) {
    throw AppError.notConfigured('Nenhum canal WhatsApp configurado neste workspace.');
  }
  return channel;
}

export interface ConfigureChannelInput {
  workspaceId: string;
  displayName: string;
  wabaId: string;
  phoneNumberId: string;
  graphApiVersion: string;
  environment: ChannelEnvironment;
  credentialSource: CredentialSource;
  /** Só usado quando credentialSource = ENCRYPTED. Nunca é persistido em claro. */
  accessToken?: string | undefined;
}

/**
 * Cria ou atualiza a integração. Salvar credenciais NÃO marca o canal como
 * conectado: o status volta para NOT_CONFIGURED e só vira CONNECTED depois de
 * uma verificação real contra a Graph API.
 */
export async function configureChannel(input: ConfigureChannelInput): Promise<MessagingChannel> {
  const sealed =
    input.credentialSource === CredentialSource.ENCRYPTED && input.accessToken
      ? sealAccessToken(input.accessToken)
      : null;

  if (input.credentialSource === CredentialSource.ENCRYPTED) {
    const existing = await findChannel(input.workspaceId);
    // Reconfigurar sem digitar o token de novo é permitido, desde que já exista
    // um cifrado guardado.
    if (!sealed && !existing?.accessTokenCipher) {
      throw AppError.validation('Informe o access token.', {
        accessToken: ['Informe o access token.'],
      });
    }
  }

  const data = {
    displayName: input.displayName,
    wabaId: input.wabaId,
    phoneNumberId: input.phoneNumberId,
    graphApiVersion: input.graphApiVersion,
    environment: input.environment,
    credentialSource: input.credentialSource,
    status: ChannelStatus.NOT_CONFIGURED,
    lastError: null,
    lastErrorCode: null,
    connectedAt: null,
    lastVerifiedAt: null,
    ...(sealed ? { accessTokenCipher: sealed.cipher, tokenFingerprint: sealed.fingerprint } : {}),
    ...(input.credentialSource === CredentialSource.ENVIRONMENT
      ? { accessTokenCipher: null, tokenFingerprint: null }
      : {}),
  };

  return prisma.messagingChannel.upsert({
    where: {
      workspaceId_provider_channel: {
        workspaceId: input.workspaceId,
        provider: ChannelProvider.META,
        channel: ChannelKind.WHATSAPP,
      },
    },
    create: {
      workspaceId: input.workspaceId,
      provider: ChannelProvider.META,
      channel: ChannelKind.WHATSAPP,
      ...data,
    },
    update: data,
  });
}

export interface ConnectionTestOutcome {
  ok: boolean;
  status: ChannelStatus;
  result: ProviderConnectionResult | null;
  /** Mensagem já pronta para o usuário. Nunca contém stack trace nem token. */
  message: string;
  errorCode: string | null;
}

/**
 * Verificação real: consulta número, WABA e permissão de templates.
 *
 * "Token existe" e "integração funciona" são coisas diferentes — só o resultado
 * desta chamada promove o canal a CONNECTED.
 */
export async function testChannelConnection(
  channel: MessagingChannel,
  overrides: Parameters<typeof createProviderForChannel>[1] = {},
): Promise<ConnectionTestOutcome> {
  let outcome: ConnectionTestOutcome;

  try {
    const provider = createProviderForChannel(channel, overrides);
    const result = await provider.testConnection();

    outcome = result.ok
      ? {
          ok: true,
          status: ChannelStatus.CONNECTED,
          result,
          message: 'Integração verificada com sucesso.',
          errorCode: null,
        }
      : {
          ok: false,
          status: result.checks.some((check) => check.name === 'token' && !check.ok)
            ? ChannelStatus.INVALID
            : ChannelStatus.ERROR,
          result,
          message:
            result.checks.find((check) => !check.ok)?.detail ??
            'A verificação da integração falhou.',
          errorCode: null,
        };
  } catch (error) {
    outcome = describeFailure(error);
    logger.warn('messaging.connection_test_failed', {
      workspaceId: channel.workspaceId,
      channelId: channel.id,
      status: outcome.status,
      errorCode: outcome.errorCode,
    });
  }

  const updated = await prisma.messagingChannel.update({
    where: { id: channel.id },
    data: {
      status: outcome.status,
      lastVerifiedAt: new Date(),
      lastError: outcome.ok ? null : outcome.message,
      lastErrorCode: outcome.errorCode,
      connectedAt: outcome.ok ? (channel.connectedAt ?? new Date()) : null,
      ...(outcome.result
        ? {
            displayPhoneNumber: outcome.result.displayPhoneNumber,
            verifiedName: outcome.result.verifiedName,
            phoneE164: outcome.result.displayPhoneNumber?.replace(/[^\d+]/g, '') ?? null,
          }
        : {}),
    },
  });

  return { ...outcome, status: updated.status };
}

/** Traduz qualquer falha para uma mensagem que o operador consiga agir. */
function describeFailure(error: unknown): ConnectionTestOutcome {
  if (isProviderError(error)) {
    return {
      ok: false,
      status:
        error.kind === 'AUTHENTICATION' || error.kind === 'PERMISSION'
          ? ChannelStatus.INVALID
          : ChannelStatus.ERROR,
      result: null,
      message: connectionFailureMessage(error.kind),
      errorCode: error.detail?.code ? String(error.detail.code) : error.kind,
    };
  }

  if (error instanceof AppError && error.code === 'NOT_CONFIGURED') {
    return {
      ok: false,
      status: ChannelStatus.NOT_CONFIGURED,
      result: null,
      message: error.message,
      errorCode: null,
    };
  }

  return {
    ok: false,
    status: ChannelStatus.ERROR,
    result: null,
    message: 'Falha inesperada ao verificar a integração.',
    errorCode: null,
  };
}

export async function disconnectChannel(channel: MessagingChannel): Promise<MessagingChannel> {
  return prisma.messagingChannel.update({
    where: { id: channel.id },
    data: { status: ChannelStatus.DISCONNECTED, connectedAt: null },
  });
}

/** Visão segura do canal para a UI. Nunca inclui token nem ciphertext. */
export interface ChannelView {
  id: string;
  status: ChannelStatus;
  environment: ChannelEnvironment;
  displayName: string;
  wabaId: string | null;
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  graphApiVersion: string;
  credentials: CredentialSummary;
  lastError: string | null;
  lastVerifiedAt: Date | null;
  connectedAt: Date | null;
}

export function toChannelView(channel: MessagingChannel): ChannelView {
  return {
    id: channel.id,
    status: channel.status,
    environment: channel.environment,
    displayName: channel.displayName,
    wabaId: channel.wabaId,
    phoneNumberId: channel.phoneNumberId,
    displayPhoneNumber: channel.displayPhoneNumber,
    verifiedName: channel.verifiedName,
    graphApiVersion: channel.graphApiVersion,
    credentials: describeCredentials(channel),
    lastError: channel.lastError,
    lastVerifiedAt: channel.lastVerifiedAt,
    connectedAt: channel.connectedAt,
  };
}
