import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ALLOWED_VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.avi', '.mkv'] as const;
export const ALLOWED_VIDEO_MIMES = new Set([
  'video/mp4',
  'video/x-m4v',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
  'video/mpeg',
  'video/ogg',
  '',
]);

export function randomId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

export function secureExtension(originalName: string): string | null {
  const ext = path.extname(originalName ?? '').toLowerCase();
  return (ALLOWED_VIDEO_EXTENSIONS as readonly string[]).includes(ext) ? ext : null;
}

export function sanitizeFilename(name: string, fallback = 'video'): string {
  const base = path.basename(name || fallback).replace(/\.[^.]+$/, '');
  const cleaned = base
    .replace(/[^\p{L}\p{N}._ -]+/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 60);
  return cleaned || fallback;
}

export function safeUnlink(filePath: string | undefined | null): void {
  if (!filePath) return;
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    /* ignore */
  }
}

export function exists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '00:00';
  const secs = Math.round(totalSeconds);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

export async function pathSize(filePath: string): Promise<number> {
  try {
    const stat = await fs.promises.stat(filePath);
    return stat.size;
  } catch {
    return 0;
  }
}
