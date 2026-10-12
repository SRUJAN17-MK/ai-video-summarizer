import { AppError } from '../utils/errors.js';
import { detectLanguageFromScript, languageName } from '../utils/languages.js';
import { getAIProvider } from './ai/index.js';
import type { TranscriptSegment } from './ai/index.js';

export interface TranscriptResult {
  /** Cleaned, human readable transcript. */
  text: string;
  segments: TranscriptSegment[];
  languageCode?: string;
  languageName: string;
  languageConfidence?: number;
  durationSec?: number;
}

const NON_SPEECH_MARKERS = [
  /\[[^\]]{1,40}\]/g, // [Music], [Applause], [silence]
  /【[^】]{1,40}】/g,
  /♪[^♪]{0,200}♪/g,
  /<[^>]{1,40}>/g,
];

/**
 * Removes non-speech markers, normalises whitespace and groups the transcript
 * into short paragraphs for display.
 */
export function cleanTranscript(raw: string): string {
  let text = raw ?? '';
  for (const marker of NON_SPEECH_MARKERS) text = text.replace(marker, ' ');
  text = text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,.;:!?])(?=[^\s])/g, '$1 ')
    .trim();

  if (!text) return '';

  const sentences = text.match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/g) ?? [text];
  const paragraphs: string[] = [];
  let buffer: string[] = [];
  for (const sentence of sentences) {
    const s = sentence.trim();
    if (!s) continue;
    buffer.push(s);
    if (buffer.length >= 3) {
      paragraphs.push(buffer.join(' '));
      buffer = [];
    }
  }
  if (buffer.length > 0) paragraphs.push(buffer.join(' '));
  return paragraphs.join('\n');
}

export async function transcribeAudio(audioPath: string): Promise<TranscriptResult> {
  const provider = getAIProvider();
  const result = await provider.transcribe(audioPath);

  const text = cleanTranscript(result.text);
  if (!text || text.replace(/[^\p{L}\p{N}]+/gu, '').length < 2) {
    throw new AppError('NO_SPEECH');
  }

  const languageCode = result.language?.toLowerCase() ?? detectLanguageFromScript(text);

  return {
    text,
    segments: result.segments,
    languageCode,
    languageName: languageName(languageCode),
    languageConfidence: result.languageConfidence,
    durationSec: result.durationSec,
  };
}
