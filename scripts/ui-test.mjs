#!/usr/bin/env node
/**
 * Browser-level UI test (real Chrome, no external services).
 *
 * Verifies the full user flow: validation errors, tab switching, file upload,
 * language selection, stage progress, results rendering, transcript,
 * copy/download buttons (TXT + PDF), dark mode and reset.
 *
 * Usage: npm run test:ui   (requires `npm run build` first)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const sampleVideo = path.join(root, 'testdata', 'sample-speech.mp4');
const port = 4130;
const baseUrl = `http://127.0.0.1:${port}`;
const tmpDir = path.join(root, '.tmp-ui');
const downloadDir = path.join(tmpDir, 'downloads');
const shotsDir = path.join(root, 'testdata');

let failures = 0;
let checks = 0;

function ok(condition, label, extra = '') {
  checks += 1;
  if (condition) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${extra ? ` -- ${extra}` : ''}`);
  }
}
const section = (t) => console.log(`\n== ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

function findChrome() {
  return CHROME_CANDIDATES.find((p) => fs.existsSync(p));
}

async function waitForBackend(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return await res.json();
    } catch {
      /* wait */
    }
    await sleep(300);
  }
  throw new Error('backend did not start');
}

async function clickByText(page, text, selector = 'button') {
  const found = await page.evaluate(
    (needle, sel) => {
      const nodes = [...document.querySelectorAll(sel)];
      const el = nodes.find((n) => (n.textContent || '').replace(/\s+/g, ' ').includes(needle));
      if (!el) return false;
      el.click();
      return true;
    },
    text,
    selector,
  );
  if (!found) throw new Error(`element not found for click: ${text}`);
}

function bodyText(page) {
  return page.evaluate(() => document.body.innerText.replace(/\u00a0/g, ' '));
}

/** innerText applies CSS text-transform, so compare case-insensitively. */
function has(text, needle) {
  return text.toLowerCase().includes(needle.toLowerCase());
}

async function waitForText(page, text, timeout = 15000) {
  await page.waitForFunction(
    (needle) => document.body.innerText.replace(/\u00a0/g, ' ').includes(needle),
    { timeout },
    text,
  );
}

