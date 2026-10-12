import { config } from '../../config.js';
import { AppError } from '../../utils/errors.js';
import { GeminiProvider } from './gemini.js';
import { MockProvider } from './mock.js';
import { OpenAICompatibleProvider } from './openaiCompatible.js';
import type { AIProvider } from './types.js';

export type { AIProvider, SummaryResult, TranscriptionResult, TranscriptSegment, TranslationInput } from './types.js';

let cached: AIProvider | undefined;

export function aiProviderKind(): string {
  return config.ai.provider;
}

function resolvedGeminiKey(): string {
  return config.ai.geminiKey || config.ai.apiKey;
}

/** True when the active provider has everything it needs to run. */
export function aiConfigured(): boolean {
  if (config.ai.provider === 'mock') return true;
  if (config.ai.provider === 'gemini') return Boolean(resolvedGeminiKey());
  return Boolean(config.ai.apiKey);
}

/** Throws a friendly, user-safe error when the server has no AI credentials. */
export function assertAIConfigured(): void {
  if (aiConfigured()) return;
  throw new AppError('AI_NOT_CONFIGURED');
}

export function getAIProvider(): AIProvider {
  if (cached) return cached;

  if (config.ai.provider === 'mock') {
    cached = new MockProvider();
    return cached;
  }

  if (config.ai.provider === 'gemini') {
    const key = resolvedGeminiKey();
    if (!key) throw new AppError('AI_NOT_CONFIGURED');
    cached = new GeminiProvider({
      baseUrl: config.ai.baseUrl,
      apiKey: key,
      model: config.ai.model,
      transcriptionModel: config.ai.transcriptionModel,
      timeoutMs: config.ai.timeoutMs,
    });
    return cached;
  }

  if (!config.ai.apiKey) {
    throw new AppError('AI_NOT_CONFIGURED');
  }

  cached = new OpenAICompatibleProvider({
    baseUrl: config.ai.baseUrl,
    apiKey: config.ai.apiKey,
    model: config.ai.model,
    transcriptionModel: config.ai.transcriptionModel,
    timeoutMs: config.ai.timeoutMs,
  });
  return cached;
}
