import type { Request, Response } from 'express';
import path from 'node:path';
import { AppError } from '../utils/errors.js';
import { getJob } from '../services/jobService.js';

export function getJobAudio(req: Request, res: Response): void {
  const job = getJob(req.params.jobId ?? '');
  if (!job) throw new AppError('NOT_FOUND');

  if (!job.audioPath) {
    throw new AppError('NOT_FOUND', {
      message: 'No speech-only audio is available for this job. Enable "Generate speech-only audio" before analyzing.',
    });
  }

  const ext = path.extname(job.audioPath).toLowerCase();
  const type = ext === '.m4a' ? 'audio/mp4' : ext === '.wav' ? 'audio/wav' : 'audio/mpeg';
  const filename = `${job.videoName.replace(/\.[^.]+$/, '') || 'speech'}-cleaned${ext}`;

  res.setHeader('content-type', type);
  res.setHeader('content-disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  res.sendFile(job.audioPath, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'The generated audio file has expired.' } });
    }
  });
}
