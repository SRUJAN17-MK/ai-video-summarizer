export interface Language {
  code: string;
  name: string;
  nativeName?: string;
  flag?: string;
}

export interface VideoInfo {
  videoId: string;
  name: string;
  sizeBytes: number;
  sizeLabel: string;
  durationSec: number;
  durationLabel: string;
  width?: number;
  height?: number;
  origin: 'upload' | 'url';
  sourceUrl?: string;
}

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

export const STAGE_LABELS: Record<StageKey, string> = {
  received: 'Video received',
  extract_audio: 'Extracting audio',
  clean_speech: 'Cleaning speech',
  transcribe: 'Transcribing audio',
  detect_language: 'Detecting language',
  summarize: 'Generating summary',
  translate: 'Translating summary',
};

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

export interface DetectedLanguage {
  code?: string;
  name: string;
  confidence?: number;
}

export interface Results {
  jobId: string;
  status: JobStatus;
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
  transcriptSegments: { start: number; end: number; text: string }[];
  audioUrl?: string;
  notices: string[];
  processingTimeMs: number;
  createdAt: number;
}
