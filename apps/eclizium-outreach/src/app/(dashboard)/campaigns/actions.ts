'use server';

import { revalidatePath } from 'next/cache';
import { requireWorkspaceRole } from '@/lib/auth/guards';
import { WorkspaceRole } from '@/lib/auth/roles';
import { runAction, type ActionResult } from '@/lib/errors/result';
import { assertSameOriginRequest } from '@/lib/security/request-context';
import { formDataToObject, parseOrThrow } from '@/lib/validation/parse';
import { assertWithinLimit, InMemoryRateLimiter } from '@/lib/security/rate-limit';
import { writeAuditLog } from '@/lib/audit/audit-log';
import {
  campaignIdSchema,
  createCampaignSchema,
  scheduleCampaignSchema,
  updateCampaignSchema,
} from '@/features/campaigns/schemas';
import {
  cancelCampaign,
  createCampaign,
  pauseCampaign,
  prepareCampaign,
  resumeCampaign,
  scheduleCampaign,
  startCampaign,
  updateCampaign,
} from '@/features/campaigns/campaign-service';
import {
  estimateAudience,
  type AudienceEstimate,
} from '@/features/campaigns/audience-service';
import { audienceFiltersSchema } from '@/features/campaigns/schemas';
import { reconcileCampaignMetrics } from '@/features/campaigns/metrics';
import { prisma } from '@/lib/db/client';

/**
 * Ações de campanha.
 *
 * RBAC: criar, editar e operar exigem ADMIN. MEMBER e VIEWER só leem — uma
 * campanha alcança milhares de pessoas de uma vez, e esse não é um botão para
 * qualquer um do time.
 *
 * NENHUMA ação aqui envia mensagem. A execução entra na Sprint 5.
 */

/** Preparar percorre a base inteira; tem teto por workspace. */
const prepareLimiter = new InMemoryRateLimiter(20, 5 * 60 * 1000);

/** Campos JSON chegam como texto no formulário; viram objeto antes do Zod. */
function parseJsonField(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export async function createCampaignAction(
  _previous: ActionResult<{ campaignId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ campaignId: string }>> {
  return runAction('campaign.create', async () => {
    await assertSameOriginRequest();
    const context = await requireWorkspaceRole(WorkspaceRole.ADMIN);

    const raw = formDataToObject(formData);
    const input = parseOrThrow(createCampaignSchema, {
      ...raw,
      audienceFilters: parseJsonField(raw.audienceFilters),
      variableMap: parseJsonField(raw.variableMap),
      variableFallbacks: parseJsonField(raw.variableFallbacks),
    });

    const campaign = await createCampaign({
      workspaceId: context.workspace.id,
      actorUserId: context.user.id,
      name: input.name,
      description: input.description,
      templateId: input.templateId,
      audienceFilters: input.audienceFilters,
      variableMap: input.variableMap,
      variablePolicy: input.variablePolicy,
      variableFallbacks: input.variableFallbacks,
    });

    await writeAuditLog({
      action: 'campaign.created',
      resourceType: 'Campaign',
      resourceId: campaign.id,
      workspaceId: context.workspace.id,
      actorUserId: context.user.id,
      metadata: { name: campaign.name, templateId: campaign.templateId },
    });

    revalidatePath('/campaigns');
    return { campaignId: campaign.id };
  });
}

export async function updateCampaignAction(
  _previous: ActionResult<{ campaignId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ campaignId: string }>> {
  return runAction('campaign.update', async () => {
    await assertSameOriginRequest();
    const context = await requireWorkspaceRole(WorkspaceRole.ADMIN);

    const raw = formDataToObject(formData);
    const input = parseOrThrow(updateCampaignSchema, {
      ...raw,
      audienceFilters: parseJsonField(raw.audienceFilters),
      variableMap: parseJsonField(raw.variableMap),
      variableFallbacks: parseJsonField(raw.variableFallbacks),
    });

    await updateCampaign(context.workspace.id, input.campaignId, {
      name: input.name,
      description: input.description,
      templateId: input.templateId,
      audienceFilters: input.audienceFilters,
      variableMap: input.variableMap,
      variablePolicy: input.variablePolicy,
      variableFallbacks: input.variableFallbacks,
    });

    await writeAuditLog({
      action: 'campaign.updated',
      resourceType: 'Campaign',
      resourceId: input.campaignId,
      workspaceId: context.workspace.id,
      actorUserId: context.user.id,
      metadata: { name: input.name },
    });

    revalidatePath(`/campaigns/${input.campaignId}`);
    return { campaignId: input.campaignId };
  });
}

export interface PrepareActionResult {
  total: number;
  eligible: number;
  suppressed: number;
  invalid: number;
  ineligible: number;
  byReason: Record<string, number>;
  created: number;
  dryRun: boolean;
  durationMs: number;
}

/** `dryRun` roda tudo e não grava nada. ZERO chamadas à Meta em ambos os modos. */
export async function prepareCampaignAction(
  campaignId: string,
  dryRun: boolean,
): Promise<ActionResult<PrepareActionResult>> {
  return runAction('campaign.prepare', async () => {
    await assertSameOriginRequest();
    const context = await requireWorkspaceRole(WorkspaceRole.ADMIN);
    const input = parseOrThrow(campaignIdSchema, { campaignId });

    assertWithinLimit(prepareLimiter.check(`prepare:${context.workspace.id}`));

    const report = await prepareCampaign({
      workspaceId: context.workspace.id,
      campaignId: input.campaignId,
      actorUserId: context.user.id,
      dryRun,
    });

    await writeAuditLog({
      action: dryRun ? 'campaign.dry_run' : 'campaign.prepared',
      resourceType: 'Campaign',
      resourceId: input.campaignId,
      workspaceId: context.workspace.id,
      actorUserId: context.user.id,
      metadata: {
        total: report.breakdown.total,
        eligible: report.breakdown.eligible,
        suppressed: report.breakdown.suppressed,
        invalid: report.breakdown.invalid,
      },
    });

    revalidatePath(`/campaigns/${input.campaignId}`);
    revalidatePath('/campaigns');

    return {
      ...report.breakdown,
      created: report.created,
      dryRun: report.dryRun,
      durationMs: report.durationMs,
    };
  });
}

export async function estimateAudienceAction(
  filtersJson: string,
): Promise<ActionResult<AudienceEstimate>> {
  return runAction('campaign.estimate', async () => {
    await assertSameOriginRequest();
    const context = await requireWorkspaceRole(WorkspaceRole.ADMIN);
    const filters = parseOrThrow(audienceFiltersSchema, parseJsonField(filtersJson));

    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: context.workspace.id },
      select: { defaultPhoneRegion: true },
    });

    return estimateAudience(context.workspace.id, filters, workspace.defaultPhoneRegion);
  });
}

