import type { Request, Response, NextFunction, RequestHandler } from 'express';
import multer from 'multer';
import { AppError, isAppError, userMessageFor, type ErrorCode } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: userMessageFor('NOT_FOUND') } });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) return;

  let code: ErrorCode = 'PROCESSING_FAILED';
  let status = 500;
  let message = userMessageFor('PROCESSING_FAILED');

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      code = 'FILE_TOO_LARGE';
      status = 413;
      message = userMessageFor('FILE_TOO_LARGE');
    } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      code = 'UNSUPPORTED_FILE';
      status = 400;
      message = userMessageFor('UNSUPPORTED_FILE');
    }
  } else if (isAppError(err)) {
    code = err.code;
    status = err.status;
    message = err.userMessage;
  } else if (err instanceof SyntaxError && 'body' in err) {
    code = 'INVALID_INPUT';
    status = 400;
    message = userMessageFor('INVALID_INPUT');
  }

  if (status >= 500 && !isAppError(err)) {
    logger.error(`[api] unhandled error ${code} on ${req.method} ${req.originalUrl}`, {
      err,
      status,
      code,
    });
  } else if (status >= 400) {
    logger.warn(`${req.method} ${req.originalUrl} -> ${status} ${code}`);
  }

  res.status(status).json({ error: { code, message } });
}
