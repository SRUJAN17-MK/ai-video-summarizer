import { AppError } from '../utils/errors.js';
import { getAIProvider } from './ai/index.js';
import type { SummaryResult } from './ai/index.js';

export async function generateSummary(transcript: string, languageName?: string): Promise<SummaryResult> {
  const provider = getAIProvider();
  const result = await provider.summarize({ transcript, languageName });

  const summary = result.summary.trim();
  if (!summary) throw new AppError('AI_FAILED', { message: 'The AI service returned an empty summary. Please try again.' });

  const keyPoints = (result.keyPoints ?? [])
    .map((p) => p.replace(/^[-•*\d.)\s]+/, '').trim())
    .filter((p) => p.length > 0)
    .slice(0, 7);

  // Never return an empty key point list - fall back to summary sentences.
  const points = keyPoints.length > 0 ? keyPoints : splitSentences(summary).slice(0, 5);

  return { summary, keyPoints: points };
}

function splitSentences(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text]).map((s) => s.trim()).filter(Boolean);
}
