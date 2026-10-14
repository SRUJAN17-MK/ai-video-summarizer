import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, ensureTmpDirs } from './config.js';
try { ensureTmpDirs(); } catch { /* ignore in read-only serverless environments */ }

import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { videoRoutes } from './routes/videoRoutes.js';
import { jobRoutes } from './routes/jobRoutes.js';
import { getHealth, getJobResults } from './controllers/videoController.js';

/**
 * Builds CSP hashes for the small inline scripts shipped in index.html
 * (theme bootstrap) so we can keep a strict CSP without 'unsafe-inline'.
 */
function inlineScriptHashes(htmlPath: string): string[] {
  try {
    const html = fs.readFileSync(htmlPath, 'utf8');
    const scripts = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
    return scripts
      .map((match) => match[1])
      .filter((content) => content.trim().length > 0)
      .map((content) => `'sha256-${crypto.createHash('sha256').update(content, 'utf8').digest('base64')}'`);
  } catch {
    return [];
  }
}

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestLogger());

  const frontendDist = path.join(config.repoRoot, 'frontend', 'dist');
  const indexHtml = path.join(frontendDist, 'index.html');

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        directives: {
          scriptSrc: ["'self'", ...inlineScriptHashes(indexHtml)],
          mediaSrc: ["'self'", 'blob:'],
          imgSrc: ["'self'", 'blob:', 'data:'],
        },
      },
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Allow same-origin / curl / server-to-server requests.
        if (!origin || config.corsOrigins.includes(origin) || config.corsOrigins.length === 0) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      methods: ['GET', 'POST'],
      allowedHeaders: ['content-type'],
    }),
  );

  app.use(express.json({ limit: '1mb' }));

  const apiLimiter = rateLimit({
    windowMs: config.limits.rateWindowMs,
    limit: config.limits.rateMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.' } },
  });
  app.use('/api', apiLimiter);

  app.get('/api/health', getHealth);
  app.use('/api/video', videoRoutes);
  app.use('/api/jobs', jobRoutes);
  app.get('/api/results/:jobId', getJobResults);
  app.use('/api', notFoundHandler);

  // Serve the built frontend in production.
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(frontendDist, { index: 'index.html', maxAge: '1h' }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(indexHtml);
    });
  }

  app.use(errorHandler);
  return app;
}

const app = createApp();
export default app;
