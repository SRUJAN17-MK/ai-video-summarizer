import { AppError } from '../utils/errors.js';

export interface YouTubeTranscriptResult {
  videoId: string;
  title?: string;
  text: string;
  languageCode?: string;
  durationSec?: number;
}

export function isYouTubeUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com' || host === 'm.youtube.com';
  } catch {
    return false;
  }
}

function extractVideoId(url: URL): string | undefined {
  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    return id || undefined;
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') return url.searchParams.get('v') || undefined;
    const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([^/?#]+)/);
    return match?.[1];
  }
  return undefined;
}

async function fetchTitle(videoId: string): Promise<string | undefined> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`,
      { headers: { accept: 'application/json' } },
    );
    if (!res.ok) return undefined;
    const data: any = await res.json();
    return typeof data?.title === 'string' && data.title.trim() ? data.title.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Retrieves a public transcript/caption track for the video.
 *
 * This uses publicly exposed caption data only. It does not authenticate as
 * the video owner and cannot access private, age-restricted, or otherwise
 * restricted content.
 */
export async function fetchYouTubeTranscript(rawUrl: string): Promise<YouTubeTranscriptResult> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new AppError('INVALID_URL');
  }

  const videoId = extractVideoId(url);
  if (!videoId) throw new AppError('INVALID_URL', { message: 'Please enter a valid YouTube video URL.' });

  const title = await fetchTitle(videoId);

  // Lazy import keeps the dependency optional at type-check time if needed.
  const mod: any = await import('youtube-transcript');
  const YT = mod?.YoutubeTranscript ?? mod?.default?.YoutubeTranscript ?? mod?.default;

  let items: any[];
  try {
    try {
      items = await YT.fetchTranscript(videoId, { lang: 'en' });
    } catch {
      items = await YT.fetchTranscript(videoId);
    }
  } catch (err) {
    throw new AppError('MEDIA_FAILED', {
      message:
        'This YouTube video has no accessible transcript (captions may be disabled, removed, or the video is unavailable, private, or restricted). Please upload the video file instead.',
      cause: err,
    });
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError('MEDIA_FAILED', {
      message:
        'This YouTube video has no accessible transcript. Please upload the video file instead.',
    });
  }

  const text = items
    .map((item: any) => (typeof item?.text === 'string' ? item.text : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) {
    throw new AppError('NO_SPEECH', {
      message: 'No usable speech was found in this YouTube video transcript. Please try another video or upload the file.',
    });
  }

  const last = items[items.length - 1];
  const durationSec =
    typeof last?.offset === 'number' && typeof last?.duration === 'number'
      ? Math.max(1, Math.round((last.offset + last.duration) / 1000))
      : undefined;

  return {
    videoId,
    title,
    text,
    languageCode: typeof items[0]?.lang === 'string' ? items[0].lang : undefined,
    durationSec,
  };
}