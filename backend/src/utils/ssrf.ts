import dns from 'node:dns/promises';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError } from './errors.js';
import { logger } from './logger.js';

const log = logger.child({ tag: 'download' });

const MAX_REDIRECTS = 5;

function ipv4ToInt(ip: string): number | undefined {
  const parts = ip.split('.');
  if (parts.length !== 4) return undefined;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const n = Number(part);
    if (n > 255) return undefined;
    value = value * 256 + n;
  }
  return value;
}

function isPrivateIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === undefined) return true;
  const ranges: Array<[number, number]> = [
    [ipv4ToInt('0.0.0.0')!, ipv4ToInt('0.255.255.255')!],
    [ipv4ToInt('10.0.0.0')!, ipv4ToInt('10.255.255.255')!],
    [ipv4ToInt('100.64.0.0')!, ipv4ToInt('100.127.255.255')!],
    [ipv4ToInt('127.0.0.0')!, ipv4ToInt('127.255.255.255')!],
    [ipv4ToInt('169.254.0.0')!, ipv4ToInt('169.254.255.255')!],
    [ipv4ToInt('172.16.0.0')!, ipv4ToInt('172.31.255.255')!],
    [ipv4ToInt('192.0.0.0')!, ipv4ToInt('192.0.0.255')!],
    [ipv4ToInt('192.0.2.0')!, ipv4ToInt('192.0.2.255')!],
    [ipv4ToInt('192.168.0.0')!, ipv4ToInt('192.168.255.255')!],
    [ipv4ToInt('198.18.0.0')!, ipv4ToInt('198.19.255.255')!],
    [ipv4ToInt('198.51.100.0')!, ipv4ToInt('198.51.100.255')!],
    [ipv4ToInt('203.0.113.0')!, ipv4ToInt('203.0.113.255')!],
    [ipv4ToInt('224.0.0.0')!, ipv4ToInt('239.255.255.255')!],
    [ipv4ToInt('240.0.0.0')!, ipv4ToInt('255.255.255.255')!],
  ];
  return ranges.some(([start, end]) => value >= start && value <= end);
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('::ffff:')) {
    const v4 = normalized.slice('::ffff:'.length);
    if (net.isIPv4(v4)) return isPrivateIpv4(v4);
    return true;
  }
  if (/^f[cd]/.test(normalized)) return true; // unique local fc00::/7
  if (/^fe[89ab]/.test(normalized)) return true; // link-local fe80::/10
  if (/^ff/.test(normalized)) return true; // multicast ff00::/8
  if (normalized.startsWith('2001:db8:')) return true; // documentation
  return false;
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIpv4(ip);
  if (net.isIPv6(ip)) return isPrivateIpv6(ip);
  return true;
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
]);

/**
 * Validates a user-supplied video URL (SSRF protection).
 * - http/https only
 * - no localhost / internal hostnames
 * - DNS resolution must not land on private / reserved address space
 */
export async function assertSafeVideoUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new AppError('INVALID_URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('INVALID_URL');
  }
  if (url.username || url.password) {
    throw new AppError('INVALID_URL', { message: 'Please enter a URL without embedded credentials.' });
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new AppError('INVALID_URL');
  }

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new AppError('INVALID_URL');
    return url;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new AppError('INVALID_URL', { message: 'That hostname could not be resolved. Please check the URL.' });
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateIp(a.address))) {
    throw new AppError('INVALID_URL');
  }

  return url;
}

export interface DownloadResult {
  bytes: number;
  finalUrl: string;
  contentType?: string;
}

/**
 * Downloads a remote video to disk, re-validating every redirect hop and
 * enforcing size + time limits.
 */
export async function downloadVideo(
  rawUrl: string,
  destination: string,
  opts: { maxBytes: number; timeoutMs: number },
): Promise<DownloadResult> {
  let current = await assertSafeVideoUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': 'AIVideoSummarizer/1.0 (+video-processing)',
          accept: 'video/*, application/octet-stream, */*',
        },
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        res.body?.cancel().catch(() => undefined);
        if (!location) throw new AppError('DOWNLOAD_FAILED');
        current = await assertSafeVideoUrl(new URL(location, current).toString());
        continue;
      }

      if (!res.ok) {
        res.body?.cancel().catch(() => undefined);
        throw new AppError('DOWNLOAD_FAILED', {
          message: `The video server responded with status ${res.status}. Please check the link.`,
        });
      }

      const declaredLength = Number(res.headers.get('content-length') ?? 0);
      if (declaredLength && declaredLength > opts.maxBytes) {
        res.body?.cancel().catch(() => undefined);
        throw new AppError('FILE_TOO_LARGE');
      }

      const contentType = res.headers.get('content-type') ?? undefined;
      if (!res.body) throw new AppError('DOWNLOAD_FAILED');

      await fs.promises.mkdir(path.dirname(destination), { recursive: true });
      const fileStream = fs.createWriteStream(destination);
      let received = 0;
      const bodyStream = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
      bodyStream.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > opts.maxBytes) {
          bodyStream.destroy(new Error('size-limit'));
          fileStream.destroy();
        }
      });

      try {
        await pipeline(bodyStream, fileStream);
      } catch (err) {
        await fs.promises.rm(destination, { force: true });
        if (received > opts.maxBytes) throw new AppError('FILE_TOO_LARGE');
        throw new AppError('DOWNLOAD_FAILED', { cause: err });
      }

      if (received === 0) {
        await fs.promises.rm(destination, { force: true });
        throw new AppError('DOWNLOAD_FAILED', { message: 'The URL returned an empty file.' });
      }

      return { bytes: received, finalUrl: current.toString(), contentType };
    }

    throw new AppError('DOWNLOAD_FAILED', { message: 'Too many redirects while downloading the video.' });
  } catch (err) {
    log.warn('video download failed', { err, url: rawUrl });
    if (err instanceof AppError) throw err;
    if ((err as Error)?.name === 'AbortError') {
      throw new AppError('TIMEOUT', { message: 'Downloading the video took too long. Please try a shorter video or a faster link.' });
    }
    throw new AppError('DOWNLOAD_FAILED', { cause: err });
  } finally {
    clearTimeout(timer);
  }
}
