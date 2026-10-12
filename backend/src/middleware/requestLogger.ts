import type { Request, RequestHandler, Response } from 'express';
import { logger } from '../utils/logger.js';

const MAX_PATH_LENGTH = 300;

function truncatedPath(req: Request): string {
  const url = req.originalUrl || req.url;
  return url.length > MAX_PATH_LENGTH ? `${url.slice(0, MAX_PATH_LENGTH)}…` : url;
}

function statusLevel(status: number): 'error' | 'warn' | 'http' {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'http';
}

/**
 * Logs every API request once the response finishes:
 * method, path, status, duration and remote address.
 */
export function requestLogger(): RequestHandler {
  return (req: Request, res: Response, next) => {
    if (!req.path.startsWith('/api')) {
      next();
      return;
    }

    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Math.round(Number(process.hrtime.bigint() - start) / 1e4) / 100;
      logger.log(statusLevel(res.statusCode), `${req.method} ${truncatedPath(req)} ${res.statusCode}`, {
        method: req.method,
        path: truncatedPath(req),
        status: res.statusCode,
        durationMs,
        ip: req.ip,
      });
    });
    next();
  };
}
