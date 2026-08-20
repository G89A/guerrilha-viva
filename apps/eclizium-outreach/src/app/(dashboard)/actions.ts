'use server';

import { revalidatePath } from 'next/cache';
import { switchWorkspaceSchema, updateWorkspaceSchema } from '@/features/workspaces/schemas';
import { renameWorkspace } from '@/features/workspaces/service';
import { writeAuditLog } from '@/lib/audit/audit-log';
import { assertWorkspaceMembership, requireUser, requireWorkspaceRole } from '@/lib/auth/guards';
import { WorkspaceRole } from '@/lib/auth/roles';
import { setActiveWorkspace } from '@/lib/auth/session';
import { runAction, type ActionResult } from '@/lib/errors/result';
import { assertSameOriginRequest } from '@/lib/security/request-context';
import { formDataToObject, parseOrThrow } from '@/lib/validation/parse';

/**
 * Switches the session's active workspace.
 *
 * The `workspaceId` here DOES come from the client — that is unavoidable for a
 * switcher — so it is treated as a claim, not a fact:
 * `assertWorkspaceMembership` re-derives the user's right to it server-side and
 * refuses otherwise. Nothing downstream ever reads a workspace id from input.
 */
export async function switchWorkspaceAction(formData: FormData): Promise<ActionResult<null>> {
  return runAction('workspace.switch', async () => {
    await assertSameOriginRequest();

    const { user, session } = await requireUser();
    const input = parseOrThrow(switchWorkspaceSchema, formDataToObject(formData));

    await assertWorkspaceMembership(user.id, input.workspaceId);
    await setActiveWorkspace(session.id, input.workspaceId);

    await writeAuditLog({
      action: 'workspace.switched',
      resourceType: 'Workspace',
      resourceId: input.workspaceId,
      workspaceId: input.workspaceId,
      actorUserId: user.id,
    });

    revalidatePath('/', 'layout');
    return null;
  });
}

export async function renameWorkspaceAction(
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  return runAction('workspace.rename', async () => {
    await assertSameOriginRequest();

    const context = await requireWorkspaceRole(WorkspaceRole.ADMIN);
    const input = parseOrThrow(updateWorkspaceSchema, formDataToObject(formData));

    const previousName = context.workspace.name;
    await renameWorkspace(context.workspace.id, input.name);

    await writeAuditLog({
      action: 'workspace.updated',
      resourceType: 'Workspace',
      resourceId: context.workspace.id,
      workspaceId: context.workspace.id,
      actorUserId: context.user.id,
      metadata: { from: previousName, to: input.name },
    });

    revalidatePath('/', 'layout');
    return null;
  });
}
