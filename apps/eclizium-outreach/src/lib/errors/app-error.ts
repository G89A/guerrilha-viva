/**
 * Application error taxonomy. Every failure that crosses a boundary (server
 * action, route handler) is expressed as one of these codes so the UI can react
 * without string-matching messages.
 */
export type AppErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'NOT_CONFIGURED'
  | 'PROVIDER_ERROR'
  | 'INTERNAL_ERROR';

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  VALIDATION_ERROR: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  NOT_CONFIGURED: 503,
  PROVIDER_ERROR: 502,
  INTERNAL_ERROR: 500,
};

export interface AppErrorOptions {
  /** Field-level messages, keyed by form field name. */
  fieldErrors?: Record<string, string[]>;
  /** Non-sensitive structured detail safe to return to the caller. */
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly fieldErrors?: Record<string, string[]>;
  readonly details?: Record<string, unknown>;

  constructor(code: AppErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    if (options.fieldErrors) this.fieldErrors = options.fieldErrors;
    if (options.details) this.details = options.details;
  }

  static validation(message: string, fieldErrors?: Record<string, string[]>): AppError {
    return new AppError('VALIDATION_ERROR', message, fieldErrors ? { fieldErrors } : {});
  }

  static unauthenticated(message = 'Autenticação necessária.'): AppError {
    return new AppError('UNAUTHENTICATED', message);
  }

  static forbidden(message = 'Você não tem permissão para esta ação.'): AppError {
    return new AppError('FORBIDDEN', message);
  }

  static notFound(message = 'Recurso não encontrado.'): AppError {
    return new AppError('NOT_FOUND', message);
  }

  static conflict(message: string, details?: Record<string, unknown>): AppError {
    return new AppError('CONFLICT', message, details ? { details } : {});
  }

  static notConfigured(message: string, details?: Record<string, unknown>): AppError {
    return new AppError('NOT_CONFIGURED', message, details ? { details } : {});
  }

  static internal(message = 'Erro interno.', cause?: unknown): AppError {
    return new AppError('INTERNAL_ERROR', message, cause === undefined ? {} : { cause });
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
