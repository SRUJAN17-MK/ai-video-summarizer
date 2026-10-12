import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { sweepJobs, getJob } from '../services/jobService.js';
import { sweepVideoAssets, listVideoAssets } from '../services/videoService.js';
import { logger } from './logger.js';

const log = logger.child({ tag: 'cleanup' });

/**
 * Periodic sweep: removes expired job records, expired uploaded videos and
 * orphaned temporary files (work dirs, generated audio).
 */
export function sweepTempFiles(): void {
  const ttl = config.files.ttlMs;
  const now = Date.now();

  const removedJobs = sweepJobs(ttl);
  sweepVideoAssets(ttl);

  // Audio files that belonged to removed jobs.
  const audioDir = config.files.audioDir;
  if (fs.existsSync(audioDir)) {
    for (const entry of fs.readdirSync(audioDir)) {
      const jobId = path.basename(entry, path.extname(entry));
      const fullPath = path.join(audioDir, entry);
      if (!getJob(jobId)) {
        fs.rmSync(fullPath, { force: true });
        continue;
      }
      const stat = fs.statSync(fullPath);
      if (now - stat.mtimeMs > ttl) fs.rmSync(fullPath, { force: true });
    }
  }

  // Work directories without a live job.
  const workRoot = path.join(config.files.tmpDir, 'work');
  if (fs.existsSync(workRoot)) {
    for (const entry of fs.readdirSync(workRoot)) {
      if (!getJob(entry)) {
        fs.rmSync(path.join(workRoot, entry), { recursive: true, force: true });
      }
    }
  }

  if (removedJobs.length > 0) {
    log.info(`removed ${removedJobs.length} expired job(s)`);
  }
}

export function startCleanupScheduler(): NodeJS.Timeout {
  const timer = setInterval(() => {
    try {
      sweepTempFiles();
    } catch (err) {
      log.error('sweep failed', { err });
    }
  }, config.files.cleanupIntervalMs);
  timer.unref?.();
  return timer;
}

export function activeVideoCount(): number {
  return listVideoAssets().length;
}
