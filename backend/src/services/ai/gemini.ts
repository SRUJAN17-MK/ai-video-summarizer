import fs from 'node:fs';
import { AppError } from '../../utils/errors.js';
import { summarizationPrompt, translationPrompt } from '../../utils/prompts.js';
import { friendlyHttpError, parseJsonObject } from './openaiCompatible.js';
import { logger } from '../../utils/logger.js';
import type { AIProvider, SummaryResult, TranscriptionResult, TranscriptSegment, TranslationInput } from './types.js';

const log = logger.child({ tag: 'ai:gemini' });

export interface GeminiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  transcriptionModel: string;
  timeoutMs: number;
}

/** Gemini's inline-data request limit is 20 MB. */
const MAX_INLINE_AUDIO_BYTES = 20 * 1024 * 1024;

const SYSTEM_INSTRUCTION =
  'You are a precise, careful assistant. Follow the user instructions exactly.';

/**
 * Google Gemini (Generative Language API).
 *
 * Gemini has no `/audio/transcriptions` endpoint, so transcription is done by
 * sending the audio inline to `generateContent` and asking for structured JSON.
 * Chat tasks (summarize / translate) use the same endpoint with
 * `responseMimeType: application/json`.
 *
 * Configured with GEMINI_API_KEY (or AI_API_KEY) + AI_PROVIDER=gemini.
 */
