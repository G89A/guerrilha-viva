import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';

/**
 * Respostas prontas do workspace.
 *
 * Texto puro e nada mais. Inserir uma resposta rápida PREENCHE o compositor —
 * nunca envia sozinha. Um atalho que dispara mensagem sem o operador confirmar
 * seria uma mensagem enviada por acidente para uma pessoa real.
 */

export const MAX_QUICK_REPLY_TITLE = 60;
export const MAX_QUICK_REPLY_BODY = 1_000;

export interface QuickReplyItem {
  id: string;
  title: string;
  body: string;
}

export async function listQuickReplies(workspaceId: string): Promise<QuickReplyItem[]> {
  return prisma.quickReply.findMany({
    where: { workspaceId },
    orderBy: { title: 'asc' },
    select: { id: true, title: true, body: true },
  });
}

export type QuickReplyOutcome =
  | { ok: true; id: string }
  | { ok: false; reason: string };

export async function createQuickReply(input: {
  workspaceId: string;
  title: string;
  body: string;
  createdById: string;
}): Promise<QuickReplyOutcome> {
  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length === 0 || body.length === 0) {
    return { ok: false, reason: 'Título e texto são obrigatórios.' };
  }

  try {
    const created = await prisma.quickReply.create({
      data: {
        workspaceId: input.workspaceId,
        title: title.slice(0, MAX_QUICK_REPLY_TITLE),
        body: body.slice(0, MAX_QUICK_REPLY_BODY),
        createdById: input.createdById,
      },
      select: { id: true },
    });
    return { ok: true, id: created.id };
  } catch (error) {
    // A unique `(workspaceId, title)` é quem decide o empate entre dois
    // cadastros simultâneos do mesmo título — não uma leitura prévia.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, reason: 'Já existe uma resposta rápida com esse título.' };
    }
    throw error;
  }
}

export async function updateQuickReply(input: {
  workspaceId: string;
  id: string;
  title: string;
  body: string;
}): Promise<QuickReplyOutcome> {
  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length === 0 || body.length === 0) {
    return { ok: false, reason: 'Título e texto são obrigatórios.' };
  }

  try {
    // `updateMany` com o workspace no filtro: `update` por id sozinho alcançaria
    // a resposta rápida de outro tenant.
    const result = await prisma.quickReply.updateMany({
      where: { id: input.id, workspaceId: input.workspaceId },
      data: {
        title: title.slice(0, MAX_QUICK_REPLY_TITLE),
        body: body.slice(0, MAX_QUICK_REPLY_BODY),
      },
    });
    if (result.count === 0) return { ok: false, reason: 'Resposta rápida não encontrada.' };
    return { ok: true, id: input.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, reason: 'Já existe uma resposta rápida com esse título.' };
    }
    throw error;
  }
}

export async function deleteQuickReply(
  workspaceId: string,
  id: string,
): Promise<{ deleted: boolean }> {
  const result = await prisma.quickReply.deleteMany({ where: { id, workspaceId } });
  return { deleted: result.count > 0 };
}
