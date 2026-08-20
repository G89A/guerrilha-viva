import { z } from 'zod';
import { ConsentChannel, ConsentStatus, ContactStatus, SuppressionReason } from '@prisma/client';
import { cuidSchema } from '@/lib/validation/common';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional();

export const contactInputSchema = z.object({
  // Texto livre; a normalização para E.164 acontece no serviço, nunca aqui,
  // porque depende da região do workspace.
  phone: z.string().trim().min(1, 'Informe um telefone.').max(40, 'Telefone longo demais.'),
  firstName: optionalText(120),
  lastName: optionalText(120),
  email: z
    .string()
    .trim()
    .max(254)
    .email('E-mail inválido.')
    .transform((value) => value.toLowerCase())
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  company: optionalText(160),
  segment: optionalText(120),
  city: optionalText(120),
  state: optionalText(120),
  country: optionalText(120),
  source: optionalText(120),
  notes: optionalText(4000),
});
export type ContactInput = z.infer<typeof contactInputSchema>;

export const createContactSchema = contactInputSchema.extend({
  whatsappConsent: z.nativeEnum(ConsentStatus).default(ConsentStatus.UNKNOWN),
});
export type CreateContactInput = z.infer<typeof createContactSchema>;

export const updateContactSchema = contactInputSchema.extend({
  contactId: cuidSchema,
});
export type UpdateContactInput = z.infer<typeof updateContactSchema>;

export const contactIdSchema = z.object({ contactId: cuidSchema });

export const consentUpdateSchema = z.object({
  contactId: cuidSchema,
  channel: z.nativeEnum(ConsentChannel),
  status: z.nativeEnum(ConsentStatus),
  proofReference: optionalText(500),
});
export type ConsentUpdateInput = z.infer<typeof consentUpdateSchema>;

export const suppressSchema = z.object({
  contactId: cuidSchema,
  channel: z.nativeEnum(ConsentChannel).default(ConsentChannel.WHATSAPP),
  reason: z.nativeEnum(SuppressionReason).default(SuppressionReason.OPT_OUT),
  notes: optionalText(1000),
});
export type SuppressInput = z.infer<typeof suppressSchema>;

export const unsuppressSchema = z.object({
  contactId: cuidSchema,
  channel: z.nativeEnum(ConsentChannel).default(ConsentChannel.WHATSAPP),
  // Motivo obrigatório: retirar alguém da lista de supressão é uma decisão de
  // compliance e precisa de justificativa registrada.
  reason: z.string().trim().min(5, 'Descreva o motivo da remoção.').max(1000),
});
export type UnsuppressInput = z.infer<typeof unsuppressSchema>;

export const tagNameSchema = z
  .string()
  .trim()
  .min(1, 'Informe o nome da tag.')
  .max(48, 'Nome de tag longo demais.');

export const listNameSchema = z
  .string()
  .trim()
  .min(1, 'Informe o nome da lista.')
  .max(80, 'Nome de lista longo demais.');

export const attachTagSchema = z.object({
  contactId: cuidSchema,
  tagId: cuidSchema.optional(),
  tagName: tagNameSchema.optional(),
});

export const detachTagSchema = z.object({ contactId: cuidSchema, tagId: cuidSchema });

export const attachListSchema = z.object({
  contactId: cuidSchema,
  listId: cuidSchema.optional(),
  listName: listNameSchema.optional(),
});

export const detachListSchema = z.object({ contactId: cuidSchema, listId: cuidSchema });

// ---------------------------------------------------------------------------
// Consulta da listagem
// ---------------------------------------------------------------------------

export const CONTACTS_PAGE_SIZE = 25;

export const contactFiltersSchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.nativeEnum(ContactStatus).optional(),
  tagId: cuidSchema.optional(),
  listId: cuidSchema.optional(),
  city: z.string().trim().max(120).optional(),
  source: z.string().trim().max(120).optional(),
  consent: z.nativeEnum(ConsentStatus).optional(),
  suppressed: z.enum(['yes', 'no']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type ContactFilters = z.infer<typeof contactFiltersSchema>;

export const batchActionSchema = z.object({
  contactIds: z.array(cuidSchema).min(1, 'Selecione ao menos um contato.').max(500),
  action: z.enum(['tag', 'list', 'archive', 'suppress']),
  tagName: tagNameSchema.optional(),
  listName: listNameSchema.optional(),
});
export type BatchActionInput = z.infer<typeof batchActionSchema>;
