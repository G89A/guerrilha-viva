'use server';

import { revalidatePath } from 'next/cache';
import { requireWorkspaceRole } from '@/lib/auth/guards';
import { WorkspaceRole } from '@/lib/auth/roles';
import { runAction, type ActionResult } from '@/lib/errors/result';
import { assertSameOriginRequest } from '@/lib/security/request-context';
import { formDataToObject, parseOrThrow } from '@/lib/validation/parse';
import { assertWithinLimit, InMemoryRateLimiter } from '@/lib/security/rate-limit';
import { sendTestMessageSchema } from '@/features/messaging/schemas';
import { sendTestMessage } from '@/features/messaging/send-service';
import type { EligibilityReason } from '@/features/messaging/eligibility';

/**
 * Envio manual de mensagem de teste.
 *
 * UMA mensagem, UM contato, com confirmação explícita. Não existe caminho aqui
 * para seleção múltipla ou laço de envio.
 */

/**
 * Teto de envios de teste por workspace. Não há razão legítima para centenas de
 * testes por minuto, e o limite protege a reputação do número.
 *
 * Isto NÃO é atraso para "parecer humano" — é limite de segurança operacional,
 * aplicado no servidor, previsível e documentado.
 */
const sendTestLimiter = new InMemoryRateLimiter(10, 10 * 60 * 1000);

export type SendTestResult =
  | { status: 'SENT'; providerMessageId: string; messageId: string }
  | { status: 'BLOCKED'; reasons: EligibilityReason[] }
  | { status: 'FAILED'; error: string; retryable: boolean };

export async function sendTestMessageAction(
  _previous: ActionResult<SendTestResult> | null,
  formData: FormData,
): Promise<ActionResult<SendTestResult>> {
  return runAction('messaging.send_test', async () => {
    await assertSameOriginRequest();
    const context = await requireWorkspaceRole(WorkspaceRole.ADMIN);

    const raw = formDataToObject(formData);
    // O mapeamento chega como JSON em um campo do formulário; é validado pelo
    // Zod como dado estruturado, nunca interpretado como código.
    const mapping = typeof raw.mapping === 'string' ? safeParseJson(raw.mapping) : {};
    const input = parseOrThrow(sendTestMessageSchema, { ...raw, mapping });

    assertWithinLimit(sendTestLimiter.check(`send-test:${context.workspace.id}`));

    const outcome = await sendTestMessage({
      workspaceId: context.workspace.id,
      actorUserId: context.user.id,
      contactId: input.contactId,
      templateId: input.templateId,
      mapping: input.mapping,
    });

    revalidatePath('/templates');

    if (outcome.ok) {
      return {
        status: 'SENT' as const,
        providerMessageId: outcome.providerMessageId,
        messageId: outcome.message.id,
      };
    }

    if (outcome.kind === 'BLOCKED') {
      return { status: 'BLOCKED' as const, reasons: outcome.eligibility.reasons };
    }

    return { status: 'FAILED' as const, error: outcome.error, retryable: outcome.retryable };
  });
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
