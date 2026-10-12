export type ErrorCode =
  | 'INVALID_INPUT'
  | 'UNSUPPORTED_FILE'
  | 'FILE_TOO_LARGE'
  | 'INVALID_URL'
  | 'DOWNLOAD_FAILED'
  | 'NO_SPEECH'
  | 'AI_NOT_CONFIGURED'
  | 'AI_FAILED'
  | 'PROCESSING_FAILED'
  | 'MEDIA_FAILED'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'TIMEOUT';

const USER_MESSAGES: Record<ErrorCode, string> = {
  INVALID_INPUT: 'Please provide a valid video file or a publicly accessible video URL.',
  UNSUPPORTED_FILE:
    'This video format is not supported. Please upload MP4, WebM, MOV, AVI, or MKV.',
  FILE_TOO_LARGE: 'This file is too large. Please upload a smaller video and try again.',
  INVALID_URL: 'Please enter a valid publicly accessible video URL.',
  DOWNLOAD_FAILED:
    'We could not download the video from that URL. Make sure it is a direct, publicly accessible video link.',
  NO_SPEECH:
    'No clear speech was detected in this video. Please try another video with audible speech.',
  AI_NOT_CONFIGURED:
    'The AI service is not configured on this server. Add an AI API key to the .env file (AI_API_KEY or GEMINI_API_KEY) and try again.',
  AI_FAILED: 'The AI service could not complete this request. Please try again in a moment.',
  PROCESSING_FAILED: "We couldn't process this video. Please try again or use another video.",
  MEDIA_FAILED:
    'We could not read the audio in this video. The file may be corrupted or use an unsupported codec.',
  NOT_FOUND: 'The requested item could not be found. It may have expired and been cleaned up.',
  RATE_LIMITED: 'Too many requests. Please wait a moment and try again.',
  TIMEOUT: 'The operation took too long and was stopped. Please try again with a shorter video.',
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly userMessage: string;

  constructor(code: ErrorCode, options?: { status?: number; message?: string; cause?: unknown }) {
    super(options?.message ?? USER_MESSAGES[code], { cause: options?.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = options?.status ?? defaultStatus(code);
    this.userMessage = options?.message ?? USER_MESSAGES[code];
  }
}

function defaultStatus(code: ErrorCode): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'FILE_TOO_LARGE':
      return 413;
    case 'RATE_LIMITED':
      return 429;
    case 'TIMEOUT':
      return 504;
    case 'AI_NOT_CONFIGURED':
      return 503;
    default:
      return 400;
  }
}

export function userMessageFor(code: ErrorCode): string {
  return USER_MESSAGES[code];
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
