import type { PublicJob, Results, VideoInfo } from '../types';
import { logger } from '../lib/logger';

const log = logger.child('api');

export class ApiError extends Error {
  readonly code: string;
  constructor(message: string, code = 'PROCESSING_FAILED') {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { ...(init.body instanceof FormData ? {} : { 'content-type': 'application/json' }), ...(init.headers ?? {}) },
    });
  } catch (err) {
    log.error(`request to ${path} failed`, { err, path });
    throw new ApiError('Could not reach the server. Please check that the backend is running and try again.', 'NETWORK');
  }

  const contentType = res.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json') ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const message = payload?.error?.message ?? 'Something went wrong. Please try again.';
    const code = payload?.error?.code ?? 'ERROR';
    log.warn(`${init.method ?? 'GET'} ${path} -> ${res.status} ${code}`, { status: res.status, code, path });
    throw new ApiError(message, code);
  }
  return payload as T;
}

export function uploadVideo(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<{ video: VideoInfo }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('video', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/video/upload');
    xhr.responseType = 'text';

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onerror = () => {
      log.error('upload request failed', { path: '/api/video/upload' });
      reject(new ApiError('Could not reach the server. Please check that the backend is running.', 'NETWORK'));
    };
    xhr.ontimeout = () => {
      log.warn('upload timed out', { path: '/api/video/upload' });
      reject(new ApiError('The upload took too long. Please try a smaller video.', 'TIMEOUT'));
    };

    xhr.onload = () => {
      let payload: any = null;
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        payload = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload as { video: VideoInfo });
      } else {
        const code = payload?.error?.code ?? 'ERROR';
        log.warn(`POST /api/video/upload -> ${xhr.status} ${code}`, { status: xhr.status, code });
        reject(new ApiError(payload?.error?.message ?? 'Upload failed. Please try again.', payload?.error?.code));
      }
    };

    xhr.send(form);
  });
}

export function submitVideoUrl(url: string): Promise<{ video: VideoInfo }> {
  return request('/api/video/url', { method: 'POST', body: JSON.stringify({ url }) });
}

export function analyzeVideo(input: {
  videoId: string;
  targetLanguage: string;
  generateAudio: boolean;
}): Promise<PublicJob> {
  return request('/api/video/analyze', { method: 'POST', body: JSON.stringify(input) });
}

export function fetchJob(jobId: string): Promise<PublicJob> {
  return request(`/api/jobs/${encodeURIComponent(jobId)}`);
}

export function fetchResults(jobId: string): Promise<Results> {
  return request(`/api/jobs/${encodeURIComponent(jobId)}/results`);
}

export function health(): Promise<{ ok: boolean; aiProvider: string; aiConfigured: boolean; maxUploadMb: number }> {
  return request('/api/health');
}
