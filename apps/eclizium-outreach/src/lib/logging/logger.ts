import { redact } from '@/lib/logging/redact';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = Record<string, unknown>;

export interface LogRecord {
  level: LogLevel;
  message: string;
  timestamp: string;
  [key: string]: unknown;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type LogSink = (record: LogRecord) => void;

function defaultSink(record: LogRecord): void {
  const line = JSON.stringify(record);
  if (record.level === 'error') {
    console.error(line);
  } else if (record.level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  child(context: LogContext): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  base?: LogContext;
  sink?: LogSink;
  now?: () => Date;
}

/**
 * Structured JSON logger. Every value passed through `context` is redacted
 * before it reaches the sink, so a caller cannot accidentally log a token.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const base = options.base ?? {};
  const sink = options.sink ?? defaultSink;
  const now = options.now ?? (() => new Date());

  function emit(recordLevel: LogLevel, message: string, context?: LogContext): void {
    if (LEVEL_WEIGHT[recordLevel] < LEVEL_WEIGHT[level]) return;

    const merged = redact({ ...base, ...(context ?? {}) }) as LogContext;
    sink({
      ...merged,
      level: recordLevel,
      message,
      timestamp: now().toISOString(),
    });
  }

  return {
    debug: (message, context) => emit('debug', message, context),
    info: (message, context) => emit('info', message, context),
    warn: (message, context) => emit('warn', message, context),
    error: (message, context) => emit('error', message, context),
    child: (context) =>
      createLogger({
        level,
        base: { ...base, ...context },
        sink,
        ...(options.now ? { now: options.now } : {}),
      }),
  };
}

function resolveLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL;
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw;
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

/** Process-wide application logger. Prefer `logger.child({...})` per request. */
export const logger: Logger = createLogger({
  level: resolveLevel(),
  base: { service: 'eclizium-outreach' },
});
