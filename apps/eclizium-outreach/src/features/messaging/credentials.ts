import 'server-only';
import type { MessagingChannel } from '@prisma/client';
import { CredentialSource } from '@prisma/client';
import { AppError } from '@/lib/errors/app-error';
import { getMetaEnvState } from '@/lib/env';
import { fingerprintSecret, openSecret, sealSecret } from '@/lib/security/secret-box';
import { MetaWhatsAppProvider } from '@/providers/messaging/meta/meta-whatsapp';
import type { MessagingProvider } from '@/providers/messaging/types';

/**
 * Resolução de credenciais do canal.
 *
 * O token nunca sai deste módulo a não ser para dentro do provider. Nenhuma
 * função aqui devolve o valor para a camada de aplicação, para a UI ou para o
 * log — apenas o fingerprint mascarado, que é seguro exibir.
 */

export interface ResolvedCredentials {
  accessToken: string;
  wabaId: string;
  phoneNumberId: string;
  graphApiVersion: string;
}

/** Descreve a credencial sem revelá-la. É isto que a UI pode ver. */
export interface CredentialSummary {
  source: CredentialSource;
  present: boolean;
  fingerprint: string | null;
  missing: string[];
}

export function describeCredentials(channel: MessagingChannel): CredentialSummary {
  if (channel.credentialSource === CredentialSource.ENCRYPTED) {
    return {
      source: CredentialSource.ENCRYPTED,
      present: Boolean(channel.accessTokenCipher),
      fingerprint: channel.tokenFingerprint,
      missing: channel.accessTokenCipher ? [] : ['META_ACCESS_TOKEN'],
    };
  }

  const env = getMetaEnvState();
  return {
    source: CredentialSource.ENVIRONMENT,
    present: env.configured,
    fingerprint: env.configured ? fingerprintSecret(env.env.META_ACCESS_TOKEN) : null,
    missing: env.configured ? [] : env.missing,
  };
}

/**
 * Devolve as credenciais efetivas do canal, ou lança NOT_CONFIGURED com a lista
 * exata do que falta — nunca um erro genérico.
 */
export function resolveCredentials(channel: MessagingChannel): ResolvedCredentials {
  const missing: string[] = [];
  if (!channel.wabaId) missing.push('WABA ID');
  if (!channel.phoneNumberId) missing.push('Phone Number ID');

  let accessToken: string | null = null;

  if (channel.credentialSource === CredentialSource.ENCRYPTED) {
    if (!channel.accessTokenCipher) {
      missing.push('Access Token');
    } else {
      try {
        accessToken = openSecret(channel.accessTokenCipher);
      } catch {
        // Chave de cifragem trocada ou registro corrompido: é configuração
        // quebrada, não credencial ausente.
        throw AppError.notConfigured(
          'Não foi possível decifrar o token salvo. Reconfigure a integração.',
        );
      }
    }
  } else {
    const env = getMetaEnvState();
    if (!env.configured) {
      missing.push(...env.missing);
    } else {
      accessToken = env.env.META_ACCESS_TOKEN;
    }
  }

  if (!accessToken || missing.length > 0) {
    throw AppError.notConfigured('Integração da Meta incompleta.', {
      missing: [...new Set(missing)].sort(),
    });
  }

  return {
    accessToken,
    wabaId: channel.wabaId as string,
    phoneNumberId: channel.phoneNumberId as string,
    graphApiVersion: channel.graphApiVersion,
  };
}

/** Cifra um token para persistência e devolve também seu fingerprint. */
export function sealAccessToken(token: string): { cipher: string; fingerprint: string } {
  return { cipher: sealSecret(token), fingerprint: fingerprintSecret(token) };
}

/**
 * Fábrica do provider. Instanciar aqui — e só em runtime — garante que nenhuma
 * credencial é lida durante o build.
 */
export function createProviderForChannel(
  channel: MessagingChannel,
  overrides: { fetchImpl?: MetaProviderFetch; timeoutMs?: number } = {},
): MessagingProvider {
  const credentials = resolveCredentials(channel);

  return new MetaWhatsAppProvider({
    ...credentials,
    ...(overrides.fetchImpl === undefined ? {} : { fetchImpl: overrides.fetchImpl }),
    ...(overrides.timeoutMs === undefined ? {} : { timeoutMs: overrides.timeoutMs }),
    logContext: { workspaceId: channel.workspaceId, channelId: channel.id },
  });
}

type MetaProviderFetch = ConstructorParameters<typeof MetaWhatsAppProvider>[0]['fetchImpl'];
