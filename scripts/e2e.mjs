#!/usr/bin/env node
/**
 * End-to-end test of the AI Video Summarizer backend.
 *
 * - boots the API in an isolated temp dir with AI_PROVIDER=mock (no API key needed)
 * - runs the full pipeline on a real generated video (upload -> analyze -> poll -> results)
 * - verifies optional speech-only audio, error handling, SSRF protection,
 *   missing-AI-key behaviour and rate limiting
 * - exercises the real OpenAICompatibleProvider and GeminiProvider code paths
 *   against local fake APIs (no real keys required)
 *
 * Usage: npm run test:e2e
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const testData = path.join(root, 'testdata');
const speechVideo = path.join(testData, 'sample-speech.mp4');
const silentVideo = path.join(testData, 'sample-silent.mp4');
const silenceVideo = path.join(testData, 'sample-silence.mp4');

let failures = 0;
let checks = 0;

function ok(condition, label, extra = '') {
  checks += 1;
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${extra ? ` -- ${extra}` : ''}`);
  }
}

function section(title) {
  console.log(`\n== ${title}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return await res.json();
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error(`server on port ${port} did not become healthy`);
}

function startServer(port, env = {}) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: path.join(root, 'backend'),
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'development',
      AI_PROVIDER: 'openai',
      AI_API_KEY: '',
      RATE_LIMIT_MAX: '500',
      ANALYZE_RATE_LIMIT_MAX: '100',
      TMP_DIR: path.join(root, '.tmp-e2e'),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write(`   [server:${port}] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`   [server:${port}!] ${d}`));
  return child;
}

async function json(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function pollJob(port, jobId, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const res = await fetch(`http://127.0.0.1:${port}/api/jobs/${jobId}`);
    last = await json(res);
    if (last.status === 'completed' || last.status === 'failed') return last;
    await sleep(500);
  }
  return last;
}

async function main() {
  if (!fs.existsSync(speechVideo) || !fs.existsSync(silentVideo) || !fs.existsSync(silenceVideo)) {
    console.error('Sample videos missing. Run: powershell -File scripts/generate-samples.ps1');
    process.exit(1);
  }

  const mainPort = 4123;
  const auxPort = 4124;
  const tmpDir = path.join(root, '.tmp-e2e');
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const mainServer = startServer(mainPort, { AI_PROVIDER: 'mock' });
  const auxServer = startServer(auxPort, { RATE_LIMIT_MAX: '12', ANALYZE_RATE_LIMIT_MAX: '3' });
  const children = [mainServer, auxServer];
  let fakeAi = null;
  let fakeGemini = null;

  try {
    const health = await waitForHealth(mainPort);
    section('health / configuration');
    ok(health.ok === true, 'GET /api/health returns ok');
    ok(health.aiProvider === 'mock', 'mock provider active for tests');
    ok(typeof health.maxUploadMb === 'number' && health.maxUploadMb > 0, 'max upload size reported');

    // ---------------------------------------------------------------- upload
    section('video upload');
    const bytes = fs.readFileSync(speechVideo);
    const form = new FormData();
    form.append('video', new Blob([bytes], { type: 'video/mp4' }), 'sample-speech.mp4');
    const uploadRes = await fetch(`http://127.0.0.1:${mainPort}/api/video/upload`, { method: 'POST', body: form });
    const uploadBody = await json(uploadRes);
    ok(uploadRes.status === 201, 'POST /api/video/upload -> 201');
    ok(Boolean(uploadBody.video?.videoId), 'videoId returned', JSON.stringify(uploadBody).slice(0, 200));
    ok(uploadBody.video?.durationSec > 1, 'duration extracted with ffprobe', `got ${uploadBody.video?.durationSec}`);

    const videoId = uploadBody.video?.videoId;

    // -------------------------------------------------------------- validate
    section('input validation');
    const noLang = await fetch(`http://127.0.0.1:${mainPort}/api/video/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ videoId }),
    });
    const noLangBody = await json(noLang);
    ok(noLang.status === 400 && noLangBody.error?.code === 'INVALID_INPUT', 'missing target language -> 400');

    const noVideo = await fetch(`http://127.0.0.1:${mainPort}/api/video/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetLanguage: 'en' }),
    });
    ok(noVideo.status === 400, 'missing video -> 400');

    const unknownJob = await fetch(`http://127.0.0.1:${mainPort}/api/jobs/job_does_not_exist`);
    ok(unknownJob.status === 404, 'unknown job -> 404');

    const badText = new FormData();
    badText.append('video', new Blob([Buffer.from('this is not a video at all')], { type: 'text/plain' }), 'notes.txt');
    const badUpload = await fetch(`http://127.0.0.1:${mainPort}/api/video/upload`, { method: 'POST', body: badText });
    const badUploadBody = await json(badUpload);
    ok(badUpload.status === 400 && badUploadBody.error?.code === 'UNSUPPORTED_FILE', 'unsupported extension -> 400 UNSUPPORTED_FILE', `got ${badUpload.status} ${JSON.stringify(badUploadBody)}`);

    const fakeMp4 = new FormData();
    fakeMp4.append('video', new Blob([Buffer.from('pretending to be a video but it is plain text')], { type: 'video/mp4' }), 'fake.mp4');
    const fakeUpload = await fetch(`http://127.0.0.1:${mainPort}/api/video/upload`, { method: 'POST', body: fakeMp4 });
    const fakeUploadBody = await json(fakeUpload);
    ok(fakeUpload.status === 400 && fakeUploadBody.error?.code === 'UNSUPPORTED_FILE', 'corrupt mp4 -> 400 UNSUPPORTED_FILE', `got ${fakeUpload.status} ${JSON.stringify(fakeUploadBody)}`);

    // ------------------------------------------------------------------ SSRF
    section('URL validation / SSRF protection');
    for (const badUrl of ['http://127.0.0.1/video.mp4', 'http://localhost/video.mp4', 'ftp://example.com/video.mp4', 'not a url', 'http://169.254.169.254/latest/meta-data']) {
      const res = await fetch(`http://127.0.0.1:${mainPort}/api/video/url`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: badUrl }),
      });
      const body = await json(res);
      ok(res.status === 400 && body.error?.code === 'INVALID_URL', `blocked: ${badUrl}`);
    }

    // -------------------------------------------------------------- pipeline
    section('full analysis pipeline (upload -> stages -> results)');
    const analyzeRes = await fetch(`http://127.0.0.1:${mainPort}/api/video/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ videoId, targetLanguage: 'hi', generateAudio: true }),
    });
    const analyzeBody = await json(analyzeRes);
    ok(analyzeRes.status === 202 && analyzeBody.status === 'processing', 'POST /api/video/analyze -> 202 with jobId', JSON.stringify(analyzeBody).slice(0, 200));
    const jobId = analyzeBody.jobId;

    const midJob = await (await fetch(`http://127.0.0.1:${mainPort}/api/jobs/${jobId}`)).json();
    ok(midJob.stages?.received !== undefined, 'job exposes stage map');

    const finished = await pollJob(mainPort, jobId);
    ok(finished?.status === 'completed', 'job completed', JSON.stringify(finished).slice(0, 300));
    const allDone = finished && Object.values(finished.stages).every((s) => s === 'done');
    ok(Boolean(allDone), 'all pipeline stages marked done', JSON.stringify(finished?.stages));

    const resultsRes = await fetch(`http://127.0.0.1:${mainPort}/api/jobs/${jobId}/results`);
    const results = await json(resultsRes);
    ok(resultsRes.status === 200, 'GET /api/jobs/:id/results -> 200');
    ok(typeof results.summary?.summary === 'string' && results.summary.summary.length > 40, 'summary present');
    ok(Array.isArray(results.summary?.keyPoints) && results.summary.keyPoints.length >= 3 && results.summary.keyPoints.length <= 7, `key points count (${results.summary?.keyPoints?.length})`);
    ok(typeof results.translation?.summary === 'string' && results.translation.summary.includes('[Hindi]'), 'translated summary produced for Hindi');
    ok(results.detectedLanguage?.name === 'English', 'language detected', JSON.stringify(results.detectedLanguage));
    ok(results.targetLanguage?.code === 'hi', 'target language echoed');
    ok(typeof results.transcript === 'string' && results.transcript.length > 40, 'transcript present');
    ok(Array.isArray(results.notices) && results.notices.length > 0, 'audio-processing notices surfaced');
    ok(Boolean(results.audioUrl), 'speech-only audio generated');
    ok(results.video?.durationLabel?.length > 0, 'video duration label present');

    const aliasRes = await fetch(`http://127.0.0.1:${mainPort}/api/results/${jobId}`);
    ok(aliasRes.status === 200, 'GET /api/results/:jobId alias works');

    if (results.audioUrl) {
      const audioRes = await fetch(`http://127.0.0.1:${mainPort}${results.audioUrl}`);
      const audioBuf = Buffer.from(await audioRes.arrayBuffer());
      ok(audioRes.status === 200 && audioBuf.length > 10000, `audio stream downloadable (${audioBuf.length} bytes)`);
    } else {
      ok(false, 'audio stream downloadable (audioUrl missing)');
    }

    // --------------------------------------------------------- no-speech path
    section('no-speech handling');
    const silenceForm = new FormData();
    silenceForm.append('video', new Blob([fs.readFileSync(silenceVideo)], { type: 'video/mp4' }), 'sample-silence.mp4');
    const silenceUpload = await json(await fetch(`http://127.0.0.1:${mainPort}/api/video/upload`, { method: 'POST', body: silenceForm }));
    ok(Boolean(silenceUpload.video?.videoId), 'silent video uploaded');
    const silenceAnalyze = await json(
      await fetch(`http://127.0.0.1:${mainPort}/api/video/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ videoId: silenceUpload.video.videoId, targetLanguage: 'en' }),
      }),
    );
    const silenceJob = await pollJob(mainPort, silenceAnalyze.jobId, 60000);
    ok(silenceJob?.status === 'failed', 'silent job fails cleanly', JSON.stringify(silenceJob).slice(0, 300));
    ok(
      /no clear speech|does not contain an audio track/i.test(silenceJob?.error ?? ''),
      'friendly no-speech message',
      silenceJob?.error,
    );

    // music-only video must reach a terminal state without crashing the server
    const musicForm = new FormData();
    musicForm.append('video', new Blob([fs.readFileSync(silentVideo)], { type: 'video/mp4' }), 'sample-silent.mp4');
    const musicUpload = await json(await fetch(`http://127.0.0.1:${mainPort}/api/video/upload`, { method: 'POST', body: musicForm }));
    const musicAnalyze = await json(
      await fetch(`http://127.0.0.1:${mainPort}/api/video/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ videoId: musicUpload.video.videoId, targetLanguage: 'en' }),
      }),
    );
    const musicJob = await pollJob(mainPort, musicAnalyze.jobId, 60000);
    ok(
      musicJob?.status === 'completed' || musicJob?.status === 'failed',
      'music-only video reaches a terminal state without server error',
      JSON.stringify(musicJob).slice(0, 200),
    );

    // -------------------------------------- openai-compatible provider path
    section('openai-compatible provider (against local fake AI API)');
    fakeAi = await startFakeAiServer();
    const fakePort = fakeAi.address().port;
    const providerPort = 4125;
    const providerServer = startServer(providerPort, {
      AI_PROVIDER: 'openai',
      AI_API_KEY: 'test-key',
      AI_BASE_URL: `http://127.0.0.1:${fakePort}/v1`,
      AI_MODEL: 'fake-model',
      AI_TRANSCRIPTION_MODEL: 'fake-whisper',
      RATE_LIMIT_MAX: '500',
    });
    children.push(providerServer);
    await waitForHealth(providerPort);

    const provForm = new FormData();
    provForm.append('video', new Blob([bytes], { type: 'video/mp4' }), 'sample-speech.mp4');
    const provUpload = await json(await fetch(`http://127.0.0.1:${providerPort}/api/video/upload`, { method: 'POST', body: provForm }));

    // target language == detected language -> translation should be skipped
    const provAnalyzeSame = await json(
      await fetch(`http://127.0.0.1:${providerPort}/api/video/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ videoId: provUpload.video.videoId, targetLanguage: 'kn' }),
      }),
    );
    const provJobSame = await pollJob(providerPort, provAnalyzeSame.jobId, 60000);
    ok(provJobSame?.status === 'completed', 'provider pipeline completed', JSON.stringify(provJobSame).slice(0, 300));
    const provResults = await json(await fetch(`http://127.0.0.1:${providerPort}/api/jobs/${provAnalyzeSame.jobId}/results`));
    ok(provResults.detectedLanguage?.name === 'Kannada' && provResults.detectedLanguage?.code === 'kn', 'language from verbose_json', JSON.stringify(provResults.detectedLanguage));
    ok(typeof provResults.summary?.summary === 'string' && provResults.summary.summary.includes('ಪರೀಕ್ಷಾ ಸಾರಾಂಶ'), 'summary produced by chat completions');
    ok(provResults.translation?.alreadyTranslated === true, 'translation skipped when target == detected');
    ok(provResults.translation?.summary === provResults.summary.summary, 'translation mirrors summary in skip case');
    ok(Array.isArray(provResults.transcriptSegments) && provResults.transcriptSegments.length === 3, 'segments preserved internally', String(provResults.transcriptSegments?.length));
    ok(!/^\s/.test(provResults.transcript), 'transcript cleaned of leading whitespace');

    // different target language -> real translation call
    const provAnalyzeHi = await json(
      await fetch(`http://127.0.0.1:${providerPort}/api/video/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ videoId: provUpload.video.videoId, targetLanguage: 'hi' }),
      }),
    );
    const provJobHi = await pollJob(providerPort, provAnalyzeHi.jobId, 60000);
    const provResultsHi = await json(await fetch(`http://127.0.0.1:${providerPort}/api/jobs/${provAnalyzeHi.jobId}/results`));
    ok(provJobHi?.status === 'completed', 'translation job completed');
    ok(provResultsHi.translation?.alreadyTranslated === false, 'translation executed for Hindi target');
    ok(
      typeof provResultsHi.translation?.summary === 'string' && provResultsHi.translation.summary.includes('ಅನುವಾದಿತ'),
      'translated summary returned by provider',
      String(provResultsHi.translation?.summary).slice(0, 80),
    );

    // ------------------------------------------------------------ gemini path
    section('gemini provider (against local fake Gemini API)');
    fakeGemini = await startFakeGeminiServer();
    const geminiFakePort = fakeGemini.address().port;
    const geminiPort = 4126;
    const geminiServer = startServer(geminiPort, {
      AI_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'test-gemini-key',
      AI_API_KEY: '',
      AI_BASE_URL: `http://127.0.0.1:${geminiFakePort}/v1beta`,
      AI_MODEL: 'fake-gemini-chat',
      AI_TRANSCRIPTION_MODEL: 'fake-gemini-stt',
      RATE_LIMIT_MAX: '500',
    });
    children.push(geminiServer);
    const geminiHealth = await waitForHealth(geminiPort);
    ok(geminiHealth.aiProvider === 'gemini', 'health reports gemini provider', JSON.stringify(geminiHealth));
    ok(geminiHealth.aiConfigured === true, 'gemini configured via GEMINI_API_KEY');

    const gemForm = new FormData();
    gemForm.append('video', new Blob([bytes], { type: 'video/mp4' }), 'sample-speech.mp4');
    const gemUpload = await json(await fetch(`http://127.0.0.1:${geminiPort}/api/video/upload`, { method: 'POST', body: gemForm }));
    ok(Boolean(gemUpload.video?.videoId), 'gemini: video uploaded');

    const gemAnalyze = await json(
      await fetch(`http://127.0.0.1:${geminiPort}/api/video/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ videoId: gemUpload.video.videoId, targetLanguage: 'hi' }),
      }),
    );
    const gemJob = await pollJob(geminiPort, gemAnalyze.jobId, 60000);
    ok(gemJob?.status === 'completed', 'gemini pipeline completed', JSON.stringify(gemJob).slice(0, 300));
    const gemResults = await json(await fetch(`http://127.0.0.1:${geminiPort}/api/jobs/${gemAnalyze.jobId}/results`));
    ok(gemResults.detectedLanguage?.name === 'English' && gemResults.detectedLanguage?.code === 'en', 'gemini: language from generateContent', JSON.stringify(gemResults.detectedLanguage));
    ok(typeof gemResults.summary?.summary === 'string' && gemResults.summary.summary.includes('GEMINI-SUMMARY'), 'gemini: summary from generateContent');
    ok(Array.isArray(gemResults.summary?.keyPoints) && gemResults.summary.keyPoints.length >= 3, 'gemini: key points parsed');
    ok(typeof gemResults.translation?.summary === 'string' && gemResults.translation.summary.includes('GEMINI-TRANSLATED'), 'gemini: translation executed for Hindi target');
    ok(typeof gemResults.transcript === 'string' && gemResults.transcript.includes('fake Gemini API'), 'gemini: transcript returned');
    ok(fakeGemini.lastInlineMime === 'audio/wav', 'gemini: audio sent inline as wav', String(fakeGemini.lastInlineMime));
    ok((fakeGemini.lastInlineBytes ?? 0) > 10000, `gemini: inline audio payload present (${fakeGemini.lastInlineBytes} bytes)`);
    ok(fakeGemini.lastUrls.some((u) => u.includes('fake-gemini-stt')), 'gemini: transcription model used', JSON.stringify(fakeGemini.lastUrls));
    ok(fakeGemini.lastUrls.some((u) => u.includes('fake-gemini-chat')), 'gemini: chat model used', JSON.stringify(fakeGemini.lastUrls));
    ok(fakeGemini.lastJsonMode === 'application/json', 'gemini: JSON response mode requested', String(fakeGemini.lastJsonMode));
    ok(fakeGemini.lastHadSystem === true, 'gemini: system instruction included');

    // invalid Gemini key -> friendly error, not raw JSON
    const badKeyPort = 4127;
    const badKeyServer = startServer(badKeyPort, {
      AI_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'wrong-gemini-key',
      AI_API_KEY: '',
      AI_BASE_URL: `http://127.0.0.1:${geminiFakePort}/v1beta`,
      AI_MODEL: 'fake-gemini-chat',
      AI_TRANSCRIPTION_MODEL: 'fake-gemini-stt',
      RATE_LIMIT_MAX: '500',
    });
    children.push(badKeyServer);
    await waitForHealth(badKeyPort);
    const badKeyForm = new FormData();
    badKeyForm.append('video', new Blob([bytes], { type: 'video/mp4' }), 'sample-speech.mp4');
    const badKeyUpload = await json(await fetch(`http://127.0.0.1:${badKeyPort}/api/video/upload`, { method: 'POST', body: badKeyForm }));
    const badKeyAnalyze = await json(
      await fetch(`http://127.0.0.1:${badKeyPort}/api/video/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ videoId: badKeyUpload.video.videoId, targetLanguage: 'hi' }),
      }),
    );
    const badKeyJob = await pollJob(badKeyPort, badKeyAnalyze.jobId, 60000);
    ok(badKeyJob?.status === 'failed', 'gemini: invalid key fails the job', JSON.stringify(badKeyJob).slice(0, 300));
    const badKeyMsg = String(badKeyJob?.error ?? '');
    ok(badKeyMsg.includes('GEMINI_API_KEY'), 'gemini: invalid key -> friendly message names GEMINI_API_KEY', badKeyMsg.slice(0, 160));
    ok(!/API_KEY_INVALID|INVALID_ARGUMENT|@type/.test(badKeyMsg), 'gemini: invalid key -> no raw JSON leaked', badKeyMsg.slice(0, 160));

    // ------------------------------------------------------------ production
    section('static frontend hosting');
    const home = await fetch(`http://127.0.0.1:${mainPort}/`);
    const html = await home.text();
    ok(home.status === 200 && html.includes('AI Video Summarizer'), 'GET / serves built frontend');

    // ------------------------------------------------ missing AI key + limits
    section('missing AI key + rate limiting (aux server)');
    await waitForHealth(auxPort);
    const auxHealth = await json(await fetch(`http://127.0.0.1:${auxPort}/api/health`));
    ok(auxHealth.aiConfigured === false, 'aux server reports AI not configured');

    const auxForm = new FormData();
    auxForm.append('video', new Blob([bytes], { type: 'video/mp4' }), 'sample.mp4');
    const auxUpload = await json(await fetch(`http://127.0.0.1:${auxPort}/api/video/upload`, { method: 'POST', body: auxForm }));
    const auxAnalyze = await fetch(`http://127.0.0.1:${auxPort}/api/video/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ videoId: auxUpload.video.videoId, targetLanguage: 'en' }),
    });
    const auxAnalyzeBody = await json(auxAnalyze);
    ok(auxAnalyze.status === 503 && auxAnalyzeBody.error?.code === 'AI_NOT_CONFIGURED', 'analyze without API key -> friendly 503', JSON.stringify(auxAnalyzeBody));

    let saw429 = false;
    for (let i = 0; i < 30; i++) {
      const res = await fetch(`http://127.0.0.1:${auxPort}/api/health`);
      if (res.status === 429) {
        saw429 = true;
        break;
      }
    }
    ok(saw429, 'rate limiter returns 429 after limit');

    console.log(`\n${checks - failures}/${checks} checks passed`);
    if (failures > 0) {
      console.error(`${failures} FAILED`);
      process.exitCode = 1;
    } else {
      console.log('E2E OK');
    }
  } catch (err) {
    console.error('\nE2E aborted:', err);
    process.exitCode = 1;
  } finally {
    for (const child of children) {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }
    if (fakeAi) {
      try {
        fakeAi.close();
      } catch {
        /* ignore */
      }
    }
    if (fakeGemini) {
      try {
        fakeGemini.close();
      } catch {
        /* ignore */
      }
    }
    await sleep(300);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Minimal OpenAI-compatible API double. Exercises the real
 * OpenAICompatibleProvider code path (multipart transcription, chat completions,
 * JSON parsing) without needing an external API key.
 */
