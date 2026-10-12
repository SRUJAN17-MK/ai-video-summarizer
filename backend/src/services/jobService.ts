import type { ErrorCode } from '../utils/errors.js';
import type { TranscriptSegment } from './ai/index.js';

export const STAGE_KEYS = [
  'received',
  'extract_audio',
  'clean_speech',
  'transcribe',
  'detect_language',
  'summarize',
  'translate',
] as const;

export type StageKey = (typeof STAGE_KEYS)[number];
export type StageState = 'pending' | 'active' | 'done' | 'error';
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface DetectedLanguage {
  code?: string;
  name: string;
  /** 0-1, only present when the provider genuinely returns a confidence. */
  confidence?: number;
}

export interface JobResult {
  video: {
    name: string;
    durationSec: number;
    durationLabel: string;
    sizeLabel: string;
    origin: 'upload' | 'url';
    sourceUrl?: string;
  };
  detectedLanguage: DetectedLanguage;
  targetLanguage: { code: string; name: string; flag?: string };
  summary: { summary: string; keyPoints: string[] };
  translation: { summary: string; keyPoints: string[]; alreadyTranslated: boolean };
  transcript: string;
  transcriptSegments: TranscriptSegment[];
  audioUrl?: string;
  notices: string[];
  processingTimeMs: number;
  createdAt: number;
}

export interface Job {
  id: string;
  status: JobStatus;
  stage: StageKey | null;
  stages: Record<StageKey, StageState>;
  videoId: string;
  videoName: string;
  targetLanguageCode: string;
  generateAudio: boolean;
  audioPath?: string;
  workDir?: string;
  result?: JobResult;
  errorCode?: ErrorCode;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
}

export interface PublicJob {
  jobId: string;
  status: JobStatus;
  stage: StageKey | null;
  stages: Record<StageKey, StageState>;
  videoName: string;
  targetLanguage: string;
  error?: string;
  createdAt: number;
  finishedAt?: number;
}

const jobs = new Map<string, Job>();

export function createJob(input: { videoId: string; videoName: string; targetLanguageCode: string; generateAudio: boolean }): Job {
  const now = Date.now();
  const stages = Object.fromEntries(STAGE_KEYS.map((k) => [k, 'pending' as StageState])) as Record<StageKey, StageState>;
  const job: Job = {
    id: makeJobId(),
    status: 'queued',
    stage: null,
    stages,
    videoId: input.videoId,
    videoName: input.videoName,
    targetLanguageCode: input.targetLanguageCode,
    generateAudio: input.generateAudio,
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(job.id, job);
  return job;
}

function makeJobId(): string {
  return `job_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function markStage(job: Job, key: StageKey, state: StageState): void {
  job.stages[key] = state;
  if (state === 'active' || state === 'done' || state === 'error') job.stage = key;
  job.status = state === 'error' ? job.status : 'processing';
  job.updatedAt = Date.now();
}

export function completeJob(job: Job, result: JobResult): void {
  job.result = result;
  job.status = 'completed';
  job.stage = null;
  job.finishedAt = Date.now();
  job.updatedAt = job.finishedAt;
}

export function failJob(job: Job, code: ErrorCode, message: string): void {
  job.status = 'failed';
  job.errorCode = code;
  job.errorMessage = message;
  if (job.stage) job.stages[job.stage] = 'error';
  job.finishedAt = Date.now();
  job.updatedAt = job.finishedAt;
}

export function toPublicJob(job: Job): PublicJob {
  return {
    jobId: job.id,
    status: job.status,
    stage: job.stage,
    stages: job.stages,
    videoName: job.videoName,
    targetLanguage: job.targetLanguageCode,
    error: job.errorMessage,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
  };
}

export function sweepJobs(ttlMs: number): string[] {
  const removed: string[] = [];
  const now = Date.now();
  for (const job of jobs.values()) {
    const reference = job.finishedAt ?? job.createdAt;
    if (now - reference > ttlMs) {
      removed.push(job.id);
      jobs.delete(job.id);
    }
  }
  return removed;
}

export function jobCount(): number {
  return jobs.size;
}
