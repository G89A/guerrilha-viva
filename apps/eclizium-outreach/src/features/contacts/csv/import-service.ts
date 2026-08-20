import 'server-only';
import { ConsentChannel, ConsentSource, ConsentStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { AppError } from '@/lib/errors/app-error';
import { logger } from '@/lib/logging/logger';
import { parseCsv, CSV_MAX_ROWS } from '@/features/contacts/csv/parse';
import type { ColumnMapping } from '@/features/contacts/csv/mapping';
import {
  classifyRows,
  summarize,
  type ClassifiedRow,
  type ClassificationSummary,
} from '@/features/contacts/csv/validate';

/** Inserções por transação. Mantém cada lote curto o bastante para não segurar
 *  conexão por muito tempo, e pequeno o bastante para o relatório ser preciso. */
const CHUNK_SIZE = 200;

export interface ImportOptions {
  workspaceId: string;
  phoneRegion: string;
  csv: string;
  mapping: ColumnMapping;
  source: string;
  whatsappConsent: ConsentStatus;
}

export interface ImportReport {
  summary: ClassificationSummary;
  imported: number;
  skipped: number;
  failed: number;
  /** Linhas não importadas, com o motivo. Limitado para não estourar a resposta. */
  rejected: ClassifiedRow[];
  rejectedTruncated: boolean;
}

const MAX_REPORTED_REJECTIONS = 500;

/**
 * Importa contatos a partir do texto bruto do CSV.
 *
 * O servidor RE-PARSEIA e RE-VALIDA o arquivo: o preview feito no navegador
 * serve à experiência do usuário, nunca como autorização. Tudo que decide o
 * que entra no banco é calculado aqui.
 *
 * A gravação acontece em lotes transacionais. Se um lote falhar, os anteriores
 * permanecem e a falha é contabilizada no relatório — nunca um estado parcial
 * silencioso.
 */
export async function importContactsFromCsv(options: ImportOptions): Promise<ImportReport> {
  if (options.mapping.phone === undefined) {
    throw AppError.validation('Mapeie a coluna de telefone antes de importar.', {
      mapping: ['A coluna de telefone é obrigatória.'],
    });
  }

  const parsed = parseCsv(options.csv);
  if (!parsed.ok) {
    throw AppError.validation(parsed.error.message, { file: [parsed.error.message] });
  }
  if (parsed.document.rows.length > CSV_MAX_ROWS) {
    throw AppError.validation(`O arquivo excede ${CSV_MAX_ROWS} linhas.`);
  }

  const candidatePhones = new Set<string>();
  const firstPass = classifyRows({
    rows: parsed.document.rows,
    mapping: options.mapping,
    phoneRegion: options.phoneRegion,
  });
  for (const row of firstPass.rows) {
    if (row.phoneE164) candidatePhones.add(row.phoneE164);
  }

  // Consulta única para deduplicação contra o banco, restrita aos telefones
  // que o arquivo realmente traz — nunca a tabela inteira.
  const existing = await prisma.contact.findMany({
    where: { workspaceId: options.workspaceId, phoneE164: { in: [...candidatePhones] } },
    select: { phoneE164: true },
  });
  const existingPhones = new Set(existing.map((row) => row.phoneE164));

  const classification = classifyRows({
    rows: parsed.document.rows,
    mapping: options.mapping,
    phoneRegion: options.phoneRegion,
    existingPhones,
  });

  const importable = classification.rows.filter((row) => row.status === 'VALID');
  const rejected = classification.rows.filter((row) => row.status !== 'VALID');

  let imported = 0;
  let failed = 0;

  for (let offset = 0; offset < importable.length; offset += CHUNK_SIZE) {
    const chunk = importable.slice(offset, offset + CHUNK_SIZE);
    try {
      imported += await insertChunk(chunk, options);
    } catch (error) {
      failed += chunk.length;
      logger.error('contacts.import_chunk_failed', {
        workspaceId: options.workspaceId,
        offset,
        size: chunk.length,
        error,
      });
    }
  }

  return {
    summary: summarize(classification.rows),
    imported,
    skipped: rejected.length,
    failed,
    rejected: rejected.slice(0, MAX_REPORTED_REJECTIONS),
    rejectedTruncated: rejected.length > MAX_REPORTED_REJECTIONS,
  };
}

async function insertChunk(chunk: ClassifiedRow[], options: ImportOptions): Promise<number> {
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    let inserted = 0;

    for (const row of chunk) {
      if (!row.phoneE164) continue;

      try {
        const contact = await tx.contact.create({
          data: {
            workspaceId: options.workspaceId,
            phoneE164: row.phoneE164,
            phone: row.values.phone,
            firstName: row.values.firstName,
            lastName: row.values.lastName,
            email: row.values.email?.toLowerCase() ?? null,
            company: row.values.company,
            segment: row.values.segment,
            city: row.values.city,
            state: row.values.state,
            country: row.values.country,
            notes: row.values.notes,
            source: options.source,
          },
        });

        await tx.contactConsent.create({
          data: {
            workspaceId: options.workspaceId,
            contactId: contact.id,
            channel: ConsentChannel.WHATSAPP,
            status: options.whatsappConsent,
            source: ConsentSource.CSV_IMPORT,
            proofReference: `import:${options.source}`,
            capturedAt: options.whatsappConsent === ConsentStatus.GRANTED ? now : null,
            revokedAt: options.whatsappConsent === ConsentStatus.REVOKED ? now : null,
          },
        });

        // Reconecta supressões órfãs do mesmo telefone (ver createContact).
        await tx.suppressionEntry.updateMany({
          where: {
            workspaceId: options.workspaceId,
            phoneE164: row.phoneE164,
            contactId: null,
          },
          data: { contactId: contact.id },
        });

        inserted += 1;
      } catch (error) {
        // Corrida com outra importação simultânea do mesmo número: a constraint
        // fez seu trabalho, a linha vira duplicada em vez de derrubar o lote.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          continue;
        }
        throw error;
      }
    }

    return inserted;
  });
}