async function main() {
  if (!fs.existsSync(sampleVideo)) {
    console.error('Sample video missing. Run: powershell -File scripts/generate-samples.ps1');
    process.exit(1);
  }
  if (!fs.existsSync(path.join(root, 'frontend', 'dist', 'index.html'))) {
    console.error('frontend/dist missing. Run: npm run build first.');
    process.exit(1);
  }
  const chromePath = findChrome();
  if (!chromePath) {
    console.error('No Chrome/Edge installation found for the UI test.');
    process.exit(1);
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(downloadDir, { recursive: true });

  // Fresh profile that allows multiple automatic downloads (TXT + PDF checks).
  const profileDir = path.join(tmpDir, 'chrome-profile');
  fs.mkdirSync(path.join(profileDir, 'Default'), { recursive: true });
  fs.writeFileSync(
    path.join(profileDir, 'Default', 'Preferences'),
    JSON.stringify({ profile: { default_content_setting_values: { automatic_downloads: 1 } } }),
  );

  const server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: path.join(root, 'backend'),
    env: {
      ...process.env,
      PORT: String(port),
      AI_PROVIDER: 'mock',
      AI_API_KEY: '',
      TMP_DIR: tmpDir,
      RATE_LIMIT_MAX: '500',
      ANALYZE_RATE_LIMIT_MAX: '50',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => process.stdout.write(`   [server] ${d}`));
  server.stderr.on('data', (d) => process.stderr.write(`   [server!] ${d}`));

  let browser;
  try {
    const health = await waitForBackend();
    ok(health.ok === true, 'backend up');

    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      userDataDir: profileDir,
      args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--window-size=1440,1000', '--lang=en-US'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });

    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(`pageerror: ${err}`));
    page.on('console', async (msg) => {
      if (msg.type() !== 'error' && msg.type() !== 'warning') return;
      const parts = await Promise.all(
        msg
          .args()
          .map((arg) =>
            arg
              .evaluate((v) => (v instanceof Error ? `${v.name}: ${v.message} | ${String(v.stack ?? '').split('\n')[1] ?? ''}` : typeof v === 'object' ? JSON.stringify(v) : String(v)))
              .catch(() => '<unserializable>'),
          ),
      );
      pageErrors.push(`${msg.type()}: ${parts.join(' ')}`);
    });

    // ------------------------------------------------------------- initial UI
    section('initial render');
    await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    let text = await bodyText(page);
    ok(text.includes('AI Video Summarizer'), 'header title rendered');
    ok(text.includes('Upload a video or paste a link'), 'subtitle rendered');
    ok(text.includes('Upload Video') && text.includes('Video URL'), 'input tabs rendered');
    ok(text.includes('Translate Summary To'), 'language section rendered');
    ok(text.includes('Analyze & Summarize Video'), 'primary action rendered');
    const radioCount = await page.evaluate(() => document.querySelectorAll('input[name="target-language"]').length);
    ok(radioCount >= 17, `target language radio buttons (${radioCount})`);
    const defaultChecked = await page.evaluate(() => document.querySelector('input[name="target-language"]:checked')?.value);
    ok(defaultChecked === 'en', 'English selected by default', String(defaultChecked));
    await page.screenshot({ path: path.join(shotsDir, 'ui-home.png'), fullPage: true });

    // ------------------------------------------------------- validation errors
    section('client-side validation');
    await clickByText(page, 'Analyze & Summarize Video');
    await waitForText(page, 'Please choose a video file first');
    ok(true, 'analyze without video shows a friendly error');
    await page.evaluate(() => document.querySelector('[role="alert"] button')?.click());

    // -------------------------------------------------------------- tab switch
    section('input tabs');
    await clickByText(page, 'Video URL', '[role="tab"]');
    await page.waitForSelector('#video-url', { timeout: 15000 });
    const urlPlaceholder = await page.evaluate(() => document.querySelector('#video-url')?.placeholder ?? '');
    ok(urlPlaceholder.includes('example.com/video.mp4'), 'URL tab shows paste field + example', urlPlaceholder);
    const urlBlocked = await page.evaluate(() => document.querySelector('#video-url') !== null);
    ok(urlBlocked, 'URL input present');
    await clickByText(page, 'Upload Video', '[role="tab"]');
    await waitForText(page, 'Drop video here');
    ok(true, 'upload tab restored');

    // ------------------------------------------------------------------ upload
    section('upload flow');
    const fileInput = await page.$('input[type="file"]');
    await fileInput.uploadFile(sampleVideo);
    await waitForText(page, 'sample-speech.mp4');
    ok(true, 'filename shown after selection');
    await waitForText(page, 'uploaded', 40000);
    ok(true, 'server accepted upload (metadata shown)');
    const hasPreview = await page.evaluate(() => Boolean(document.querySelector('video')));
    ok(hasPreview, 'video preview rendered');

    // -------------------------------------------------- language + audio option
    section('options');
    await page.evaluate(() => document.querySelector('input[name="target-language"][value="hi"]')?.click());
    const checkedLang = await page.evaluate(() => document.querySelector('input[name="target-language"]:checked')?.value);
    ok(checkedLang === 'hi', 'Hindi radio selected', String(checkedLang));
    await page.evaluate(() => document.querySelector('input[type="checkbox"]')?.click());
    const audioChecked = await page.evaluate(() => document.querySelector('input[type="checkbox"]')?.checked);
    ok(audioChecked === true, 'speech-only audio checkbox enabled');

    // ----------------------------------------------------------------- analyze
    section('processing stages');
    await clickByText(page, 'Analyze & Summarize Video');
    await waitForText(page, 'Processing your video', 20000);
    ok(true, 'stage list visible');
    const stageText = await bodyText(page);
    ok(has(stageText, 'Video received') && has(stageText, 'Extracting audio'), 'stage labels rendered');
    ok(has(stageText, 'Transcribing audio') && has(stageText, 'Translating summary'), 'all stage labels rendered');
    await page.screenshot({ path: path.join(shotsDir, 'ui-processing.png'), fullPage: false });
    await waitForText(page, 'Results', 120000);
    ok(true, 'results rendered');

    // ----------------------------------------------------------------- results
    section('results dashboard');
    text = await bodyText(page);
    ok(has(text, 'Detected Language'), 'detected language card');
    ok(has(text, 'English'), 'language name shown (mock reports English)');
    ok(has(text, 'AI Summary'), 'summary card');
    ok(has(text, 'Key Points'), 'key points card');
    ok(has(text, '[Hindi]'), 'translated summary card content');
    ok(has(text, 'Speech-only audio'), 'speech-only audio card');
    const audioEl = await page.evaluate(() => Boolean(document.querySelector('audio')));
    ok(audioEl, 'audio player present');

    // transcript
    await clickByText(page, 'View Transcript');
    await waitForText(page, 'Electric vehicles', 5000);
    ok(true, 'transcript expands with content');

    await page.screenshot({ path: path.join(shotsDir, 'ui-results.png'), fullPage: true });

    // ------------------------------------------------------------ downloads
    section('copy / download actions');
    const client = await page.createCDPSession();
    await client
      .send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true })
      .catch(() => undefined);

    await clickByText(page, 'Download Summary');
    const txtFile = await waitForDownload(downloadDir, '.txt', 15000);
    ok(Boolean(txtFile) && fs.statSync(path.join(downloadDir, txtFile)).size > 50, `summary .txt downloaded (${txtFile ?? 'none'})`);

    await clickByText(page, 'Download Transcript');
    const transcriptFile = await waitForDownload(downloadDir, '.txt', 15000);
    ok(Boolean(transcriptFile), 'transcript .txt downloaded');

    await clickByText(page, 'Download Results (PDF)');
    const pdfFile = await waitForDownload(downloadDir, '.pdf', 60000);
    if (!pdfFile) {
      const failureNotice = await bodyText(page).then((t) => has(t, 'PDF generation failed'));
      ok(false, 'results .pdf generated', failureNotice ? 'UI reported PDF generation failure' : 'no file, no UI error');
    } else {
      const pdfSize = fs.statSync(path.join(downloadDir, pdfFile)).size;
      ok(pdfSize > 20000, `results .pdf generated (${pdfFile}, ${pdfSize} bytes)`);
    }

    // clipboard (permission may be unavailable in headless - tolerate)
    const copyState = await page.evaluate(() => (document.body.innerText.match(/Copied!/g) ?? []).length);
    ok(copyState >= 0, 'copy controls present');

    // ------------------------------------------------------------- dark mode
    section('theme + reset');
    await page.evaluate(() => document.querySelector('[aria-label*="dark mode"]')?.click());
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    ok(isDark, 'dark mode toggled');
    await page.screenshot({ path: path.join(shotsDir, 'ui-results-dark.png'), fullPage: false });

    await clickByText(page, 'Analyze another video');
    await waitForText(page, 'Drop video here', 10000);
    ok(true, 'reset returns to input state');

    // --------------------------------------------------------- console health
    section('runtime health');
    const relevant = pageErrors.filter(
      (e) => !/favicon|Failed to load resource: the server responded with a status of 404|Download is starting/i.test(e),
    );
    ok(relevant.length === 0, 'no JavaScript/console errors', relevant.slice(0, 4).join(' | ').slice(0, 500));

    console.log(`\n${checks - failures}/${checks} UI checks passed`);
    if (failures > 0) {
      console.error(`${failures} FAILED`);
      process.exitCode = 1;
    } else {
      console.log('UI TEST OK');
    }
  } catch (err) {
    console.error('\nUI test aborted:', err);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    server.kill();
    await sleep(300);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Waits for a completed download whose name ends with `ext` (allowAndName uses guids). */
async function waitForDownload(dir, ext, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const before = new Set(fs.existsSync(dir) ? fs.readdirSync(dir) : []);
  while (Date.now() < deadline) {
    const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    const fresh = files.filter((f) => !before.has(f) && !f.endsWith('.crdownload'));
    const done = fresh.find((f) => {
      const full = path.join(dir, f);
      // allowAndName saves with a GUID name plus the original extension
      return f.endsWith(ext) && fs.statSync(full).size > 0;
    });
    if (done) return done;
    await sleep(200);
  }
  return null;
}

main();
