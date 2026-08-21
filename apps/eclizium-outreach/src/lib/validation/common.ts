import { z } from 'zod';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/lib/auth/password';

/**
 * Identificador gerado pelo Prisma (`cuid`/`cuid2`): alfanumérico, sem
 * separadores. A forma é verificada na borda para que um valor malformado
 * — travessia de caminho, aspas, marcação — morra na validação em vez de
 * seguir viagem como se fosse um id.
 */
export const cuidSchema = z
  .string()
  .regex(/^[a-z0-9]{8,64}$/i, 'Identificador inválido.');

export const emailSchema = z
  .string()
  .trim()
  .min(3, 'Informe um e-mail.')
  .max(254, 'E-mail longo demais.')
  .email('E-mail inválido.')
  .transform((value) => value.toLowerCase());

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `A senha precisa ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`)
  .max(MAX_PASSWORD_LENGTH, 'Senha longa demais.')
  .refine((value) => /[a-zA-Z]/.test(value), 'A senha precisa conter ao menos uma letra.')
  .refine((value) => /[0-9]/.test(value), 'A senha precisa conter ao menos um número.');

export const personNameSchema = z
  .string()
  .trim()
  .min(2, 'Informe um nome.')
  .max(120, 'Nome longo demais.');

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(2, 'Informe o nome do workspace.')
  .max(80, 'Nome longo demais.');

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Slug curto demais.')
  .max(48, 'Slug longo demais.')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use apenas letras minúsculas, números e hífens.');