function startFakeAiServer() {
  const kannadaTranscript =
    'ಈ ವಿಡಿಯೋ ಎಲೆಕ್ಟ್ರಿಕ್ ವಾಹನಗಳು ಹೇಗೆ ಕೆಲಸ ಮಾಡುತ್ತವೆ ಎಂಬುದನ್ನು ವಿವರಿಸುತ್ತದೆ. ' +
    'ಅವು ಬ್ಯಾಟರಿ ಚಾಲಿತ ಮೋಟರ್ ಅನ್ನು ಬಳಸುತ್ತವೆ ಮತ್ತು ನೇರ ಸೊನೆ ಉಗಿಸುವಿಕೆ ಇಲ್ಲ. ' +
    'ಚಾರ್ಜಿಂಗ್ ಮೂಲಸೌಕರ್ಯವು ಸ್ವೀಕಾರಕ್ಕೆ ಪ್ರಮುಖ ಅಂಶವಾಗಿದೆ.';

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const url = req.url ?? '';
      if (url.includes('/audio/transcriptions') && req.method === 'POST') {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            text: kannadaTranscript,
            language: 'kn',
            duration: 14.2,
            segments: [
              { id: 0, start: 0.0, end: 5.1, text: ' ಈ ವಿಡಿಯೋ ಎಲೆಕ್ಟ್ರಿಕ್ ವಾಹನಗಳು ಹೇಗೆ ಕೆಲಸ ಮಾಡುತ್ತವೆ ಎಂಬುದನ್ನು ವಿವರಿಸುತ್ತದೆ. ' },
              { id: 1, start: 5.1, end: 10.4, text: ' ಅವು ಬ್ಯಾಟರಿ ಚಾಲಿತ ಮೋಟರ್ ಅನ್ನು ಬಳಸುತ್ತವೆ ಮತ್ತು ನೇರ ಸೊನೆ ಉಗಿಸುವಿಕೆ ಇಲ್ಲ. ' },
              { id: 2, start: 10.4, end: 14.2, text: ' ಚಾರ್ಜಿಂಗ್ ಮೂಲಸೌಕರ್ಯವು ಸ್ವೀಕಾರಕ್ಕೆ ಪ್ರಮುಖ ಅಂಶವಾಗಿದೆ.' },
            ],
          }),
        );
        return;
      }
      if (url.includes('/chat/completions') && req.method === 'POST') {
        let prompt = '';
        try {
          const parsed = JSON.parse(body);
          prompt = (parsed.messages ?? []).map((m) => String(m.content ?? '')).join('\n');
        } catch {
          prompt = '';
        }
        const translating = /Translate the video summary/i.test(prompt);
        const payload = translating
          ? {
              summary: 'ಅನುವಾದಿತ ಸಾರಾಂಶ: ಎಲೆಕ್ಟ್ರಿಕ್ ವಾಹನಗಳು ಬ್ಯಾಟರಿ ಮೋಟರ್ ಬಳಸುತ್ತವೆ.',
              keyPoints: ['ಬ್ಯಾಟರಿ ಮೋಟರ್', 'ಸೊನೆ ಇಲ್ಲ', 'ಚಾರ್ಜಿಂಗ್ ಮೂಲಸೌಕರ್ಯ'],
            }
          : {
              summary: 'ಪರೀಕ್ಷಾ ಸಾರಾಂಶ: ವಿದ್ಯುತ್ ವಾಹನಗಳ ಕೆಲಸವಿಧಾನ ಮತ್ತು ಪ್ರಯೋಜನಗಳು.',
              keyPoints: ['ಬ್ಯಾಟರಿ ಮೋಟರ್', 'ಸೊನೆ ಇಲ್ಲ', 'ಚಾರ್ಜಿಂಗ್ ಮೂಲಸೌಕರ್ಯ'],
            };
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(payload) } }] }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not found' }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/**
 * Minimal Gemini (Generative Language API) double. Exercises the real
 * GeminiProvider code path (x-goog-api-key auth, inline-audio transcription,
 * generateContent chat, JSON parsing) without needing a real API key.
 */
