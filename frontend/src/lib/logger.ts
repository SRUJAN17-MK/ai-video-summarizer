export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export type LogMeta = Record<string, unknown>;

const LEVELS: LogLevel[] = ['error', 'warn', 'info', 'debug'];
const BUFFER_SIZE = 200;

const minLevel: LogLevel = import.meta.env.DEV ? 'debug' : 'info';

interface BufferEntry {
  time: string;
  level: LogLevel;
  scope: string;
  message: string;
  meta?: LogMeta;
}

const buffer: BufferEntry[] = [];

function isEnabled(level: LogLevel): boolean {
  return LEVELS.indexOf(level) <= LEVELS.indexOf(minLevel);
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 23);
}

function emit(level: LogLevel, scope: string, message: string, meta?: LogMeta): void {
  const time = timestamp();
  buffer.push({ time, level, scope, message, meta });
  if (buffer.length > BUFFER_SIZE) buffer.shift();
  if (!isEnabled(level)) return;

  const line = `${time} ${level} [${scope}] ${message}`;
  const method =
    level === 'error' ? 'error' : level === 'warn' ? 'warn' : level === 'debug' ? 'debug' : 'log';
  if (meta !== undefined) console[method](line, meta);
  else console[method](line);
}

export interface Logger {
  error(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  debug(message: string, meta?: LogMeta): void;
  child(scope: string): Logger;
}

export function createLogger(scope: string): Logger {
  return {
    error: (message, meta) => emit('error', scope, message, meta),
    warn: (message, meta) => emit('warn', scope, message, meta),
    info: (message, meta) => emit('info', scope, message, meta),
    debug: (message, meta) => emit('debug', scope, message, meta),
    child: (next) => createLogger(scope ? `${scope}:${next}` : next),
  };
}

export const logger = createLogger('app');

/** Most recent log entries, newest last. Handy in the devtools console. */
export function recentLogs(): readonly BufferEntry[] {
  return [...buffer];
}
