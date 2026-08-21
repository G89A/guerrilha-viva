import 'server-only';
import type { MessagingChannel, Prisma } from '@prisma/client';
import { ChannelProvider, TemplateAvailability } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging/logger';
import type { ProviderTemplate } from '@/providers/messaging/types';
import { createProviderForChannel } from '@/features/messaging/credentials';
import {
  bodyVariableCount,
  extractVariables,
  normalizeHeaderFormat,
  normalizeTemplateCategory,
  normalizeTemplateStatus,
} from '@/features/messaging/template-normalize';

export interface SyncReport {
  fetched: number;
  created: number;
  updated: number;
  /** Templates que sumiram da Meta e foram marcados como indisponíveis. */
  markedUnavailable: number;
  /** Templates que voltaram a aparecer. */
  restored: number;
}

/**
 * Sincroniza os templates da WABA para o banco local.
 *
 * Idempotente: a chave é (workspace, provider, providerTemplateId), então
 * rodar duas vezes atualiza em vez de duplicar.
 *
 * Templates que desapareceram da Meta NÃO são apagados — viram UNAVAILABLE.
 * O histórico de mensagens já enviadas continua apontando para um registro
 * existente, e o operador vê o que aconteceu (ADR 0013).
 */
export async function syncTemplates(
  channel: MessagingChannel,
  overrides: Parameters<typeof createProviderForChannel>[1] = {},
): Promise<SyncReport> {
  const provider = createProviderForChannel(channel, overrides);
  const templates = await provider.getTemplates();
  const syncedAt = new Date();

  let created = 0;
  let updated = 0;
  let restored = 0;
  const seenIds: string[] = [];

  for (const template of templates) {
    const data = toTemplateData(template, channel, syncedAt);
    const identifier = template.providerTemplateId;

    // Sem id do provider não há chave estável; cai no par nome+idioma, que a
    // Meta também trata como identidade de template.
    const existing = identifier
      ? await prisma.messageTemplate.findFirst({
          where: {
            workspaceId: channel.workspaceId,
            provider: ChannelProvider.META,
            providerTemplateId: identifier,
          },
        })
      : await prisma.messageTemplate.findFirst({
          where: {
            workspaceId: channel.workspaceId,
            channelId: channel.id,
            name: template.name,
            language: template.language,
          },
        });

    if (existing) {
      if (existing.availability === TemplateAvailability.UNAVAILABLE) restored += 1;
      await prisma.messageTemplate.update({ where: { id: existing.id }, data });
      updated += 1;
      seenIds.push(existing.id);
    } else {
      const record = await prisma.messageTemplate.create({
        data: {
          ...data,
          workspaceId: channel.workspaceId,
          channelId: channel.id,
          provider: ChannelProvider.META,
          providerTemplateId: identifier,
          name: template.name,
          language: template.language,
        },
      });
      created += 1;
      seenIds.push(record.id);
    }
  }

  const disappeared = await prisma.messageTemplate.updateMany({
    where: {
      workspaceId: channel.workspaceId,
      channelId: channel.id,
      availability: TemplateAvailability.AVAILABLE,
      id: { notIn: seenIds.length > 0 ? seenIds : ['__nenhum__'] },
    },
    data: { availability: TemplateAvailability.UNAVAILABLE, unavailableSince: syncedAt },
  });

  const report: SyncReport = {
    fetched: templates.length,
    created,
    updated,
    markedUnavailable: disappeared.count,
    restored,
  };

  logger.info('messaging.templates_synced', {
    workspaceId: channel.workspaceId,
    channelId: channel.id,
    ...report,
  });

  return report;
}

/** Campos comuns a criação e atualização. O tipo é inferido de propósito:
 *  anotar com os tipos do Prisma força uma união que não descreve este uso. */
function toTemplateData(template: ProviderTemplate, channel: MessagingChannel, syncedAt: Date) {
  const variables = extractVariables({ headerText: template.headerText, body: template.body });

  return {
    status: normalizeTemplateStatus(template.status),
    category: normalizeTemplateCategory(template.category),
    // Valores brutos preservados: um status novo da Meta continua legível.
    providerStatus: template.status,
    providerCategory: template.category,
    headerFormat: normalizeHeaderFormat(template.headerFormat),
    headerText: template.headerText,
    body: template.body,
    footerText: template.footerText,
    buttons: template.buttons as unknown as Prisma.InputJsonValue,
    components: template.components as unknown as Prisma.InputJsonValue,
    variables: variables as unknown as Prisma.InputJsonValue,
    variableCount: bodyVariableCount(variables),
    qualityScore: template.qualityScore,
    availability: TemplateAvailability.AVAILABLE,
    unavailableSince: null,
    syncedAt,
    channelId: channel.id,
  };
}
