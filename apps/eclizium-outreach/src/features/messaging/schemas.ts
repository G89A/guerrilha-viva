import { z } from 'zod';
import { ChannelEnvironment, CredentialSource } from '@prisma/client';
import { cuidSchema } from '@/lib/validation/common';
import { VARIABLE_SOURCES } from '@/features/messaging/template-render';

/** Só aceita `vNN.N`, o formato real das versões da Graph API. */
const graphVersionSchema = z
  .string()
  .trim()
  .regex(/^v\d{1,2}\.\d{1,2}$/, 'Use o formato vNN.N, por exemplo v21.0.');

/** Identificadores numéricos da Meta. Não são segredo, mas têm forma fixa. */
const metaIdSchema = z
  .string()
  .trim()
  .min(5, 'Identificador curto demais.')
  .max(64, 'Identificador longo demais.')
  .regex(/^\d+$/, 'O identificador da Meta contém apenas dígitos.');

export const configureChannelSchema = z
  .object({
    displayName: z.string().trim().min(1, 'Informe um nome.').max(80),
    wabaId: metaIdSchema,
    phoneNumberId: metaIdSchema,
    graphApiVersion: graphVersionSchema,
    environment: z.nativeEnum(ChannelEnvironment),
    credentialSource: z.nativeEnum(CredentialSource),
    // Aceita vazio: reconfigurar sem redigitar o token mantém o já cifrado.
    accessToken: z
      .string()
      .trim()
      .max(1000, 'Token longo demais.')
      .optional()
      .transform((value) => (value && value.length > 0 ? value : undefined)),
  })
  .refine(
    (value) => value.credentialSource !== CredentialSource.ENVIRONMENT || !value.accessToken,
    {
      message: 'Com credencial por ambiente, o token vem do env e não deve ser digitado aqui.',
      path: ['accessToken'],
    },
  );
export type ConfigureChannelInputSchema = z.infer<typeof configureChannelSchema>;

export const templateFiltersSchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(['UNKNOWN', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED']).optional(),
  category: z.enum(['UNKNOWN', 'MARKETING', 'UTILITY', 'AUTHENTICATION']).optional(),
  language: z.string().trim().max(20).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export type TemplateFilters = z.infer<typeof templateFiltersSchema>;

const variableBindingSchema = z.object({
  source: z.enum(VARIABLE_SOURCES),
  value: z.string().trim().max(500).optional(),
});

export const sendTestMessageSchema = z.object({
  templateId: cuidSchema,
  contactId: cuidSchema,
  /** Mapa `componente:chave` → origem. Validado como dado, nunca executado. */
  mapping: z.record(z.string().max(20), variableBindingSchema).default({}),
  /** Confirmação explícita: sem isto, nada é enviado. */
  confirmed: z.literal('true', {
    errorMap: () => ({ message: 'Confirme o envio antes de continuar.' }),
  }),
});
export type SendTestMessageInput = z.infer<typeof sendTestMessageSchema>;

export const TEMPLATES_PAGE_SIZE = 20;
