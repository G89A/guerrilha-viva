'use server';

import { revalidatePath } from 'next/cache';
import { requireWorkspaceRole } from '@/lib/auth/guards';
import { WorkspaceRole } from '@/lib/auth/roles';
import { runAction, type ActionResult } from '@/lib/errors/result';
import { assertSameOriginRequest } from '@/lib/security/request-context';
import { formDataToObject, parseOrThrow } from '@/lib/validation/parse';
import { writeAuditLog } from '@/lib/audit/audit-log';
import { assertWithinLimit, InMemoryRateLimiter } from '@/lib/security/rate-limit';
import { configureChannelSchema } from '@/features/messaging/schemas';
import {
  configureChannel,
  disconnectChannel,
  requireChannel,
  testChannelConnection,
} from '@/features/messaging/channel-service';
import { syncTemplates } from '@/features/messaging/template-sync';
import { AppError } from '@/lib/errors/app-error';
import { z } from 'zod';
import { cuidSchema } from '@/lib/validation/common';
import { requeueEvent } from '@/features/webhooks/processor';

/**
 * Ações da integração Meta.
 *
 * RBAC: configurar e desconectar exigem OWNER; testar e sincronizar exigem
 * ADMIN. A UI esconde botões, mas a autorização é decidida aqui — a interface
 * nunca é a barreira.
 */

/** Verificar conexão e sincronizar batem na Meta: têm teto por workspace. */
const connectionLimiter = new InMemoryRateLimiter(10, 5 * 60 * 1000);
const syncLimiter = new InMemoryRateLimiter(6, 5 * 60 * 1000);

export async function configureIntegrationAction(
  _previous: ActionResult<{ channelId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ channelId: string }>> {
  return runAction('messaging.configure', async () => {
    await assertSameOriginRequest();
    const context = await requireWorkspaceRole(WorkspaceRole.OWNER);
    const input = parseOrThrow(configureChannelSchema, formDataToObject(formData));

    const channel = await configureChannel({
      workspaceId: context.workspace.id,
      displayName: input.displayName,
      wabaId: input.wabaId,
      phoneNumberId: input.phoneNumberId,
      graphApiVersion: input.graphApiVersion,
      environment: input.environment,
      credentialSource: input.credentialSource,
      accessToken: input.accessToken,
    });

    await writeAuditLog({
      action: 'messaging.integration_configured',
      resourceType: 'MessagingChannel',
      resourceId: channel.id,
      workspaceId: context.workspace.id,
      actorUserId: context.user.id,
      // Identificadores são administrativos; o token jamais entra em metadata.
      metadata: {
        wabaId: channel.wabaId,
        phoneNumberId: channel.phoneNumberId,
        environment: channel.environment,
        graphApiVersion: channel.graphApiVersion,
        credentialSource: channel.credentialSource,
      },
    });

    revalidatePath('/settings/integrations');
    return { channelId: channel.id };
  });
}

export async function testConnectionAction(): Promise<
  ActionResult<{ ok: boolean; message: string }>
> {
  return runAction('messaging.test_connection', async () => {
    await assertSameOriginRequest();
    const context = await requireWorkspaceRole(WorkspaceRole.ADMIN);
    assertWithinLimit(connectionLimiter.check(`connection:${context.workspace.id}`));

    const channel = await requireChannel(context.workspace.id);
    const outcome = await testChannelConnection(channel);

    await writeAuditLog({
      action: outcome.ok ? 'messaging.connection_tested' : 'messaging.connection_failed',
      resourceType: 'MessagingChannel',
      resourceId: channel.id,
      workspaceId: context.workspace.id,
      actorUserId: context.user.id,
      metadata: {
        status: outcome.status,
        errorCode: outcome.errorCode,
        checks: outcome.result?.checks.map((check) => ({ name: check.name, ok: check.ok })) ?? [],
      },
    });

    revalidatePath('/settings/integrations');
    return { ok: outcome.ok, message: outcome.message };
  });
}

export async function syncTemplatesAction(): Promise<
  ActionResult<{ fetched: number; created: number; updated: number; markedUnavailable: number }>
> {
  return runAction('messaging.sync_templates', async () => {
    await assertSameOriginRequest();
    const context = await requireWorkspaceRole(WorkspaceRole.ADMIN);
    assertWithinLimit(syncLimiter.check(`sync:${context.workspace.id}`));

    const channel = await requireChannel(context.workspace.id);

    await writeAuditLog({
      action: 'messaging.templates_sync_started',
      resourceType: 'MessagingChannel',
      resourceId: channel.id,
      workspaceId: context.workspace.id,
      actorUserId: context.user.id,
      metadata: {},
    });

    try {
      const report = await syncTemplates(channel);

      await writeAuditLog({
        action: 'messaging.templates_sync_completed',
        resourceType: 'MessagingChannel',
        resourceId: channel.id,
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        metadata: { ...report },
      });

      revalidatePath('/templates');
      revalidatePath('/settings/integrations');
      return report;
    } catch (error) {
      await writeAuditLog({
        action: 'messaging.templates_sync_failed',
        resourceType: 'MessagingChannel',
        resourceId: channel.id,
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        metadata: { reason: error instanceof AppError ? error.code : 'PROVIDER_ERROR' },
      });
      throw error;
    }
  });
}

export async function disconnectIntegrationAction(): Promise<ActionResult<{ ok: true }>> {
  return runAction('messaging.disconnect', async () => {
    await assertSameOriginRequest();
    const context = await requireWorkspaceRole(WorkspaceRole.OWNER);
    const channel = await requireChannel(context.workspace.id);

    await disconnectChannel(channel);

    await writeAuditLog({
      action: 'messaging.integration_disconnected',
      resourceType: 'MessagingChannel',
      resourceId: channel.id,
      workspaceId: context.workspace.id,
      actorUserId: context.user.id,
      metadata: {},
    });

    revalidatePath('/settings/integrations');
    return { ok: true as const };
  });
}

const requeueSchema = z.object({ eventId: cuidSchema });

/**
 * Reenfileira um evento de webhook que falhou.
 *
 * Não reprocessa aqui: cria o job e deixa o worker aplicar, para que
 * reprocessar pela tela siga exatamente o mesmo caminho do processamento
 * normal — inclusive retentativa e carta morta.
 */
export async function requeueWebhookEventAction(
  formData: FormData,
): Promise<ActionResult<{ requeued: boolean; reason?: string }>> {
  return runAction('webhook.requeue', async () => {
    await assertSameOriginRequest();
    const context = await requireWorkspaceRole(WorkspaceRole.ADMIN);
    const input = parseOrThrow(requeueSchema, formDataToObject(formData));

    const result = await requeueEvent(context.workspace.id, input.eventId);

    if (result.requeued) {
      await writeAuditLog({
        action: 'webhook.requeued',
        resourceType: 'WebhookEvent',
        resourceId: input.eventId,
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        metadata: {},
      });
    }

    revalidatePath('/settings/integrations');
    return result.reason ? { requeued: false, reason: result.reason } : { requeued: true };
  });
}
