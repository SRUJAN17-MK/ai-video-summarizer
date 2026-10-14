import type { AIProvider, SummaryResult, TranscriptionResult, TranslationInput } from './types.js';

/**
 * Deterministic provider used ONLY for automated testing / local pipeline
 * verification when no AI API key is available (AI_PROVIDER=mock).
 * It never produces real AI output and must not be used in production.
 */
export class MockProvider implements AIProvider {
  readonly name = 'mock';

  private readonly transcript =
    'Electric vehicles use battery powered motors instead of petrol engines. ' +
    'They produce no direct exhaust emissions which makes them better for city air quality. ' +
    'Charging infrastructure is the most important factor for wide adoption. ' +
    'Battery technology continues to improve and prices keep falling. ' +
    'Governments in many countries offer incentives to encourage buyers to switch. ' +
    'Overall the video explains how electric vehicles work and discusses their advantages over traditional petrol vehicles.';

  async transcribe(): Promise<TranscriptionResult> {
    const sentences = this.transcript.match(/[^.]+\./g) ?? [this.transcript];
    let cursor = 0;
    const segments = sentences.map((text) => {
      const start = cursor;
      const end = cursor + 4;
      cursor = end;
      return { start, end, text: text.trim() };
    });
    return {
      text: this.transcript,
      segments,
      language: 'en',
      languageConfidence: 0.96,
      durationSec: cursor,
    };
  }

  async summarize(_input?: { transcript?: string; languageName?: string }): Promise<SummaryResult> {
    const sentences = this.transcript.match(/[^.]+\./g) ?? [this.transcript];
    return {
      summary: sentences.slice(0, 4).map((s) => s.trim()).join(' '),
      keyPoints: sentences.slice(1, 6).map((s) => s.trim()),
    };
  }

  async summarizeVideo(input: { videoUrl: string; languageName?: string }): Promise<SummaryResult & { sourceLanguageCode?: string }> {
    const result = await this.summarize({ transcript: this.transcript });
    return { ...result, sourceLanguageCode: 'en' };
  }

  async translate(input: TranslationInput): Promise<SummaryResult> {
    const tag = `[${input.targetLanguageName}]`;
    return {
      summary: `${tag} ${input.summary}`,
      keyPoints: input.keyPoints.map((p) => `${tag} ${p}`),
    };
  }
}
