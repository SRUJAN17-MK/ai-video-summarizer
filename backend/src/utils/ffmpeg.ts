import { spawn } from 'node:child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { AppError } from './errors.js';

export const FFMPEG_PATH: string = ffmpegInstaller.path;
export const FFPROBE_PATH: string = ffprobeInstaller.path;

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  timeoutMs?: number;
  cwd?: string;
  onStderrLine?: (line: string) => void;
}

/**
 * Runs a binary with an argument array (never a shell string), so user input
 * can never be interpreted as shell syntax.
 */
export function run(bin: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const child = spawn(bin, args, {
      cwd: opts.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new AppError('TIMEOUT', { message: `Media processing timed out after ${Math.round(timeoutMs / 1000)}s.` }));
    }, timeoutMs);

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
      if (stdout.length > 4_000_000) stdout = stdout.slice(-2_000_000);
    });

    let stderrTail = '';
    child.stderr.on('data', (d: Buffer) => {
      const text = d.toString('utf8');
      stderr += text;
      if (stderr.length > 4_000_000) stderr = stderr.slice(-2_000_000);
      if (opts.onStderrLine) {
        stderrTail += text;
        const parts = stderrTail.split(/\r?\n/);
        stderrTail = parts.pop() ?? '';
        for (const line of parts) opts.onStderrLine(line);
      }
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new AppError('MEDIA_FAILED', { message: 'Media tooling is unavailable on this server.', cause: err }));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export async function runFfmpeg(args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const res = await run(FFMPEG_PATH, ['-hide_banner', '-nostdin', ...args], opts);
  if (res.code !== 0) {
    throw new AppError('MEDIA_FAILED', {
      message: 'We could not process the media in this video. It may be corrupted or use an unsupported codec.',
      cause: new Error(`ffmpeg exited with code ${res.code}: ${res.stderr.slice(-1200)}`),
    });
  }
  return res;
}

export interface ProbeResult {
  durationSec: number;
  sizeBytes?: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width?: number;
  height?: number;
  formatName?: string;
}

export async function probeMedia(filePath: string, timeoutMs = 60_000): Promise<ProbeResult> {
  const res = await run(
    FFPROBE_PATH,
    [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ],
    { timeoutMs },
  );
  if (res.code !== 0) {
    throw new AppError('UNSUPPORTED_FILE', {
      message: 'We could not read this video. Please upload a valid MP4, WebM, MOV, AVI, or MKV file.',
      cause: new Error(res.stderr.slice(-800)),
    });
  }

  let parsed: any;
  try {
    parsed = JSON.parse(res.stdout);
  } catch (err) {
    throw new AppError('UNSUPPORTED_FILE', { message: 'We could not read this video file.', cause: err });
  }

  const streams: any[] = Array.isArray(parsed?.streams) ? parsed.streams : [];
  const hasVideo = streams.some((s) => s?.codec_type === 'video');
  const hasAudio = streams.some((s) => s?.codec_type === 'audio');
  const duration = Number(parsed?.format?.duration ?? streams.find((s) => s?.duration)?.duration ?? 0);
  const videoStream = streams.find((s) => s?.codec_type === 'video');

  return {
    durationSec: Number.isFinite(duration) && duration > 0 ? duration : 0,
    sizeBytes: parsed?.format?.size ? Number(parsed.format.size) : undefined,
    hasVideo,
    hasAudio,
    width: videoStream?.width ? Number(videoStream.width) : undefined,
    height: videoStream?.height ? Number(videoStream.height) : undefined,
    formatName: parsed?.format?.format_name,
  };
}
