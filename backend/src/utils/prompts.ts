/**
 * Internal AI prompts. Kept server-side so they can evolve independently of
 * the UI.
 */

export function summarizationPrompt(languageName: string | undefined, transcript?: string): string {
  const langInstruction = languageName
    ? `Write the summary and the key points in ${languageName} (the language of the transcript).`
    : 'Write the summary and key points in the same language as the transcript.';
  return `You are an expert video content analyst. Analyze the transcript of a video and produce a genuinely useful summary.

Requirements:
- Understand the whole transcript and identify the main topic. Do NOT simply shorten every sentence.
- Remove repetition, filler words, tangents and stuttered speech.
- Preserve all important facts, numbers, names, dates and technical terms.
- Never invent information that is not present in the transcript.
- Ignore non-speech markers such as [Music], [Applause] or ♪ symbols.
- ${langInstruction}

Respond with ONLY a JSON object in exactly this shape:
{"summary": "3-5 concise sentences describing the video", "keyPoints": ["3-7 important points, each a single line"]}

--- TRANSCRIPT ---
${transcript ?? ''}`;
}

export function translationPrompt(input: {
  summary: string;
  keyPoints: string[];
  sourceLanguageName?: string;
  targetLanguageName: string;
}): string {
  const source = input.sourceLanguageName ? `Source language: ${input.sourceLanguageName}.` : '';
  const points = input.keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n');
  return `You are a professional translator. Translate the video summary and key points below into ${input.targetLanguageName}.

Rules:
- Preserve the original meaning exactly. Do not add or remove information.
- Use natural, fluent grammar in ${input.targetLanguageName} - never translate word-for-word.
- Keep names of people, places, brands, numbers, dates and technical terms accurate.
- Do not translate proper nouns when the standard practice is to keep them as-is.
- Keep the same number of key points.
${source}
Respond with ONLY a JSON object in exactly this shape:
{"summary": "translated summary", "keyPoints": ["translated point 1", ...]}

--- SUMMARY ---
${input.summary}

--- KEY POINTS ---
${points}`;
}