export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';

  constructor(private readonly cfg: GeminiConfig) {}

  // ------------------------------------------------------- generateContent ----
  private async generateContent(
    prompt: string,
    opts: { json: boolean; model?: string; timeoutMs?: number; inlineAudio?: { data: string; mime: string }; fileData?: { uri: string; mime: string }; systemInstruction?: boolean },
  ): Promise<string> {
    const model = opts.model ?? this.cfg.model;
    const timeoutMs = opts.timeoutMs ?? this.cfg.timeoutMs;
    const useSystem = opts.systemInstruction !== false;

    const parts: Array<Record<string, unknown>> = [];
    if (opts.inlineAudio) parts.push({ inline_data: { mime_type: opts.inlineAudio.mime, data: opts.inlineAudio.data } });
    if (opts.fileData) parts.push({ file_data: { file_uri: opts.fileData.uri, mime_type: opts.fileData.mime } });
    parts.push({ text: prompt });

    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.2,
        ...(opts.json ? { responseMimeType: 'application/json' } : {}),
      },
    };
    if (useSystem) body.systemInstruction = { parts: [{ text: SYSTEM_INSTRUCTION }] };

    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(800 * 2 ** (attempt - 1));

      let res: Response;
      try {
        res = await this.request(`/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          timeoutMs,
        });
      } catch (err) {
        const isTimeout = (err as any)?.name === 'AbortError' || (err as any)?.name === 'TimeoutError';
        log.warn(`generateContent request failed (attempt ${attempt + 1}/3)`, { err, model });
        lastError = new AppError(isTimeout ? 'TIMEOUT' : 'AI_FAILED', {
          message: isTimeout
            ? 'The AI request timed out. Try a shorter video or try again.'
            : 'Could not reach the Gemini API. Check the server network connection and AI_BASE_URL.',
          cause: err,
        });
        continue;
      }

      if (!res.ok) {
        const text = await safeText(res);
        const httpError = new AppError('AI_FAILED', {
          message: friendlyHttpError(res.status, text, 'GEMINI_API_KEY'),
          cause: new Error(text.slice(0, 500)),
        });
        if (res.status === 429 || res.status >= 500) {
          log.warn(`generateContent got HTTP ${res.status} (attempt ${attempt + 1}/3)`, { model, status: res.status });
          lastError = httpError;
          continue;
        }
        throw httpError;
      }

      const data: any = await res.json();
      const blockReason = data?.promptFeedback?.blockReason;
      if (blockReason) {
        throw new AppError('AI_FAILED', {
          message: `Gemini blocked the request (${blockReason}). Please try again with a different video.`,
        });
      }
      const candidates = data?.candidates ?? [];
      const allParts = candidates.flatMap((c: any) => c?.content?.parts ?? []);
      const text = allParts
        .filter((p: any) => p?.thought !== true)
        .map((p: any) => (typeof p?.text === 'string' ? p.text : p?.audioTranscription?.text))
        .filter((t: unknown): t is string => typeof t === 'string')
        .join('')
        .trim();
      if (!text) {
        throw new AppError('AI_FAILED', { message: 'The Gemini API returned an empty response. Please try again.' });
      }
      return text;
    }
    throw lastError instanceof AppError ? lastError : new AppError('AI_FAILED', { cause: lastError });
  }

  // -------------------------------------------------------- transcription ----
  async transcribe(audioPath: string, opts: { timeoutMs?: number } = {}): Promise<TranscriptionResult> {
    const stat = await fs.promises.stat(audioPath);
    if (stat.size > MAX_INLINE_AUDIO_BYTES) {
      throw new AppError('AI_FAILED', {
        message:
          'The cleaned audio is too large for the Gemini API (20 MB limit). Try a shorter video.',
      });
    }
    const buffer = await fs.promises.readFile(audioPath);
    const mime = audioPath.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav';

    const raw = await this.generateContent(TRANSCRIPTION_PROMPT, {
      json: false,
      systemInstruction: false,
      model: this.cfg.transcriptionModel,
      timeoutMs: opts.timeoutMs,
      inlineAudio: { data: buffer.toString('base64'), mime },
    });

    // Newer Gemini transcription models return `audioTranscription` parts rather
    // than JSON text, while chat models may still return JSON. Handle both.
    let text = raw.trim();
    let language: string | undefined;
    let segments: TranscriptSegment[] = [];
    let durationSec: number | undefined;

    const parsed = parseJsonObject(raw);
    if (parsed) {
      if (typeof parsed.text === 'string') text = parsed.text;
      if (typeof parsed.language === 'string' && parsed.language.trim()) language = parsed.language.trim().toLowerCase();
      if (Array.isArray(parsed.segments)) {
        segments = parsed.segments
          .map((s: any) => ({
            start: Number(s?.start ?? 0),
            end: Number(s?.end ?? 0),
            text: String(s?.text ?? '').trim(),
          }))
          .filter((s: { start: number; end: number; text: string }) =>
            Number.isFinite(s.start) && Number.isFinite(s.end) && s.text.length > 0,
          );
      }
      if (typeof parsed.duration === 'number') durationSec = parsed.duration;
    }

    // Some transcription-capable Gemini models return only text; detect the
    // spoken language with the configured chat model as a fallback.
    if (!language && text.trim()) {
      try {
        const langRaw = await this.generateContent(
          `Detect the ISO 639-1 language code of the following transcript. Respond with ONLY a JSON object in exactly this shape: {"language":"en"}\n\n${text.slice(0, 4000)}`,
          { json: true, model: this.cfg.model, timeoutMs: opts.timeoutMs },
        );
        const langParsed = parseJsonObject(langRaw);
        if (typeof langParsed?.language === 'string' && langParsed.language.trim()) {
          language = langParsed.language.trim().toLowerCase();
        }
      } catch (err) {
        log.warn('language detection failed', { err });
      }
    }

    return { text, segments, language, durationSec };
  }

  async summarizeVideo(input: { videoUrl: string; languageName?: string }): Promise<SummaryResult & { sourceLanguageCode?: string }> {
    const raw = await this.generateContent(
      `You are an expert video content analyst. Analyze the provided YouTube video and produce a genuinely useful summary.

Requirements:
- Understand the whole video and identify the main topic.
- Preserve important facts, numbers, names, dates and technical terms.
- Never invent information that is not present in the video.
- ${input.languageName ? `Write the summary and key points in ${input.languageName}.` : 'Write the summary and key points in the language of the video.'}

Respond with ONLY a JSON object in exactly this shape:
{"summary": "3-5 concise sentences describing the video", "keyPoints": ["3-7 important points, each a single line"], "language": "ISO 639-1 code of the video's spoken language"}`,
      { json: true, fileData: { uri: input.videoUrl, mime: 'video/mp4' } },
    );
    const parsed = parseJsonObject(raw);
    const summary = typeof parsed?.summary === 'string' ? parsed.summary.trim() : '';
    const keyPoints = Array.isArray(parsed?.keyPoints)
      ? parsed.keyPoints.filter((p: unknown): p is string => typeof p === 'string' && p.trim().length > 0).map((p: string) => p.trim())
      : [];
    if (!summary) {
      throw new AppError('AI_FAILED', { message: 'The Gemini API returned an empty video summary. Please try again.' });
    }
    const sourceLanguageCode = typeof parsed?.language === 'string' && parsed.language.trim() ? parsed.language.trim().toLowerCase() : undefined;
    return { summary, keyPoints, sourceLanguageCode };
  }

  // -------------------------------------------------------- summarization ----
  async summarize(input: { transcript: string; languageName?: string }): Promise<SummaryResult> {
    const raw = await this.generateContent(summarizationPrompt(input.languageName, input.transcript), { json: true });
    return parseSummary(raw, 'summary', []);
  }

  // ---------------------------------------------------------- translation ----
  async translate(input: TranslationInput): Promise<SummaryResult> {
    const raw = await this.generateContent(translationPrompt(input), { json: true });
    return parseSummary(raw, 'translation', input.keyPoints);
  }

  // ------------------------------------------------------------- helpers ----
  private async request(
    endpoint: string,
    init: { method: string; headers?: Record<string, string>; body: string; timeoutMs: number },
  ): Promise<Response> {
    const base = this.cfg.baseUrl.replace(/\/+$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs);
    try {
      return await fetch(`${base}${endpoint}`, {
        method: init.method,
        headers: { 'x-goog-api-key': this.cfg.apiKey, ...(init.headers ?? {}) },
        body: init.body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

// ------------------------------------------------------------------ utils ----

const TRANSCRIPTION_PROMPT = `You are a speech-to-text engine. Transcribe the attached audio exactly as spoken.

Requirements:
- Output only the spoken words. Do not translate, paraphrase or add commentary.
- Ignore non-speech sounds (music, applause, sound effects); do not emit [Music]-style markers.
- Detect the spoken language and return its ISO 639-1 code (for example "en", "hi", "kn").
- If the audio contains no speech at all, return an empty text.

Respond with ONLY a JSON object in exactly this shape:
{"text": "full transcript", "language": "en", "duration": 12.5, "segments": [{"start": 0.0, "end": 5.1, "text": "first sentence"}]}
(segments are optional; include them only when timestamps are reliable)`;

function parseSummary(raw: string, what: 'summary' | 'translation', fallbackKeyPoints: string[]): SummaryResult {
  const parsed = parseJsonObject(raw);
  const summary = typeof parsed?.summary === 'string' ? parsed.summary.trim() : '';
  const keyPoints = Array.isArray(parsed?.keyPoints)
    ? parsed.keyPoints.filter((p: unknown): p is string => typeof p === 'string' && p.trim().length > 0).map((p: string) => p.trim())
    : fallbackKeyPoints;
  if (!summary) {
    throw new AppError('AI_FAILED', {
      message: `The Gemini API returned an empty ${what}. Please try again.`,
    });
  }
  return { summary, keyPoints };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
