import 'server-only';
import type { Contact, Prisma } from '@prisma/client';
import {
  ConsentChannel,
  ConsentSource,
  ConsentStatus,
  ContactStatus,
  MediaStatus,
  MessageDirection,
  MessageStatus,
  MessageType,
} from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging/logger';
import { normalizePhone } from '@/features/contacts/phone';
import { findOrCreateConversation, registerInbound } from '@/features/messaging/conversation-service';
import type { InboundMessageEvent } from '@/features/webhooks/parser';

/**
 * Processamento de mensagem recebida.
 *
 * Contato desconhecido não é descartado: vira um contato mínimo com
 * `source = WHATSAPP_INBOUND`. O consentimento de marketing NÃO é concedido por
 * isso — alguém escrever para você é permissão de responder, não de incluir a
 * pessoa em campanha. O registro nasce `UNKNOWN`.
 */

export const INBOUND_SOURCE = 'WHATSAPP_INBOUND';

/** Tipos da Meta que sabemos classificar. O resto vira UNSUPPORTED. */
const TYPE_MAP: Record<string, MessageType> = {
  text: MessageType.TEXT,
  image: MessageType.IMAGE,
  audio: MessageType.AUDIO,
  video: MessageType.VIDEO,
  document: MessageType.DOCUMENT,
  sticker: MessageType.STICKER,
  location: MessageType.LOCATION,
  contacts: MessageType.CONTACTS,
  interactive: MessageType.INTERACTIVE,
  button: MessageType.INTERACTIVE,
};

export function toMessageType(providerType: string): MessageType {
  return TYPE_MAP[providerType.toLowerCase()] ?? MessageType.UNSUPPORTED;
}

export interface InboundResult {
  status: 'PROCESSED' | 'DUPLICATE';
  contactId: string;
  /** Telefone já normalizado — quem trata descadastro precisa dele. */
  phoneE164: string;
  conversationId: string;
  messageId: string;
  contactCreated: boolean;
  conversationCreated: boolean;
}

export async function processInboundMessage(input: {
  workspaceId: string;
  channelId: string;
  phoneRegion: string;
  event: InboundMessageEvent;
}): Promise<InboundResult> {
  const { event } = input;

  // O telefone vem sem `+`; normalizar com a região do workspace garante que o
  // contato recebido case com o mesmo E.164 já cadastrado no CRM.
  const normalized = normalizePhone(`+${event.from.replace(/^\+/, '')}`, input.phoneRegion);
  const phoneE164 = normalized.ok ? normalized.phone.e164 : `+${event.from.replace(/^\+/, '')}`;

  if (!normalized.ok) {
    logger.warn('webhook.inbound_phone_unparseable', {
      workspaceId: input.workspaceId,
      // O número nunca é logado inteiro.
      suffix: event.from.slice(-4),
    });
  }

  return prisma.$transaction(async (tx) => {
    const { contact, created: contactCreated } = await findOrCreateContact(
      { workspaceId: input.workspaceId, phoneE164, profileName: event.profileName },
      tx,
    );

    const { conversation, created: conversationCreated } = await findOrCreateConversation(
      { workspaceId: input.workspaceId, channelId: input.channelId, contactId: contact.id },
      tx,
    );

    const receivedAt = event.timestamp ?? new Date();
    const media = event.media;

    // `createMany` com `skipDuplicates` usa ON CONFLICT DO NOTHING: uma
    // entrega repetida não insere e, ao contrário de um INSERT que estoura a
    // unique, NÃO aborta a transação. `count` diz se a linha nasceu agora —
    // e é isso que decide se o contador de não lidas avança.
    const inserted = await tx.message.createMany({
      skipDuplicates: true,
      data: [
        {
          workspaceId: input.workspaceId,
          channelId: input.channelId,
          conversationId: conversation.id,
          contactId: contact.id,
          direction: MessageDirection.INBOUND,
          type: toMessageType(event.messageType),
          status: MessageStatus.RECEIVED,
          body: event.text,
          renderedContent: event.text,
          providerMessageId: event.providerMessageId,
          providerTimestamp: receivedAt,
          payload: { providerType: event.messageType } as unknown as Prisma.InputJsonValue,
          ...(media
            ? {
                mediaId: media.id,
                mediaMimeType: media.mimeType,
                mediaSha256: media.sha256,
                mediaFilename: media.filename,
                mediaCaption: media.caption,
                // O binário não é baixado nesta sprint; o estado diz isso.
                mediaStatus: MediaStatus.NOT_YET_FETCHED,
              }
            : {}),
        },
      ],
    });

    const message = await tx.message.findFirstOrThrow({
      where: { workspaceId: input.workspaceId, providerMessageId: event.providerMessageId },
    });

    if (inserted.count === 0) {
      return {
        status: 'DUPLICATE' as const,
        contactId: contact.id,
        phoneE164,
        conversationId: conversation.id,
        messageId: message.id,
        contactCreated,
        conversationCreated,
      };
    }

    await registerInbound(conversation.id, receivedAt, tx);

    return {
      status: 'PROCESSED' as const,
      contactId: contact.id,
      phoneE164,
      conversationId: conversation.id,
      messageId: message.id,
      contactCreated,
      conversationCreated,
    };
  });
}

