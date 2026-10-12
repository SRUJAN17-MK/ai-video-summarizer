import { createApp } from './app.js';
import { config, ensureTmpDirs, platformInfo } from './config.js';
import { aiConfigured } from './services/ai/index.js';
import { startCleanupScheduler } from './utils/cleanup.js';
import { logger } from './utils/logger.js';

ensureTmpDirs();

const app = createApp();

const server = app.listen(config.port, () => {
  const provider =
    config.ai.provider === 'mock'
      ? 'mock (testing only)'
      : config.ai.provider === 'gemini'
        ? 'gemini'
        : 'openai-compatible';
  const keyName = config.ai.provider === 'gemini' ? 'GEMINI_API_KEY' : 'AI_API_KEY';
  const keyState = aiConfigured() ? 'configured' : `MISSING (set ${keyName} in .env)`;
  logger.info(`AI Video Summarizer & Translator listening on http://localhost:${config.port}`, {
    provider,
    keyState,
    nodeEnv: config.nodeEnv,
    platform: platformInfo.os,
    tmpDir: config.files.tmpDir,
    logLevel: config.log.level,
  });
});

startCleanupScheduler();

const shutdown = (): void => {
  logger.info('Shutting down...');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