function startFakeGeminiServer() {
  const transcript = 'Welcome to the fake Gemini API. This transcript was produced by the fake Gemini API for testing.';

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const url = req.url ?? '';
      if (!server.lastUrls) server.lastUrls = [];
      if (url.includes(':generateContent') && req.method === 'POST') server.lastUrls.push(url);
      if (!url.includes(':generateContent') || req.method !== 'POST') {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: { message: 'not found' } }));
        return;
      }
      if (req.headers['x-goog-api-key'] !== 'test-gemini-key') {
        // Real Google behaviour: HTTP 400 + reason API_KEY_INVALID.
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            error: {
              code: 400,
              message: 'API key not valid. Please pass a valid API key.',
              status: 'INVALID_ARGUMENT',
              details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID', domain: 'googleapis.com' }],
            },
          }),
        );
        return;
      }

      let prompt = '';
      try {
        const parsed = JSON.parse(body);
        const parts = (parsed.contents ?? []).flatMap((c) => c.parts ?? []);
        prompt = parts.map((p) => String(p.text ?? '')).join('\n');
        const inline = parts.find((p) => p.inline_data);
        if (inline) server.lastInlineMime = inline.inline_data?.mime_type;
        if (typeof inline?.inline_data?.data === 'string') server.lastInlineBytes = Math.floor((inline.inline_data.data.length * 3) / 4);
        if (parsed.systemInstruction?.parts?.[0]?.text) server.lastHadSystem = true;
        if (parsed.generationConfig?.responseMimeType) server.lastJsonMode = parsed.generationConfig.responseMimeType;
      } catch {
        prompt = '';
      }

      let payload;
      if (/speech-to-text engine/i.test(prompt)) {
        payload = {
          text: transcript,
          language: 'en',
          duration: 12.4,
          segments: [
            { start: 0, end: 6.0, text: 'Welcome to the fake Gemini API.' },
            { start: 6.0, end: 12.4, text: 'This transcript was produced by the fake Gemini API for testing.' },
          ],
        };
      } else if (/Translate the video summary/i.test(prompt)) {
        payload = {
          summary: 'GEMINI-TRANSLATED summary for the Hindi target language.',
          keyPoints: ['GEMINI-TRANSLATED point 1', 'GEMINI-TRANSLATED point 2', 'GEMINI-TRANSLATED point 3'],
        };
      } else {
        payload = {
          summary: 'GEMINI-SUMMARY: the video explains how the fake Gemini API integration works end to end.',
          keyPoints: ['GEMINI-SUMMARY point 1', 'GEMINI-SUMMARY point 2', 'GEMINI-SUMMARY point 3'],
        };
      }

      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(payload) }] }, finishReason: 'STOP' }],
        }),
      );
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

main();
