import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..');
const repoRoot = path.resolve(backendRoot, '..');

dotenv.config({ path: path.join(backendRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, '.env') });

function str(key: string, fallback: string): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function int(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function bool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

const tmpRoot = str('TMP_DIR', path.join(backendRoot, '.tmp'));

// AI provider selection: explicit AI_PROVIDER wins; otherwise auto-select
// `gemini` when only GEMINI_API_KEY is available, else the OpenAI-compatible
// provider.
const geminiKey = str('GEMINI_API_KEY', '');
const openaiKey = str('AI_API_KEY', '');
const aiProvider = str('AI_PROVIDER', '').toLowerCase() || (openaiKey ? 'openai' : geminiKey ? 'gemini' : 'openai');

const nodeEnv = str('NODE_ENV', 'development');

export const config = {
  backendRoot,
  repoRoot,
  port: int('PORT', 4000),
  nodeEnv,

  log: {
    level: str('LOG_LEVEL', nodeEnv === 'production' ? 'info' : 'http'),
    dir: str('LOG_DIR', path.join(repoRoot, 'logs')),
    file: bool('LOG_TO_FILE', true),
    console: bool('LOG_TO_CONSOLE', true),
  },

  ai: {
    provider: aiProvider,
    apiKey: openaiKey,
    geminiKey,
    baseUrl: str(
      'AI_BASE_URL',
      aiProvider === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta' : 'https://api.openai.com/v1',
    ).replace(/\/+$/, ''),
    model: str('AI_MODEL', aiProvider === 'gemini' ? 'gemini-2.5-flash' : 'gpt-4o-mini'),
    transcriptionModel: str('AI_TRANSCRIPTION_MODEL', aiProvider === 'gemini' ? 'gemini-2.5-flash' : 'whisper-1'),
    timeoutMs: int('AI_TIMEOUT_MS', 120000),
  },

  corsOrigins: str('CORS_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  limits: {
    maxVideoBytes: int('MAX_VIDEO_MB', 200) * 1024 * 1024,
    maxUrlDownloadBytes: int('MAX_URL_DOWNLOAD_MB', 200) * 1024 * 1024,
    urlDownloadTimeoutMs: int('URL_DOWNLOAD_TIMEOUT_MS', 120000),
    rateWindowMs: int('RATE_LIMIT_WINDOW_MS', 900000),
    rateMax: int('RATE_LIMIT_MAX', 100),
    analyzeRateMax: int('ANALYZE_RATE_LIMIT_MAX', 10),
  },

  files: {
    tmpDir: tmpRoot,
    uploadsDir: path.join(tmpRoot, 'uploads'),
    audioDir: path.join(tmpRoot, 'audio'),
    ttlMs: int('TEMP_FILE_TTL_MS', 1800000),
    cleanupIntervalMs: int('CLEANUP_INTERVAL_MS', 300000),
  },

  demucs: {
    enabled: bool('DEMUCS_ENABLED', false),
    command: str('DEMUCS_COMMAND', 'demucs'),
  },
};

export function ensureTmpDirs(): void {
  for (const dir of [config.files.tmpDir, config.files.uploadsDir, config.files.audioDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export const platformInfo = {
  os: `${os.platform()} ${os.arch()}`,
};