export async function scheduleCampaignAction(
  _previous: ActionResult<{ ok: true }> | null,
  formData: FormData,
): Promise<ActionResult<{ ok: true }>> {
  return runAction('campaign.schedule', async () => {
    await assertSameOriginRequest();
    const context = await requireWorkspaceRole(WorkspaceRole.ADMIN);
    const input = parseOrThrow(scheduleCampaignSchema, formDataToObject(formData));

    await scheduleCampaign({
      workspaceId: context.workspace.id,
      campaignId: input.campaignId,
      scheduledAt: input.scheduledAt,
      timezone: input.timezone,
    });

    await writeAuditLog({
      action: 'campaign.scheduled',
      resourceType: 'Campaign',
      resourceId: input.campaignId,
      workspaceId: context.workspace.id,
      actorUserId: context.user.id,
      metadata: { scheduledAt: input.scheduledAt.toISOString(), timezone: input.timezone },
    });

    revalidatePath(`/campaigns/${input.campaignId}`);
    return { ok: true as const };
  });
}

type LifecycleAction = 'start' | 'pause' | 'resume' | 'cancel';

const LIFECYCLE_AUDIT = {
  start: 'campaign.started',
  pause: 'campaign.paused',
  resume: 'campaign.resumed',
  cancel: 'campaign.cancelled',
} as const;

/**
 * Ações de ciclo de vida. `start` apenas MARCA a campanha como em execução —
 * nenhuma mensagem sai daqui.
 */
export async function lifecycleAction(
  campaignId: string,
  action: LifecycleAction,
): Promise<ActionResult<{ status: string; cancelledRecipients?: number }>> {
  return runAction(`campaign.${action}`, async () => {
    await assertSameOriginRequest();
    const context = await requireWorkspaceRole(WorkspaceRole.ADMIN);
    const input = parseOrThrow(campaignIdSchema, { campaignId });

    const outcome = await runLifecycle(action, context.workspace.id, input.campaignId);

    await writeAuditLog({
      action: LIFECYCLE_AUDIT[action],
      resourceType: 'Campaign',
      resourceId: input.campaignId,
      workspaceId: context.workspace.id,
      actorUserId: context.user.id,
      metadata: { status: outcome.status },
    });

    await reconcileCampaignMetrics(context.workspace.id, input.campaignId);

    revalidatePath(`/campaigns/${input.campaignId}`);
    revalidatePath('/campaigns');
    return outcome;
  });
}

async function runLifecycle(
  action: LifecycleAction,
  workspaceId: string,
  campaignId: string,
): Promise<{ status: string; cancelledRecipients?: number }> {
  if (action === 'cancel') {
    const result = await cancelCampaign({ workspaceId, campaignId });
    return { status: result.campaign.status, cancelledRecipients: result.cancelledRecipients };
  }

  const runner = { start: startCampaign, pause: pauseCampaign, resume: resumeCampaign }[action];
  const campaign = await runner({ workspaceId, campaignId });
  return { status: campaign.status };
}
