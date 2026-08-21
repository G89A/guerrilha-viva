import 'server-only';
import { MessageDirection } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging/logger';
import { isProviderError, type ProviderMedia } from '@/providers/messaging/types';
import { createProviderForChannel } from '@/features/messaging/credentials';

/**
 * Mídia recebida, buscada SOB DEMANDA.
 *
 * A Meta entrega uma URL temporária (minutos) para o binário, e o download
 * exige o token do servidor. Duas consequências que definem este desenho:
 *
 *   1. a URL não pode ir para o navegador — levaria o token junto ou expiraria
 *      antes de servir para algo;
 *   2. nada é armazenado aqui. Não há bucket configurado neste produto, e
 *      fingir um "arquivo salvo" que na verdade é um ponteiro para uma URL
 *      morta seria pior que não ter o recurso.
 *
 * Então o servidor busca na hora e transmite. `MediaStatus.NOT_YET_FETCHED`
 * continua dizendo a verdade: o binário não está guardado do nosso lado.
 */

/** Teto por arquivo. A Meta já limita, mas o limite tem de ser nosso também. */
export const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

/**
 * Tipos que a Inbox aceita servir.
 *
 * Allowlist, não blocklist: o `mime` vem do WhatsApp e é texto de terceiro.
 * Devolver `text/html` daqui transformaria uma mídia recebida em XSS servido
 * pelo nosso domínio.
 */
const ALLOWED_MIME_PREFIXES = ['image/', 'video/', 'audio/'] as const;
const ALLOWED_MIME_EXACT = ['application/pdf'] as const;

export function isServableMime(mime: string | null): boolean {
  if (!mime) return false;
  const normalized = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  if (ALLOWED_MIME_EXACT.includes(normalized as (typeof ALLOWED_MIME_EXACT)[number])) return true;
  return ALLOWED_MIME_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export type MediaOutcome =
  | { ok: true; media: ProviderMedia; mimeType: string; filename: string | null }
  | { ok: false; status: number; reason: string };

export async function fetchInboundMedia(input: {
  workspaceId: string;
  messageId: string;
  providerOverrides?: Parameters<typeof createProviderForChannel>[1];
}): Promise<MediaOutcome> {
  const message = await prisma.message.findFirst({
    // O workspace entra no filtro, não numa checagem posterior: id de mensagem
    // de outro tenant simplesmente não encontra nada.
    where: {
      id: input.messageId,
      workspaceId: input.workspaceId,
      direction: MessageDirection.INBOUND,
    },
    select: {
      id: true,
      mediaId: true,
      mediaMimeType: true,
      mediaFilename: true,
      channel: true,
    },
  });

  if (!message) return { ok: false, status: 404, reason: 'Mídia não encontrada.' };
  if (!message.mediaId) return { ok: false, status: 404, reason: 'Mensagem não tem mídia.' };

  if (!isServableMime(message.mediaMimeType)) {
    return { ok: false, status: 415, reason: 'Tipo de mídia não suportado pela Inbox.' };
  }

  let provider;
  try {
    provider = createProviderForChannel(message.channel, input.providerOverrides ?? {});
  } catch {
    return { ok: false, status: 503, reason: 'Canal não configurado para falar com a Meta.' };
  }

  if (!provider.fetchMedia) {
    return { ok: false, status: 501, reason: 'Provedor não suporta download de mídia.' };
  }

  try {
    const media = await provider.fetchMedia(message.mediaId, MAX_MEDIA_BYTES);

    // O tipo que vale é o que gravamos do evento, já validado acima. O
    // `content-type` da resposta é de terceiro e não define o que servimos.
    return {
      ok: true,
      media,
      mimeType: message.mediaMimeType ?? 'application/octet-stream',
      filename: message.mediaFilename,
    };
  } catch (error) {
    logger.warn('inbox.media_fetch_failed', {
      workspaceId: input.workspaceId,
      messageId: message.id,
    });
    const status = isProviderError(error) && error.httpStatus === 404 ? 404 : 502;
    return { ok: false, status, reason: 'Não foi possível obter a mídia na Meta.' };
  }
}
