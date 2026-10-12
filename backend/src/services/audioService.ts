import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { config } from '../config.js';
import { AppError } from '../utils/errors.js';
import { runFfmpeg, run, FFMPEG_PATH } from '../utils/ffmpeg.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ tag: 'audio' });

/**
 * Step 1 - extract the audio track from the video as 16 kHz mono WAV.
 */
export async function extractAudio(videoPath: string, outputWav: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(outputWav), { recursive: true });
  await runFfmpeg(
    ['-y', '-i', videoPath, '-vn', '-sn', '-dn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', outputWav],
    { timeoutMs: 10 * 60 * 1000 },
  );
  const stat = await fs.promises.stat(outputWav).catch(() => null);
  if (!stat || stat.size === 0) {
    throw new AppError('MEDIA_FAILED', { message: 'We could not extract audio from this video.' });
  }
}

export interface CleanAudioResult {
  /** Path to the cleaned (speech-enhanced) WAV file. */
  filePath: string;
  /** Human readable description of the method that was applied. */
  method: 'demucs' | 'ffmpeg-fallback';
  notice: string;
}

/**
 * Step 2 - reduce background music / noise while preserving speech.
 *
 * Preferred: Demucs two-stem vocal separation (opt-in, requires Python package).
 * Fallback (always available): FFT noise reduction + band filtering + loudness
 * normalisation implemented with FFmpeg filters. Perfect separation is not
 * guaranteed - the notice returned here is surfaced in the UI.
 */
export async function cleanSpeech(inputWav: string, outputWav: string): Promise<CleanAudioResult> {
  await fs.promises.mkdir(path.dirname(outputWav), { recursive: true });

  if (config.demucs.enabled) {
    const separated = await tryDemucs(inputWav);
    if (separated) {
      await runFfmpeg(
        ['-y', '-i', separated, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', outputWav],
        { timeoutMs: 5 * 60 * 1000 },
      );
      return {
        filePath: outputWav,
        method: 'demucs',
        notice:
          'Speech was isolated with an AI source-separation model (Demucs). Separation is good but not perfect - some background audio may remain.',
      };
    }
  }

  const filter = [
    'highpass=f=80', // remove rumble / low-frequency music
    'lowpass=f=7500', // keep the speech band (input is 16 kHz -> Nyquist 8 kHz)
    'afftdn=nf=-30:tn=1', // FFT-based noise reduction
    'loudnorm=I=-16:TP=-1.5:LRA=11', // consistent speech volume
    'aresample=16000',
  ].join(',');

  await runFfmpeg(['-y', '-i', inputWav, '-ac', '1', '-ar', '16000', '-af', filter, '-c:a', 'pcm_s16le', outputWav], {
    timeoutMs: 10 * 60 * 1000,
  });

  return {
    filePath: outputWav,
    method: 'ffmpeg-fallback',
    notice:
      'Advanced AI speech/music separation was unavailable, so a robust fallback was applied (FFT noise reduction, band filtering and loudness normalisation). Background music is reduced, not removed perfectly.',
  };
}

async function tryDemucs(inputWav: string): Promise<string | undefined> {
  try {
    const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'demucs-'));
    const res = await run(
      config.demucs.command,
      ['--two-stems', 'vocals', '-o', workDir, inputWav],
      { timeoutMs: 20 * 60 * 1000 },
    );
    if (res.code !== 0) return undefined;
    const base = path.basename(inputWav, path.extname(inputWav));
    const candidate = path.join(workDir, 'htdemucs', base, 'vocals.wav');
    if (fs.existsSync(candidate)) return candidate;
    // Older layouts place output directly under workDir/<model>/<track>/
    const alt = path.join(workDir, base, 'vocals.wav');
    return fs.existsSync(alt) ? alt : undefined;
  } catch (err) {
    log.warn('demucs separation failed, continuing with plain cleanup', { err });
    return undefined;
  }
}

/**
 * Cheap speech-presence check: measures the overall RMS level of the cleaned
 * audio. A track that is essentially silence never reaches the AI services.
 */
export async function assertSpeechPresent(audioPath: string): Promise<void> {
  const res = await run(
    FFMPEG_PATH,
    ['-hide_banner', '-nostdin', '-i', audioPath, '-af', 'astats', '-f', 'null', '-'],
    { timeoutMs: 5 * 60 * 1000 },
  );

  const match = res.stderr.match(/RMS level dB:\s*(-?[\d.]+|inf|-inf)/i);
  if (!match) return;
  const raw = match[1].toLowerCase();
  if (raw === 'inf' || raw === '-inf') throw new AppError('NO_SPEECH');
  const rms = Number(raw);
  if (Number.isFinite(rms) && rms <= -55) throw new AppError('NO_SPEECH');
}

/**
 * Optional deliverable: an audio file with the same speech enhancement applied,
 * encoded for streaming in the browser.
 */
export async function encodeSpeechAudio(cleanedWav: string, jobId: string): Promise<string> {
  const dir = config.files.audioDir;
  await fs.promises.mkdir(dir, { recursive: true });
  const mp3Path = path.join(dir, `${jobId}.mp3`);

  try {
    await runFfmpeg(['-y', '-i', cleanedWav, '-c:a', 'libmp3lame', '-b:a', '128k', mp3Path], {
      timeoutMs: 5 * 60 * 1000,
    });
    return mp3Path;
  } catch (err) {
    log.warn('mp3 encoding failed, falling back to m4a', { err, jobId });
    const m4aPath = path.join(dir, `${jobId}.m4a`);
    await runFfmpeg(['-y', '-i', cleanedWav, '-c:a', 'aac', '-b:a', '128k', m4aPath], {
      timeoutMs: 5 * 60 * 1000,
    });
    return m4aPath;
  }
}
