'use server';

import { z } from 'zod';
import { requireWorkspaceRole } from '@/lib/auth/guards';
import { WorkspaceRole } from '@/lib/auth/roles';
import { runAction, type ActionResult } from '@/lib/errors/result';
import { parseOrThrow } from '@/lib/validation/parse';
import { cuidSchema } from '@/lib/validation/common';
import { buildRange, parseRangeDays, parseTimeZone } from '@/features/analytics/range';
import { listAuditEntries, type AuditPage } from '@/features/analytics/audit-query';

const pageSchema = z.object({
  cursor: cuidSchema,
  acao: z.string().max(80).optional(),
  recurso: z.string().max(80).optional(),
  ator: z.string().max(64).optional(),
  dias: z.string().max(8).optional(),
  fuso: z.string().max(64).optional(),
});

/** Próxima página do registro. Exige ADMIN, como a tela. */
export async function loadMoreAuditAction(raw: unknown): Promise<ActionResult<AuditPage>> {
  return runAction('audit.load_more', async () => {
    const context = await requireWorkspaceRole(WorkspaceRole.ADMIN);
    const input = parseOrThrow(pageSchema, raw);

    const range = buildRange({
      days: parseRangeDays(input.dias),
      timeZone: parseTimeZone(input.fuso),
    });

    return listAuditEntries(
      context.workspace.id,
      {
        ...(input.acao ? { action: input.acao } : {}),
        ...(input.recurso ? { resourceType: input.recurso } : {}),
        ...(input.ator ? { actorUserId: input.ator } : {}),
        from: range.from,
        to: range.to,
      },
      { cursor: input.cursor },
    );
  });
}
