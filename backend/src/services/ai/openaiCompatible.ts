import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../../utils/errors.js';
import { summarizationPrompt, translationPrompt } from '../../utils/prompts.js';
import { logger } from '../../utils/logger.js';
import type { AIProvider, SummaryResult, TranscriptionResult, TranslationInput } from './types.js';

const log = logger.child({ tag: 'ai:openai' });

export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  transcriptionModel: string;
  timeoutMs: number;
}

/**
 * Works with any OpenAI-compatible API:
 *   OpenAI, Groq, OpenRouter, Together, local llama.cpp / LM Studio, etc.
 */
export class OpenAICompatibleProvider implements AIProvider {
  readonly name = 'openai-compatible';

  constructor(private readonly cfg: OpenAICompatibleConfig) {}

  // ---------------------------------------------------------------- chat ----
  private async chat(userPrompt: string, opts: { json: boolean; timeoutMs?: number }): Promise<string> {
    const timeoutMs = opts.timeoutMs ?? this.cfg.timeoutMs;
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: 'You are a precise, careful assistant. Follow the user instructions exactly.',
        },
        { role: 'user', content: userPrompt },
      ],
    };
    if (opts.json) body.response_format = { type: 'json_object' };

    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(800 * 2 ** (attempt - 1));

      let res: Response;
      try {
        res = await this.request('/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          timeoutMs,
        });
      } catch (err) {
        log.warn(`chat request failed (attempt ${attempt + 1}/3)`, { err, model: this.cfg.model });
        lastError = new AppError('AI_FAILED', {
          message: 'Could not reach the AI service. Check the server network connection and AI_BASE_URL.',
          cause: err,
        });
        continue;
      }

      if (!res.ok) {
        const text = await safeText(res);
        // Some compatible servers reject response_format - retry without it.
        if (opts.json && res.status === 400 && /response_format|json_object/i.test(text)) {
          delete body.response_format;
          log.warn('retrying without response_format after HTTP 400', { model: this.cfg.model });
          continue;
        }
        const httpError = new AppError('AI_FAILED', { message: friendlyHttpError(res.status, text) });
        if (res.status === 429 || res.status >= 500) {
          log.warn(`chat request got HTTP ${res.status} (attempt ${attempt + 1}/3)`, {
            model: this.cfg.model,
            status: res.status,
          });
          lastError = httpError;
          continue;
        }
        throw httpError;
      }

      const data: any = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new AppError('AI_FAILED', { message: 'The AI service returned an empty response. Please try again.' });
      }
      return content.trim();
    }
    throw lastError instanceof AppError ? lastError : new AppError('AI_FAILED', { cause: lastError });
  }

  // -------------------------------------------------------- transcription ----
  async transcribe(audioPath: string, opts: { timeoutMs?: number } = {}): Promise<TranscriptionResult> {
    const buffer = await fs.promises.readFile(audioPath);
    const attempt = async (responseFormat: string): Promise<Response> => {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(buffer)], { type: 'audio/wav' }), path.basename(audioPath) || 'speech.wav');
      form.append('model', this.cfg.transcriptionModel);
      form.append('response_format', responseFormat);
      form.append('temperature', '0');
      return this.request('/audio/transcriptions', {
        method: 'POST',
        body: form,
        timeoutMs: opts.timeoutMs ?? this.cfg.timeoutMs,
        absolutePath: true,
      });
    };

    let res = await attempt('verbose_json');
    if (!res.ok && res.status === 400) {
      res = await attempt('json');
    }
    if (!res.ok) {
      const text = await safeText(res);
      throw new AppError('AI_FAILED', { message: friendlyHttpError(res.status, text), cause: new Error(text.slice(0, 500)) });
    }

    const data: any = await res.json();
    const text = typeof data?.text === 'string' ? data.text : '';
    const segments = Array.isArray(data?.segments)
      ? data.segments
          .map((s: any) => ({
            start: Number(s?.start ?? 0),
            end: Number(s?.end ?? 0),
            text: String(s?.text ?? '').trim(),
          }))
          .filter((s: { text: string }) => s.text.length > 0)
      : [];

    const confidence =
      typeof data?.language_confidence === 'number'
        ? data.language_confidence
        : typeof data?.confidence === 'number'
          ? data.confidence
          : undefined;

    return {
      text,
      segments,
      language: typeof data?.language === 'string' ? data.language : undefined,
      languageConfidence: confidence !== undefined && confidence <= 1 ? confidence : undefined,
      durationSec: typeof data?.duration === 'number' ? data.duration : undefined,
    };
  }

  // -------------------------------------------------------- summarization ----
  async summarize(input: { transcript: string; languageName?: string }): Promise<SummaryResult> {
    const raw = await this.chat(summarizationPrompt(input.languageName, input.transcript), { json: true });
    const parsed = parseJsonObject(raw);
    const summary = typeof parsed?.summary === 'string' ? parsed.summary.trim() : '';
    const keyPoints = Array.isArray(parsed?.keyPoints)
      ? parsed.keyPoints.filter((p: unknown): p is string => typeof p === 'string' && p.trim().length > 0).map((p: string) => p.trim())
      : [];
    if (!summary) {
      throw new AppError('AI_FAILED', { message: 'The AI service returned an empty summary. Please try again.' });
    }
    return { summary, keyPoints };
  }

  // ---------------------------------------------------------- translation ----
  async translate(input: TranslationInput): Promise<SummaryResult> {
    const raw = await this.chat(translationPrompt(input), { json: true });
    const parsed = parseJsonObject(raw);
    const summary = typeof parsed?.summary === 'string' ? parsed.summary.trim() : '';
    const keyPoints = Array.isArray(parsed?.keyPoints)
      ? parsed.keyPoints.filter((p: unknown): p is string => typeof p === 'string' && p.trim().length > 0).map((p: string) => p.trim())
      : input.keyPoints.slice();
    if (!summary) {
      throw new AppError('AI_FAILED', { message: 'The AI service returned an empty translation. Please try again.' });
    }
    return { summary, keyPoints };
  }

  // ------------------------------------------------------------- helpers ----
  private async request(
    endpoint: string,
    init: { method: string; headers?: Record<string, string>; body?: string | FormData | Uint8Array; timeoutMs: number; absolutePath?: boolean },
  ): Promise<Response> {
    const url = init.absolutePath ? `${this.cfg.baseUrl}${endpoint}` : `${this.cfg.baseUrl}${endpoint}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs);
    try {
      return await fetch(url, {
        method: init.method,
        headers: { authorization: `Bearer ${this.cfg.apiKey}`, ...(init.headers ?? {}) },
        body: init.body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

// ------------------------------------------------------------------ utils ----

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

export function friendlyHttpError(status: number, body: string, keyName = 'AI_API_KEY'): string {
  // Gemini reports bad keys as HTTP 400 with reason API_KEY_INVALID.
  const invalidKey = /API_KEY_INVALID|API key not valid|incorrect API key|invalid (api )?key/i.test(body);
  if (status === 401 || status === 403 || invalidKey) {
    return `The AI service rejected the API key. Check ${keyName} in your server configuration.`;
  }
  const quota = /quota|resource[_ -]?exhausted|rate limit|too many requests/i.test(body);
  if (status === 429 || quota) {
    return 'The AI service quota or rate limit was reached. Wait a moment or check your plan/billing, then try again.';
  }
  const unsupportedFormat = /unsupported (file|format|mime|audio)|invalid (file|format|mime|audio)|media type|not (supported|allowed)/i.test(body);
  if (status === 415 || (status === 400 && unsupportedFormat)) {
    return 'This audio or video format is not supported by the configured AI service. Try a different file format (MP4 with standard codecs).';
  }
  if (status === 404) {
    return 'The configured AI model or endpoint was not found. Check AI_BASE_URL, AI_MODEL, and AI_TRANSCRIPTION_MODEL.';
  }
  if (status >= 500) {
    return 'The AI service is currently unavailable. Please try again shortly.';
  }
  const detail = jsonErrorMessage(body) ?? body.slice(0, 200).replace(/\s+/g, ' ').trim();
  return detail ? `The AI service could not complete the request: ${detail}` : 'The AI service could not complete the request.';
}

/** Pulls the human-readable `error.message` out of a JSON error body, if any. */
function jsonErrorMessage(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body);
    const message = parsed?.error?.message;
    if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 200);
  } catch {
    /* not JSON */
  }
  return undefined;
}

export function parseJsonObject(raw: string): Record<string, unknown> | undefined {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) text = fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
