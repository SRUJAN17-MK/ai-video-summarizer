export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptionResult {
  text: string;
  segments: TranscriptSegment[];
  /** ISO-639-1 code reported by the speech-to-text model, when available. */
  language?: string;
  /** Only populated when the provider genuinely returns a confidence value. */
  languageConfidence?: number;
  durationSec?: number;
}

export interface SummaryResult {
  summary: string;
  keyPoints: string[];
}

export interface TranslationInput {
  summary: string;
  keyPoints: string[];
  sourceLanguageName?: string;
  targetLanguageName: string;
}

/**
 * Provider abstraction - swap implementations without touching the pipeline.
 * Configure with AI_PROVIDER / AI_API_KEY / AI_BASE_URL / AI_MODEL.
 */
export interface AIProvider {
  readonly name: string;
  transcribe(audioPath: string, opts?: { timeoutMs?: number }): Promise<TranscriptionResult>;
  summarize(input: { transcript: string; languageName?: string }): Promise<SummaryResult>;
  /** Direct Gemini video input (e.g. public YouTube URLs) when no transcript is available. */
  summarizeVideo(input: { videoUrl: string; languageName?: string }): Promise<SummaryResult & { sourceLanguageCode?: string }>;
  translate(input: TranslationInput): Promise<SummaryResult>;
}
