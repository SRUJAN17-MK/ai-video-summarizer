import type { Request, Response } from 'express';
import { config } from '../config.js';
import { AppError } from '../utils/errors.js';
import { isSupportedTarget } from '../utils/languages.js';
import { assertAIConfigured, aiConfigured, aiProviderKind } from '../services/ai/index.js';
import { storeUpload, storeFromUrl, getVideoAsset, type VideoAsset } from '../services/videoService.js';
import { createJob, toPublicJob, getJob } from '../services/jobService.js';
import { processJob } from '../workers/pipeline.js';

function videoPayload(asset: VideoAsset) {
  return {
    video: {
      videoId: asset.id,
      name: asset.originalName,
      sizeBytes: asset.sizeBytes,
      sizeLabel: asset.sizeLabel,
      durationSec: asset.durationSec,
      durationLabel: asset.durationLabel,
      width: asset.width,
      height: asset.height,
      origin: asset.origin,
      sourceUrl: asset.sourceUrl,
    },
  };
}

export async function uploadVideo(req: Request, res: Response): Promise<void> {
  const file = req.file;
  if (!file) {
    throw new AppError('INVALID_INPUT', { message: 'Please choose a video file to upload.' });
  }
  const asset = await storeUpload(file);
  res.status(201).json(videoPayload(asset));
}

export async function acceptVideoUrl(req: Request, res: Response): Promise<void> {
  const raw = req.body?.url;
  if (typeof raw !== 'string' || raw.trim().length < 8 || raw.length > 2048) {
    throw new AppError('INVALID_URL');
  }
  const asset = await storeFromUrl(raw.trim());
  res.status(201).json(videoPayload(asset));
}

export async function analyzeVideo(req: Request, res: Response): Promise<void> {
  const { videoId, targetLanguage, generateAudio } = req.body ?? {};

  if (typeof videoId !== 'string' || !videoId) {
    throw new AppError('INVALID_INPUT', { message: 'No video selected. Upload a video or paste a URL first.' });
  }
  if (typeof targetLanguage !== 'string' || !isSupportedTarget(targetLanguage)) {
    throw new AppError('INVALID_INPUT', { message: 'Please choose a target language for the translation.' });
  }

  const asset = getVideoAsset(videoId);
  if (!asset) {
    throw new AppError('NOT_FOUND', { message: 'We could not find that video. Please upload it again.' });
  }

  assertAIConfigured();

  const job = createJob({
    videoId: asset.id,
    videoName: asset.originalName,
    targetLanguageCode: targetLanguage.toLowerCase().split(/[-_]/)[0],
    generateAudio: generateAudio === true || generateAudio === 'true',
  });

  // Fire and forget - clients poll GET /api/jobs/:jobId for progress.
  void processJob(job.id);

  res.status(202).json(toPublicJob(job));
}

export function getHealth(_req: Request, res: Response): void {
  res.json({
    ok: true,
    aiProvider: aiProviderKind(),
    aiConfigured: aiConfigured(),
    maxUploadMb: Math.round(config.limits.maxVideoBytes / (1024 * 1024)),
  });
}

export function getJobStatus(req: Request, res: Response): void {
  const job = getJob(req.params.jobId ?? '');
  if (!job) throw new AppError('NOT_FOUND');
  res.json(toPublicJob(job));
}

export function getJobResults(req: Request, res: Response): void {
  const job = getJob(req.params.jobId ?? '');
  if (!job) throw new AppError('NOT_FOUND');

  if (job.status === 'failed') {
    res.status(409).json({ error: { code: job.errorCode ?? 'PROCESSING_FAILED', message: job.errorMessage ?? userMessage() } });
    return;
  }
  if (!job.result) {
    res.status(409).json({ error: { code: 'INVALID_INPUT', message: 'This job is still processing. Please try again shortly.' } });
    return;
  }

  res.json({
    jobId: job.id,
    status: job.status,
    ...job.result,
  });
}

function userMessage(): string {
  return "We couldn't process this video. Please try again or use another video.";
}
