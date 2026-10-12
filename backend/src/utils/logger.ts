import fs from 'node:fs';
import path from 'node:path';
import winston from 'winston';
import { config } from '../config.js';

const LEVELS = ['error', 'warn', 'info', 'http', 'debug'] as const;
export type LogLevel = (typeof LEVELS)[number];

function resolveLevel(): LogLevel {
  const raw = config.log.level.toLowerCase();
  return (LEVELS as readonly string[]).includes(raw) ? (raw as LogLevel) : 'info';
}

function safeJson(meta: Record<string, unknown>): string {
  try {
    return JSON.stringify(meta);
  } catch {
    return '[unserializable metadata]';
  }
}

const humanFormat = winston.format.combine(
  winston.format.errors({ stack: true }),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ level, message, timestamp, tag, stack, ...meta }) => {
    const tagLabel = typeof tag === 'string' && tag ? ` [${tag}]` : '';
    const rest = Object.keys(meta).length > 0 ? ` ${safeJson(meta)}` : '';
    const stackPart = typeof stack === 'string' && stack ? `\n${stack}` : '';
    return `${timestamp} ${level}${tagLabel} ${message}${rest}${stackPart}`;
  }),
);

const jsonFormat = winston.format.combine(
  winston.format.errors({ stack: true }),
  winston.format.timestamp(),
  winston.format.json(),
);

const level = resolveLevel();
const transports: winston.transport[] = [];

if (config.log.console) {
  transports.push(
    new winston.transports.Console({
      level,
      format: winston.format.combine(winston.format.colorize(), humanFormat),
    }),
  );
}

if (config.log.file) {
  fs.mkdirSync(config.log.dir, { recursive: true });
  const file = (filename: string, fileLevel: string) =>
    new winston.transports.File({
      filename: path.join(config.log.dir, filename),
      level: fileLevel,
      format: jsonFormat,
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
      tailable: true,
    });
  transports.push(file('app.log', level));
  transports.push(file('error.log', 'error'));
}

export const logger = winston.createLogger({
  level,
  defaultMeta: { service: 'api' },
  transports,
  // Never let a single bad log line take the request down.
  handleExceptions: false,
  handleRejections: false,
  exitOnError: false,
});

/** Scoped child logger, e.g. `childLogger('job', jobId)` -> messages tagged `[job:<id>]`. */
export function childLogger(...scope: (string | undefined)[]): winston.Logger {
  const tag = scope.filter(Boolean).join(':');
  return tag ? logger.child({ tag }) : logger;
}

export function isLogLevelEnabled(candidate: LogLevel): boolean {
  return LEVELS.indexOf(candidate) <= LEVELS.indexOf(level);
}
