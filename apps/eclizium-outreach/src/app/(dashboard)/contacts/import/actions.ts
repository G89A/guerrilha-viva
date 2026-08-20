'use server';

import { revalidatePath } from 'next/cache';
import { ConsentStatus } from '@prisma/client';
import { z } from 'zod';
import { CSV_MAX_BYTES } from '@/features/contacts/csv/parse';
import { MAPPABLE_FIELDS } from '@/features/contacts/csv/mapping';
import {
  importContactsFromCsv,
  type ImportReport,
} from '@/features/contacts/csv/import-service';
import { writeAuditLog } from '@/lib/audit/audit-log';
import { requireWorkspaceRole } from '@/lib/auth/guards';
import { WorkspaceRole } from '@/lib/auth/roles';
import { runAction, type ActionResult } from '@/lib/errors/result';
import { assertWithinLimit, InMemoryRateLimiter } from '@/lib/security/rate-limit';
import { assertSameOriginRequest } from '@/lib/security/request-context';
import { parseOrThrow } from '@/lib/validation/parse';

/**
 * Importação é cara: parse, validação e centenas de inserts. Limitar por
 * workspace evita que a rota seja usada como bomba de carga.
 * Mesma limitação de escopo do ADR 0004 (contador por processo).
 */
const importRateLimiter = new InMemoryRateLimiter(5, 10 * 60 * 1000);

const mappingSchema = z.record(
  z.enum(MAPPABLE_FIELDS),
  z.coerce.number().int().min(0).max(59),
);

const importSchema = z.object({
  csv: z.string().min(1, 'Envie um arquivo CSV.').max(CSV_MAX_BYTES, 'Arquivo grande demais.'),
  mapping: mappingSchema,
  source: z.string().trim().min(1, 'Informe a origem dos contatos.').max(120),
  whatsappConsent: z.nativeEnum(ConsentStatus),
});

export type ImportActionState = ActionResult<ImportReport> | null;

/**
 * Recebe o CSV bruto e o mapeamento confirmado pelo usuário.
 *
 * O preview e a validação mostrados no navegador são conveniência: este
 * handler reparseia e revalida o arquivo inteiro no servidor antes de gravar
 * qualquer linha.
 */
export async function importContactsAction(
  _previous: ImportActionState,
  formData: FormData,
): Promise<ImportActionState> {
  return runAction('contacts.import', async () => {
    await assertSameOriginRequest();
    const context = await requireWorkspaceRole(WorkspaceRole.MEMBER);

    assertWithinLimit(importRateLimiter.check(context.workspace.id));

    const rawMapping = formData.get('mapping');
    let mapping: unknown;
    try {
      mapping = JSON.parse(typeof rawMapping === 'string' ? rawMapping : '{}');
    } catch {
      mapping = {};
    }

    const input = parseOrThrow(importSchema, {
      csv: formData.get('csv'),
      mapping,
      source: formData.get('source'),
      whatsappConsent: formData.get('whatsappConsent'),
    });

    await writeAuditLog({
      action: 'contact.import_started',
      resourceType: 'ContactImport',
      workspaceId: context.workspace.id,
      actorUserId: context.user.id,
      metadata: { source: input.source, consent: input.whatsappConsent, bytes: input.csv.length },
    });

    const report = await importContactsFromCsv({
      workspaceId: context.workspace.id,
      phoneRegion: context.workspace.defaultPhoneRegion,
      csv: input.csv,
      mapping: input.mapping,
      source: input.source,
      whatsappConsent: input.whatsappConsent,
    });

    await writeAuditLog({
      action: 'contact.import_completed',
      resourceType: 'ContactImport',
      workspaceId: context.workspace.id,
      actorUserId: context.user.id,
      metadata: {
        source: input.source,
        imported: report.imported,
        skipped: report.skipped,
        failed: report.failed,
        total: report.summary.total,
        invalid: report.summary.invalid,
        duplicateInFile: report.summary.duplicateInFile,
        duplicateInDatabase: report.summary.duplicateInDatabase,
      },
    });

    revalidatePath('/contacts');
    return report;
  });
}
