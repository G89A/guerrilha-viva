'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireWorkspaceRole } from '@/lib/auth/guards';
import { WorkspaceRole } from '@/lib/auth/roles';
import { runAction, type ActionResult } from '@/lib/errors/result';
import { assertSameOriginRequest } from '@/lib/security/request-context';
import { formDataToObject, parseOrThrow } from '@/lib/validation/parse';
import { writeAuditLog } from '@/lib/audit/audit-log';
import { AppError } from '@/lib/errors/app-error';
import { cuidSchema } from '@/lib/validation/common';
import {
  createQuickReply,
  deleteQuickReply,
  MAX_QUICK_REPLY_BODY,
  MAX_QUICK_REPLY_TITLE,
  updateQuickReply,
} from '@/features/messaging/quick-reply-service';

const upsertSchema = z.object({
  id: cuidSchema.optional(),
  title: z.string().trim().min(1, 'Dê um título.').max(MAX_QUICK_REPLY_TITLE),
  body: z.string().trim().min(1, 'Escreva o texto.').max(MAX_QUICK_REPLY_BODY),
});

export async function saveQuickReplyAction(
  _previous: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return runAction('quick_reply.save', async () => {
    await assertSameOriginRequest();
    const context = await requireWorkspaceRole(WorkspaceRole.MEMBER);
    const input = parseOrThrow(upsertSchema, formDataToObject(formData));

    const outcome = input.id
      ? await updateQuickReply({
          workspaceId: context.workspace.id,
          id: input.id,
          title: input.title,
          body: input.body,
        })
      : await createQuickReply({
          workspaceId: context.workspace.id,
          title: input.title,
          body: input.body,
          createdById: context.user.id,
        });

    if (!outcome.ok) {
      throw AppError.validation(outcome.reason, { title: [outcome.reason] });
    }

    await writeAuditLog({
      action: input.id ? 'quick_reply.updated' : 'quick_reply.created',
      resourceType: 'QuickReply',
      resourceId: outcome.id,
      workspaceId: context.workspace.id,
      actorUserId: context.user.id,
      metadata: { title: input.title },
    });

    revalidatePath('/settings/quick-replies');
    revalidatePath('/inbox');
    return { id: outcome.id };
  });
}

const deleteSchema = z.object({ id: cuidSchema });

export async function deleteQuickReplyAction(
  formData: FormData,
): Promise<ActionResult<{ deleted: boolean }>> {
  return runAction('quick_reply.delete', async () => {
    await assertSameOriginRequest();
    const context = await requireWorkspaceRole(WorkspaceRole.MEMBER);
    const input = parseOrThrow(deleteSchema, formDataToObject(formData));

    const result = await deleteQuickReply(context.workspace.id, input.id);

    if (result.deleted) {
      await writeAuditLog({
        action: 'quick_reply.deleted',
        resourceType: 'QuickReply',
        resourceId: input.id,
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        metadata: {},
      });
    }

    revalidatePath('/settings/quick-replies');
    revalidatePath('/inbox');
    return { deleted: result.deleted };
  });
}
