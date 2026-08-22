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
import { updateSendingPolicy } from '@/features/protection/policy-service';
import { syncNumberHealth } from '@/features/protection/health-service';

const policySchema = z.object({
  optOutEnabled: z.union([z.literal('on'), z.literal('')]).optional(),
  optOutKeywords: z.string().max(500),
  frequencyCapMessages: z.coerce.number().int().min(1).max(100),
  frequencyCapWindowDays: z.coerce.number().int().min(1).max(365),
  quietHoursEnabled: z.union([z.literal('on'), z.literal('')]).optional(),
  quietHoursStart: z.coerce.number().int().min(0).max(23),
  quietHoursEnd: z.coerce.number().int().min(0).max(23),
  timeZone: z.string().min(1).max(64),
  pauseOnRedQuality: z.union([z.literal('on'), z.literal('')]).optional(),
  pauseOnYellowQuality: z.union([z.literal('on'), z.literal('')]).optional(),
});

export async function savePolicyAction(
  _previous: ActionResult<{ ok: true }> | null,
  formData: FormData,
): Promise<ActionResult<{ ok: true }>> {
  return runAction('sending_policy.save', async () => {
    await assertSameOriginRequest();
    // Política de envio é decisão de compliance do workspace, não de operação
    // diária: só quem administra muda.
    const context = await requireWorkspaceRole(WorkspaceRole.ADMIN);
    const input = parseOrThrow(policySchema, formDataToObject(formData));

    const outcome = await updateSendingPolicy(context.workspace.id, {
      optOutEnabled: input.optOutEnabled === 'on',
      optOutKeywords: input.optOutKeywords.split(',').map((keyword) => keyword.trim()),
      frequencyCapMessages: input.frequencyCapMessages,
      frequencyCapWindowDays: input.frequencyCapWindowDays,
      quietHoursEnabled: input.quietHoursEnabled === 'on',
      quietHoursStart: input.quietHoursStart,
      quietHoursEnd: input.quietHoursEnd,
      timeZone: input.timeZone,
      pauseOnRedQuality: input.pauseOnRedQuality === 'on',
      pauseOnYellowQuality: input.pauseOnYellowQuality === 'on',
    });

    if (!outcome.ok) {
      throw AppError.validation(outcome.reason ?? 'Política inválida.', {
        timeZone: [outcome.reason ?? 'Política inválida.'],
      });
    }

    await writeAuditLog({
      action: 'sending_policy.updated',
      resourceType: 'SendingPolicy',
      resourceId: context.workspace.id,
      workspaceId: context.workspace.id,
      actorUserId: context.user.id,
      metadata: {
        optOutEnabled: input.optOutEnabled === 'on',
        frequencyCapMessages: input.frequencyCapMessages,
        quietHoursEnabled: input.quietHoursEnabled === 'on',
      },
    });

    revalidatePath('/settings/protection');
    revalidatePath('/dashboard');
    return { ok: true as const };
  });
}

export async function syncHealthAction(): Promise<
  ActionResult<{ quality: string } | { blocked: string }>
> {
  return runAction('channel.sync_health', async () => {
    await assertSameOriginRequest();
    const context = await requireWorkspaceRole(WorkspaceRole.ADMIN);

    const outcome = await syncNumberHealth({
      workspaceId: context.workspace.id,
      actorUserId: context.user.id,
    });

    revalidatePath('/settings/protection');
    revalidatePath('/dashboard');

    if (!outcome.ok) return { blocked: outcome.reason };
    return { quality: outcome.quality };
  });
}
