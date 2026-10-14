import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { AppError } from '../utils/errors.js';
import { probeMedia } from '../utils/ffmpeg.js';
import { downloadVideo, assertSafeVideoUrl } from '../utils/ssrf.js';
import { ALLOWED_VIDEO_MIMES, randomId, secureExtension, exists, formatDuration, formatBytes } from '../utils/files.js';
import { isYouTubeUrl, fetchYouTubeTranscript } from './youtubeTranscriptService.js';

export interface VideoAsset {
  id: string;
  originalName: string;
  storedName: string;
  filePath: string;
  sizeBytes: number;
  durationSec: number;
  durationLabel: string;
  sizeLabel: string;
  width?: number;
  height?: number;
  origin: 'upload' | 'url';
  sourceUrl?: string;
  transcriptText?: string;
  transcriptLanguageCode?: string;
  youtubeDirect?: boolean;
  createdAt: number;
}

const assets = new Map<string, VideoAsset>();

export function getVideoAsset(id: string): VideoAsset | undefined {
  const asset = assets.get(id);
  if (!asset) return undefined;
  if (asset.transcriptText || asset.youtubeDirect) return asset;
  if (!exists(asset.filePath)) return undefined;
  return asset;
}

export function listVideoAssets(): VideoAsset[] {
  return [...assets.values()];
}

function describe(asset: VideoAsset): VideoAsset {
  return {
    ...asset,
    durationLabel: formatDuration(asset.durationSec),
    sizeLabel: formatBytes(asset.sizeBytes),
  };
}

export async function storeUpload(file: { originalname: string; path: string; size: number; mimetype?: string }): Promise<VideoAsset> {
  const ext = secureExtension(file.originalname);
  if (!ext) {
    fs.rmSync(file.path, { force: true });
    throw new AppError('UNSUPPORTED_FILE');
  }
  const mime = (file.mimetype ?? '').toLowerCase();
  if (mime && !ALLOWED_VIDEO_MIMES.has(mime) && !mime.startsWith('video/')) {
    fs.rmSync(file.path, { force: true });
    throw new AppError('UNSUPPORTED_FILE');
  }

  let probe;
  try {
    probe = await probeMedia(file.path);
  } catch (err) {
    fs.rmSync(file.path, { force: true });
    throw err;
  }

  if (!probe.hasAudio) {
    fs.rmSync(file.path, { force: true });
    throw new AppError('NO_SPEECH', { message: 'This video does not contain an audio track. Please upload a video with speech.' });
  }

  const asset: VideoAsset = {
    id: randomId(),
    originalName: path.basename(file.originalname),
    storedName: path.basename(file.path),
    filePath: file.path,
    sizeBytes: file.size || (await fs.promises.stat(file.path)).size,
    durationSec: probe.durationSec,
    durationLabel: formatDuration(probe.durationSec),
    sizeLabel: formatBytes(file.size),
    width: probe.width,
    height: probe.height,
    origin: 'upload',
    createdAt: Date.now(),
  };
  assets.set(asset.id, asset);
  return describe(asset);
}

export async function storeFromUrl(rawUrl: string): Promise<VideoAsset> {
  if (isYouTubeUrl(rawUrl)) {
    let transcript;
    try {
      transcript = await fetchYouTubeTranscript(rawUrl);
    } catch {
      transcript = undefined;
    }

    const id = randomId();
    const asset: VideoAsset = {
      id,
      originalName: transcript?.title ?? 'youtube-video',
      storedName: '',
      filePath: '',
      sizeBytes: 0,
      durationSec: transcript?.durationSec ?? 0,
      durationLabel: formatDuration(transcript?.durationSec ?? 0),
      sizeLabel: transcript ? 'YouTube captions' : 'YouTube direct',
      origin: 'url',
      sourceUrl: rawUrl.trim(),
      transcriptText: transcript?.text,
      transcriptLanguageCode: transcript?.languageCode,
      youtubeDirect: !transcript,
      createdAt: Date.now(),
    };
    assets.set(asset.id, asset);
    return describe(asset);
  }

  const url = await assertSafeVideoUrl(rawUrl);
  const id = randomId();
  const destination = path.join(config.files.uploadsDir, `url-${id}.bin`);

  const result = await downloadVideo(url.toString(), destination, {
    maxBytes: config.limits.maxUrlDownloadBytes,
    timeoutMs: config.limits.urlDownloadTimeoutMs,
  });

  let probe;
  try {
    probe = await probeMedia(destination);
  } catch (err) {
    fs.rmSync(destination, { force: true });
    if (err instanceof AppError) {
      throw new AppError('UNSUPPORTED_FILE', {
        message: 'That link does not appear to point to a supported video file. Please use a direct link to an MP4, WebM, MOV, AVI, or MKV file.',
      });
    }
    throw err;
  }

  if (!probe.hasAudio) {
    fs.rmSync(destination, { force: true });
    throw new AppError('NO_SPEECH', { message: 'This video does not contain an audio track. Please try a link to a video with speech.' });
  }

  const asset: VideoAsset = {
    id,
    originalName: guessNameFromUrl(url) ?? 'remote-video',
    storedName: path.basename(destination),
    filePath: destination,
    sizeBytes: result.bytes,
    durationSec: probe.durationSec,
    durationLabel: formatDuration(probe.durationSec),
    sizeLabel: formatBytes(result.bytes),
    width: probe.width,
    height: probe.height,
    origin: 'url',
    sourceUrl: url.toString(),
    createdAt: Date.now(),
  };
  assets.set(asset.id, asset);
  return describe(asset);
}

function guessNameFromUrl(url: URL): string | undefined {
  try {
    const base = path.basename(new URL(url).pathname);
    if (base && base !== '/') return decodeURIComponent(base);
  } catch {
    /* ignore */
  }
  return undefined;
}

export function deleteVideoAsset(id: string): void {
  const asset = assets.get(id);
  if (!asset) return;
  try {
    fs.rmSync(asset.filePath, { force: true });
  } catch {
    /* ignore */
  }
  assets.delete(id);
}

export function sweepVideoAssets(ttlMs: number): string[] {
  const removed: string[] = [];
  const now = Date.now();
  for (const asset of assets.values()) {
    if (now - asset.createdAt > ttlMs) {
      deleteVideoAsset(asset.id);
      removed.push(asset.id);
    }
  }
  return removed;
}
