export interface Language {
  /** ISO-639-1 code (as returned by Whisper-style transcription APIs). */
  code: string;
  /** English display name. */
  name: string;
  /** Native name, shown in the UI when available. */
  nativeName?: string;
  /** Optional flag emoji for the UI. */
  flag?: string;
}

/**
 * Target languages offered in the UI (radio buttons).
 * Adding a language = adding one entry here (backend validates against this
 * list; the frontend keeps the same list in src/types/languages.ts).
 */
export const LANGUAGES: Language[] = [
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇬🇧' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', flag: '🇮🇳' },
  { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ', flag: '🇮🇳' },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు', flag: '🇮🇳' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', flag: '🇮🇳' },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം', flag: '🇮🇳' },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी', flag: '🇮🇳' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', flag: '🇮🇳' },
  { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી', flag: '🇮🇳' },
  { code: 'pa', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', flag: '🇮🇳' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو', flag: '🇵🇰' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', flag: '🇰🇷' },
  { code: 'zh', name: 'Chinese', nativeName: '中文', flag: '🇨🇳' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', flag: '🇷🇺' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', flag: '🇵🇹' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', flag: '🇮🇹' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', flag: '🇹🇷' },
];

/** Display names for language codes a transcription API may report. */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', hi: 'Hindi', kn: 'Kannada', te: 'Telugu', ta: 'Tamil', ml: 'Malayalam',
  mr: 'Marathi', bn: 'Bengali', gu: 'Gujarati', pa: 'Punjabi', ur: 'Urdu', ne: 'Nepali',
  es: 'Spanish', fr: 'French', de: 'German', ja: 'Japanese', ko: 'Korean', zh: 'Chinese',
  ar: 'Arabic', ru: 'Russian', pt: 'Portuguese', it: 'Italian', tr: 'Turkish',
  nl: 'Dutch', sv: 'Swedish', no: 'Norwegian', da: 'Danish', fi: 'Finnish', pl: 'Polish',
  cs: 'Czech', sk: 'Slovak', hu: 'Hungarian', ro: 'Romanian', bg: 'Bulgarian',
  el: 'Greek', he: 'Hebrew', th: 'Thai', vi: 'Vietnamese', id: 'Indonesian',
  ms: 'Malay', fil: 'Filipino', uk: 'Ukrainian', ca: 'Catalan', fa: 'Persian',
  sw: 'Swahili', af: 'Afrikaans', sq: 'Albanian', am: 'Amharic', hy: 'Armenian',
  eu: 'Basque', be: 'Belarusian', bs: 'Bosnian', et: 'Estonian', gl: 'Galician',
  ka: 'Georgian', is: 'Icelandic', km: 'Khmer', lo: 'Lao', lt: 'Lithuanian',
  lv: 'Latvian', mk: 'Macedonian', my: 'Burmese', si: 'Sinhala', sr: 'Serbian',
  uz: 'Uzbek',
};

export function languageName(code: string | undefined | null): string {
  if (!code) return 'Unknown';
  const key = code.toLowerCase().split(/[-_]/)[0] ?? code;
  return LANGUAGE_NAMES[key] ?? LANGUAGE_NAMES[code] ?? code.toUpperCase();
}

export function languageByCode(code: string): Language | undefined {
  const key = code.toLowerCase().split(/[-_]/)[0] ?? code;
  return LANGUAGES.find((l) => l.code === key);
}

export function isSupportedTarget(code: string): boolean {
  return Boolean(languageByCode(code));
}

export function flagFor(code: string | undefined | null): string | undefined {
  if (!code) return undefined;
  return languageByCode(code)?.flag;
}

/**
 * Last-resort language detection based on the writing system of the transcript.
 * Used only when the speech-to-text provider does not report a language.
 * Returns undefined when the script is Latin/ambiguous.
 */
export function detectLanguageFromScript(text: string): string | undefined {
  const ranges: Array<[RegExp, string]> = [
    [/[ऀ-ॿ]/gu, 'hi'], // Devanagari (Hindi / Marathi)
    [/[ঀ-৿]/gu, 'bn'], // Bengali
    [/[਀-੿]/gu, 'pa'], // Gurmukhi
    [/[઀-૿]/gu, 'gu'], // Gujarati
    [/[ீ-௿]/gu, 'ta'], // Tamil
    [/[ఀ-౿]/gu, 'te'], // Telugu
    [/[ಀ-೿]/gu, 'kn'], // Kannada
    [/[ഀ-ൿ]/gu, 'ml'], // Malayalam
    [/[؀-ۿ]/gu, 'ar'], // Arabic script (Arabic / Urdu / Persian)
    [/[぀-ヿ]/gu, 'ja'], // Hiragana / Katakana
    [/[一-鿿]/gu, 'zh'], // CJK
    [/[가-힯]/gu, 'ko'], // Hangul
    [/[Ѐ-ӿ]/gu, 'ru'], // Cyrillic
    [/[฀-๿]/gu, 'th'], // Thai
    [/[ր-׿]/gu, 'he'], // Hebrew
  ];
  let best: { code: string; count: number } | undefined;
  for (const [re, code] of ranges) {
    const matches = text.match(re);
    const count = matches ? matches.length : 0;
    if (count > 0 && (!best || count > best.count)) best = { code, count };
  }
  if (!best) return undefined;
  // Arabic script: Urdu uses additional characters more often; keep generic.
  return best.code;
}
