import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { AppError, isAppError } from '../utils/errors.js';
import { languageByCode, languageName, detectLanguageFromScript } from '../utils/languages.js';
import { safeUnlink } from '../utils/files.js';
import { extractAudio, cleanSpeech, assertSpeechPresent, encodeSpeechAudio } from '../services/audioService.js';
import { getVideoAsset } from '../services/videoService.js';
import { transcribeAudio, cleanTranscript } from '../services/transcriptionService.js';
import { generateSummary } from '../services/summarizationService.js';
import { translateSummary } from '../services/translationService.js';
import {
  completeJob,
  failJob,
  getJob,
  markStage,
  type Job,
  type StageKey,
} from '../services/jobService.js';
import { childLogger } from '../utils/logger.js';

/**
 * Background processing pipeline:
 * video -> extract audio -> speech cleaning -> STT -> language detection ->
 * summary -> translation -> results
 */
export async function processJob(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job) return;
  const startedAt = Date.now();
  const log = childLogger('job', job.id);
  log.info('processing started', {
    jobId: job.id,
    videoId: job.videoId,
    targetLanguage: job.targetLanguageCode,
    generateAudio: job.generateAudio,
  });

  try {
    job.status = 'processing';
    job.updatedAt = Date.now();

    // ---------------------------------------------------------- received ----
    markStage(job, 'received', 'active');
    const asset = getVideoAsset(job.videoId);
    if (!asset) {
      throw new AppError('NOT_FOUND', { message: 'The video for this job is no longer available. Please upload it again.' });
    }
    markStage(job, 'received', 'done');

    const workDir = path.join(config.files.tmpDir, 'work', job.id);
    await fs.promises.mkdir(workDir, { recursive: true });
    job.workDir = workDir;
    const rawWav = path.join(workDir, 'raw.wav');
    const cleanWav = path.join(workDir, 'clean.wav');

    let transcript: any;
    let cleaning: { notice: string } = { notice: 'Transcript retrieved from YouTube captions.' };
    if (asset.transcriptText) {
      // Caption-based source: no local media to decode or transcribe.
      markStage(job, 'extract_audio', 'done');
      markStage(job, 'clean_speech', 'done');
      markStage(job, 'transcribe', 'active');
      const cleanedText = cleanTranscript(asset.transcriptText);
      if (!cleanedText || cleanedText.replace(/[^\p{L}\p{N}]+/gu, '').length < 2) {
        throw new AppError('NO_SPEECH', { message: 'This YouTube video has captions, but no usable speech was found. Please upload the video file instead.' });
      }
      const languageCode =
        asset.transcriptLanguageCode?.toLowerCase().split(/[-_]/)[0] ??
        detectLanguageFromScript(cleanedText) ??
        'en';
      transcript = {
        text: cleanedText,
        segments: [],
        languageCode,
        languageName: languageName(languageCode),
        languageConfidence: undefined,
        durationSec: asset.durationSec,
      };
      markStage(job, 'transcribe', 'done');
    } else {
      // --------------------------------------------------- extract audio ----
      markStage(job, 'extract_audio', 'active');
      await extractAudio(asset.filePath, rawWav);
      markStage(job, 'extract_audio', 'done');

      // --------------------------------------------------- clean speech ----
      markStage(job, 'clean_speech', 'active');
      cleaning = await cleanSpeech(rawWav, cleanWav);
      await assertSpeechPresent(cleanWav);
      markStage(job, 'clean_speech', 'done');

      // ---------------------------------------------------- transcribe ----
      markStage(job, 'transcribe', 'active');
      transcript = await transcribeAudio(cleanWav);
      markStage(job, 'transcribe', 'done');
    }

    // ----------------------------------------------- detect language ----
    markStage(job, 'detect_language', 'active');
    const detected = {
      code: transcript.languageCode,
      name: transcript.languageName,
      confidence: transcript.languageConfidence,
    };
    markStage(job, 'detect_language', 'done');

    // ------------------------------------------------------ summarize ----
    markStage(job, 'summarize', 'active');
    const target = languageByCode(job.targetLanguageCode);
    if (!target) throw new AppError('INVALID_INPUT', { message: 'Please choose a valid target language.' });
    const summary = await generateSummary(transcript.text, transcript.languageName);
    markStage(job, 'summarize', 'done');

    // ------------------------------------------------------ translate ----
    markStage(job, 'translate', 'active');
    const translation = await translateSummary(summary, target, transcript.languageCode);
    markStage(job, 'translate', 'done');

    // ------------------------------------------------ optional audio ----
    const notices: string[] = [cleaning.notice];
    let audioUrl: string | undefined;
    if (job.generateAudio) {
      if (asset.transcriptText) {
        notices.push('Speech-only audio is not available for caption-based YouTube videos. Upload the video file if you need it.');
      } else {
        try {
          const audioPath = await encodeSpeechAudio(cleanWav, job.id);
          job.audioPath = audioPath;
          audioUrl = `/api/jobs/${job.id}/audio`;
        } catch (err) {
          log.warn('speech-only audio generation failed', { err });
          notices.push('Speech-only audio could not be generated for this video.');
        }
      }
    }

    completeJob(job, {
      video: {
        name: asset.originalName,
        durationSec: asset.durationSec,
        durationLabel: asset.durationLabel,
        sizeLabel: asset.sizeLabel,
        origin: asset.origin,
        sourceUrl: asset.sourceUrl,
      },
      detectedLanguage: detected,
      targetLanguage: { code: target.code, name: target.name, flag: target.flag },
      summary,
      translation,
      transcript: transcript.text,
      transcriptSegments: transcript.segments,
      audioUrl,
      notices,
      processingTimeMs: Date.now() - startedAt,
      createdAt: job.createdAt,
    });
    log.info('processing completed', {
      durationMs: Date.now() - startedAt,
      language: detected.name,
      targetLanguage: target.name,
      hasAudio: Boolean(audioUrl),
    });

    // Intermediate audio is no longer needed unless we must serve it.
    safeUnlink(rawWav);
    if (!job.audioPath) safeUnlink(cleanWav);
  } catch (err) {
    const appError = isAppError(err)
      ? err
      : new AppError('PROCESSING_FAILED', { cause: err });
    // Never leak internals to the client.
    log.error(`processing failed (${appError.code}) after ${Date.now() - startedAt}ms`, {
      err,
      code: appError.code,
      durationMs: Date.now() - startedAt,
    });
    failJob(job, appError.code, appError.userMessage);
    cleanupJobFiles(job, { keepAudio: false });
  } finally {
    job.updatedAt = Date.now();
  }
}

export function cleanupJobFiles(job: Job, opts: { keepAudio: boolean } = { keepAudio: true }): void {
  if (job.workDir) {
    try {
      fs.rmSync(job.workDir, { recursive: true, force: true });
    } catch (err) {
      childLogger('job', job.id).warn('failed to remove work directory', { err });
    }
    job.workDir = undefined;
  }
  if (!opts.keepAudio && job.audioPath) {
    safeUnlink(job.audioPath);
    job.audioPath = undefined;
  }
}

export type { StageKey };
