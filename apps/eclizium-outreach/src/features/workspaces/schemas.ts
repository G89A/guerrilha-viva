import { z } from 'zod';
import { cuidSchema, workspaceNameSchema } from '@/lib/validation/common';

export const createWorkspaceSchema = z.object({
  name: workspaceNameSchema,
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

export const switchWorkspaceSchema = z.object({
  workspaceId: cuidSchema,
});
export type SwitchWorkspaceInput = z.infer<typeof switchWorkspaceSchema>;

export const updateWorkspaceSchema = z.object({
  name: workspaceNameSchema,
});
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
