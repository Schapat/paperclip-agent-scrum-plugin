/**
 * Logger Module for Worker
 *
 * Provides structured logging with different log levels and contexts.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  context?: string;
  timestamp: string;
  data?: unknown;
}

export interface LoggerConfig {
  level: LogLevel;
  prefix?: string;
  enableTimestamp?: boolean;
  handler?: (entry: LogEntry) => void;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Creates a structured logger instance
 */
export function createLogger(config: Partial<LoggerConfig> = {}): Logger {
  const {
    level = 'info',
    prefix = '[Worker]',
    enableTimestamp = true,
    handler,
  } = config;

  const minLevel = LOG_LEVEL_PRIORITY[level];

  function log(logLevel: LogLevel, message: string, data?: unknown): void {
    if (LOG_LEVEL_PRIORITY[logLevel] < minLevel) {
      return;
    }

    const entry: LogEntry = {
      level: logLevel,
      message,
      context: prefix,
      timestamp: new Date().toISOString(),
      data,
    };

    if (handler) {
      handler(entry);
      return;
    }

    const timestamp = enableTimestamp ? `[${entry.timestamp}]` : '';
    const formattedMessage = `${timestamp} ${prefix} [${logLevel.toUpperCase()}] ${message}`;

    switch (logLevel) {
      case 'debug':
        console.debug(formattedMessage, data !== undefined ? data : '');
        break;
      case 'info':
        console.info(formattedMessage, data !== undefined ? data : '');
        break;
      case 'warn':
        console.warn(formattedMessage, data !== undefined ? data : '');
        break;
      case 'error':
        console.error(formattedMessage, data !== undefined ? data : '');
        break;
    }
  }

  return {
    debug: (message: string, data?: unknown) => log('debug', message, data),
    info: (message: string, data?: unknown) => log('info', message, data),
    warn: (message: string, data?: unknown) => log('warn', message, data),
    error: (message: string, data?: unknown) => log('error', message, data),
    child: (childPrefix: string) =>
      createLogger({
        level,
        prefix: `${prefix}:${childPrefix}`,
        enableTimestamp,
        handler,
      }),
  };
}

export interface Logger {
  debug: (message: string, data?: unknown) => void;
  info: (message: string, data?: unknown) => void;
  warn: (message: string, data?: unknown) => void;
  error: (message: string, data?: unknown) => void;
  child: (childPrefix: string) => Logger;
}

/**
 * Default logger instance for the worker
 */
export const logger = createLogger({
  level: 'info',
  prefix: '[Worker]',
});

/**
 * Error formatter for consistent error logging
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`;
  }
  return String(error);
}

/**
 * Creates a log entry for API operations
 */
export function logApiOperation(
  operation: string,
  params: Record<string, unknown>,
  result?: { success: boolean; error?: string }
): LogEntry {
  return {
    level: result?.success === false ? 'error' : 'info',
    message: `API ${operation}`,
    context: 'API',
    timestamp: new Date().toISOString(),
    data: {
      params,
      result,
    },
  };
}