/**
 * Encontra ou cria o contato de forma ATÔMICA.
 *
 * Um `create` que estoure a unique dentro de uma transação PostgreSQL aborta a
 * transação inteira (25P02) — as consultas seguintes falham e nem dá para reler
 * o registro vencedor. Por isso tudo aqui usa `upsert`/`updateMany`, que são
 * uma instrução só e nunca abortam.
 */
async function findOrCreateContact(
  input: { workspaceId: string; phoneE164: string; profileName: string | null },
  tx: Prisma.TransactionClient,
): Promise<{ contact: Contact; created: boolean }> {
  // `createMany` com `skipDuplicates` emite INSERT … ON CONFLICT DO NOTHING:
  // uma inserção concorrente perde silenciosamente em vez de estourar a unique
  // e ABORTAR a transação inteira (PostgreSQL 25P02). `upsert` do Prisma não
  // serve aqui — ele mesmo levanta P2002 sob concorrência.
  const inserted = await tx.contact.createMany({
    skipDuplicates: true,
    data: [
      {
        workspaceId: input.workspaceId,
        phoneE164: input.phoneE164,
        // Nome do perfil do WhatsApp é texto de terceiro: guardado como dado,
        // exibido como texto, nunca como marcação.
        firstName: input.profileName?.slice(0, 120) ?? null,
        source: INBOUND_SOURCE,
      },
    ],
  });

  const contact = await tx.contact.findUniqueOrThrow({
    where: {
      workspaceId_phoneE164: { workspaceId: input.workspaceId, phoneE164: input.phoneE164 },
    },
  });

  if (inserted.count > 0) {
    // Consentimento nasce UNKNOWN. Receber mensagem NÃO concede permissão de
    // marketing — é decisão de compliance, não efeito colateral.
    await tx.contactConsent.createMany({
      skipDuplicates: true,
      data: [
        {
          workspaceId: input.workspaceId,
          contactId: contact.id,
          channel: ConsentChannel.WHATSAPP,
          status: ConsentStatus.UNKNOWN,
          source: ConsentSource.INBOUND_MESSAGE,
          proofReference: 'inbound:whatsapp',
        },
      ],
    });

    // Uma supressão órfã do mesmo número reencontra o novo registro.
    await tx.suppressionEntry.updateMany({
      where: { workspaceId: input.workspaceId, phoneE164: input.phoneE164, contactId: null },
      data: { contactId: contact.id },
    });

    return { contact, created: true };
  }

  // Um contato arquivado que volta a escrever é reativado — ignorar seria
  // perder uma conversa real. Contato marcado como inválido não é mexido.
  const revived = await tx.contact.updateMany({
    where: { id: contact.id, status: ContactStatus.ARCHIVED },
    data: { status: ContactStatus.ACTIVE, archivedAt: null },
  });

  return {
    contact:
      revived.count > 0
        ? await tx.contact.findUniqueOrThrow({ where: { id: contact.id } })
        : contact,
    created: false,
  };
}
