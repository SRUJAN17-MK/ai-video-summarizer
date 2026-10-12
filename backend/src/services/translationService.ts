import type { Language } from '../utils/languages.js';
import { getAIProvider } from './ai/index.js';
import type { SummaryResult } from './ai/index.js';

export interface TranslationOutcome extends SummaryResult {
  /** True when the summary is already written in the target language. */
  alreadyTranslated: boolean;
}

/**
 * Translates the generated summary + key points (not the full transcript).
 */
export async function translateSummary(
  summaryResult: SummaryResult,
  target: Language,
  sourceLanguageCode?: string,
): Promise<TranslationOutcome> {
  if (sourceLanguageCode && sourceLanguageCode.toLowerCase().split(/[-_]/)[0] === target.code) {
    return { ...summaryResult, alreadyTranslated: true };
  }

  const provider = getAIProvider();
  const translated = await provider.translate({
    summary: summaryResult.summary,
    keyPoints: summaryResult.keyPoints,
    targetLanguageName: target.name,
  });

  return {
    summary: translated.summary.trim(),
    keyPoints: translated.keyPoints.length > 0 ? translated.keyPoints : summaryResult.keyPoints,
    alreadyTranslated: false,
  };
}
