import { AppError, isAppError, type AppErrorCode } from '@/lib/errors/app-error';
import { logger } from '@/lib/logging/logger';

/**
 * Discriminated result returned by every server action. Actions never throw
 * across the RSC boundary: a thrown error in production is opaque to the
 * client, which makes for useless form UX.
 */
export type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: AppErrorCode;
        message: string;
        fieldErrors?: Record<string, string[]>;
        details?: Record<string, unknown>;
      };
    };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(error: AppError): ActionResult<never> {
  return {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
      ...(error.details ? { details: error.details } : {}),
    },
  };
}

/**
 * Runs `fn`, converting any thrown value into an `ActionResult`. Unexpected
 * errors are logged in full and reported to the caller as a generic
 * INTERNAL_ERROR so internals never leak into the UI.
 */
export async function runAction<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    return ok(await fn());
  } catch (error) {
    if (isAppError(error)) {
      logger.warn('action.rejected', { action: name, code: error.code, message: error.message });
      return fail(error);
    }
    logger.error('action.failed', { action: name, error });
    return fail(AppError.internal());
  }
}
