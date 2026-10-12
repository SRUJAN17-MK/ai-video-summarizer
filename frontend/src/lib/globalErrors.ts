import { logger } from './logger';

const log = logger.child('errors');

/**
 * Captures errors that never reach a try/catch: uncaught exceptions and
 * rejected promises, so they show up in the app's logging stream.
 */
export function installGlobalErrorLogging(): void {
  window.addEventListener('error', (event) => {
    log.error('uncaught error', {
      message: event.message,
      source: event.filename,
      line: event.lineno,
      column: event.colno,
      error: event.error,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason;
    log.error('unhandled promise rejection', {
      reason: reason instanceof Error ? `${reason.name}: ${reason.message}` : reason,
      error: reason instanceof Error ? reason : undefined,
    });
  });
}
