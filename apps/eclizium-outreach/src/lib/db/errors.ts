import { Prisma } from '@prisma/client';
import { AppError } from '@/lib/errors/app-error';

/** Postgres unique-violation surfaced by Prisma. */
export function isUniqueConstraintError(error: unknown, target?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== 'P2002') return false;
  if (!target) return true;

  const meta = error.meta as { target?: string[] | string } | undefined;
  const fields = Array.isArray(meta?.target) ? meta.target : meta?.target ? [meta.target] : [];
  return fields.some((field) => field.includes(target));
}

export function isNotFoundError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}

/** Maps a Prisma unique violation to a domain CONFLICT, rethrowing anything else. */
export function rethrowAsConflict(error: unknown, message: string, target?: string): never {
  if (isUniqueConstraintError(error, target)) {
    throw AppError.conflict(message);
  }
  throw error;
}
