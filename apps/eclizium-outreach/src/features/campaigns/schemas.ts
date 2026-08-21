import { z } from 'zod';
import { CampaignStatus, ConsentStatus, ContactStatus, MissingVariablePolicy } from '@prisma/client';
import { cuidSchema } from '@/lib/validation/common';
import { VARIABLE_SOURCES } from '@/features/messaging/template-render';

/**
 * Validação de tudo que entra no motor de campanhas.
 *
 * Filtros de audiência viram cláusulas SQL: passam por aqui antes, com listas
 * limitadas em tamanho, para que um payload hostil não vire uma consulta
 * impossível de responder.
 */

const idList = (max: number) => z.array(cuidSchema).max(max).optional();
const textList = (max: number, length = 120) =>
  z.array(z.string().trim().min(1).max(length)).max(max).optional();

export const audienceFiltersSchema = z.object({
  listIds: idList(50),
  tagIds: idList(50),
  cities: textList(100),
  states: textList(60),
  segments: textList(60),
  sources: textList(60),
  /** Padrão implícito: apenas contatos ativos. */
  contactStatus: z.nativeEnum(ContactStatus).optional(),
  /** Consentimento de WhatsApp exigido para entrar na audiência. */
  consent: z.nativeEnum(ConsentStatus).optional(),
  /** Suprimidos ficam de fora por padrão; incluí-los é decisão explícita. */
  includeSuppressed: z.boolean().optional(),
  search: z.string().trim().max(120).optional(),
});
export type AudienceFilters = z.infer<typeof audienceFiltersSchema>;

export const EMPTY_AUDIENCE: AudienceFilters = {};

const variableBindingSchema = z.object({
  source: z.enum(VARIABLE_SOURCES),
  value: z.string().trim().max(500).optional(),
});

export const campaignDetailsSchema = z.object({
  name: z.string().trim().min(1, 'Dê um nome à campanha.').max(120),
  description: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null)),
});

export const createCampaignSchema = campaignDetailsSchema.extend({
  templateId: cuidSchema.optional(),
  audienceFilters: audienceFiltersSchema.default({}),
  variableMap: z.record(z.string().max(20), variableBindingSchema).default({}),
  variablePolicy: z.nativeEnum(MissingVariablePolicy).default(MissingVariablePolicy.BLOCK_RECIPIENT),
  variableFallbacks: z.record(z.string().max(20), z.string().trim().max(500)).default({}),
});
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export const updateCampaignSchema = createCampaignSchema.extend({
  campaignId: cuidSchema,
});

export const campaignIdSchema = z.object({ campaignId: cuidSchema });

/**
 * Agendamento. O instante chega do navegador em ISO 8601 com offset, então o
 * servidor não precisa adivinhar fuso: o `Date` resultante já é o ponto no
 * tempo correto, e é gravado em UTC.
 */
export const scheduleCampaignSchema = z.object({
  campaignId: cuidSchema,
  scheduledAt: z
    .string()
    .datetime({ offset: true })
    .transform((value) => new Date(value))
    .refine((date) => date.getTime() > Date.now(), {
      message: 'O agendamento precisa ser no futuro.',
    }),
  /** Zona escolhida pelo operador, guardada só para exibir de volta. */
  timezone: z.string().trim().min(1).max(64).default('UTC'),
});

export const CAMPAIGNS_PAGE_SIZE = 20;
export const RECIPIENTS_PAGE_SIZE = 50;

export const campaignListFiltersSchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.nativeEnum(CampaignStatus).optional(),
  templateId: cuidSchema.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type CampaignListFilters = z.infer<typeof campaignListFiltersSchema>;

export const recipientFiltersSchema = z.object({
  status: z.string().trim().max(20).optional(),
  eligibility: z.enum(['ELIGIBLE', 'BLOCKED', 'NOT_EVALUATED']).optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type RecipientFilters = z.infer<typeof recipientFiltersSchema>;
