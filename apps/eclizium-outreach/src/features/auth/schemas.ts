import { z } from 'zod';
import {
  emailSchema,
  passwordSchema,
  personNameSchema,
  workspaceNameSchema,
} from '@/lib/validation/common';

export const registerSchema = z.object({
  name: personNameSchema,
  email: emailSchema,
  password: passwordSchema,
  workspaceName: workspaceNameSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  // Deliberately not `passwordSchema`: an existing password predating a policy
  // change must still be able to log in.
  password: z.string().min(1, 'Informe a senha.').max(256),
});
export type LoginInput = z.infer<typeof loginSchema>;
