# AI Video Summarizer & Translator

Upload a video or paste a link, and get a transcript, an AI-generated summary with key points, and a translation into your language — plus optional speech audio download.

Built with **React + TypeScript + Vite + Tailwind (frontend)** and **Node + Express + TypeScript (backend)**, driven by an **FFmpeg** media pipeline and a pluggable **AI provider** layer (any OpenAI-compatible API).

---

## Features

- **Upload or link**: drag-and-drop / file picker upload, or a direct video URL (SSRF-guarded download with size and time limits).
- **AI pipeline** (7 stages): probe → extract audio → clean audio → transcribe → summarize → translate → package results.
- **Results dashboard**: video info, summary, bullet key points, translated summary, collapsible transcript, audio player.
- **Downloads**: copy-to-clipboard, TXT export, and a styled multi-page **PDF**.
- **22 target languages** (English, Hindi, Spanish, French, German, Portuguese, Japanese, Korean, Arabic, and more).
- **Security**: Helmet + strict CSP, CORS allowlist, rate limiting, extension/MIME validation, server-side-only API key, SSRF protection, temp-file TTL cleanup.
- **Dark/light mode**, fully responsive.

---

## Requirements

- Node.js ≥ 18 (tested on Node 24)
- No system FFmpeg needed — ffmpeg/ffprobe binaries are installed via npm (`@ffmpeg-installer/ffmpeg`, `@ffprobe-installer/ffprobe`)
- An AI API key (OpenAI, Groq, OpenRouter, or any OpenAI-compatible endpoint) — *or* run in mock mode for testing

## Quick start

```bash
cd ai-video-summarizer
npm install
cp .env.example .env      # then fill in AI_API_KEY (see below)
npm run dev               # backend on :4000, frontend on :5173
```

Open http://localhost:5173.

Production build:

```bash
npm run build             # typechecks + builds backend and frontend
npm start                 # serves API + built frontend on :4000
```

## Configuring the AI provider

All configuration lives in `.env` (repo root; `backend/.env` also works). See [`.env.example`](.env.example) for every option.

**Gemini (simplest):**

```bash
AI_PROVIDER=gemini
GEMINI_API_KEY=your_key_here
```

Leave `AI_PROVIDER` blank and it is auto-selected when only `GEMINI_API_KEY` is set. Gemini has no `/audio/transcriptions` endpoint, so the backend uses a dedicated Gemini provider: audio is sent inline to `generateContent` for transcription (with language detection), and the same endpoint handles summarization/translation with JSON output.

**OpenAI-compatible:**

```bash
AI_PROVIDER=openai
AI_API_KEY=sk-...
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
AI_TRANSCRIPTION_MODEL=whisper-1
```

| Provider | `AI_BASE_URL` | `AI_MODEL` example | `AI_TRANSCRIPTION_MODEL` |
|---|---|---|---|
| **Gemini** | (default `…/v1beta`, leave unset) | `gemini-2.5-flash` | `gemini-2.5-flash` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | `whisper-1` |
| Groq (free tier) | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | `whisper-large-v3` |
| OpenRouter | `https://openrouter.ai/api/v1` | `openai/gpt-4o-mini` | (needs an STT-capable model) |
| Local (LM Studio, llama.cpp) | `http://localhost:1234/v1` | your local model | (transcription must be supported) |

The key is only ever read server-side; it is never sent to the browser. If no usable key is configured (`AI_API_KEY` / `GEMINI_API_KEY`), `/api/video/analyze` returns a clear 503 error.

**Mock mode (testing only):** `AI_PROVIDER=mock` returns canned pipeline data with no network AI calls. Used by the automated tests below.

## Testing

```bash
npm run test:e2e    # API/pipeline checks (mock provider + fake OpenAI + fake Gemini APIs)
npm run test:ui     # 36 headless-Chrome UI checks, writes screenshots to testdata/
npm run typecheck   # tsc for both apps
```

Test fixtures are checked in (`testdata/sample-speech.mp4`, `sample-silent.mp4`, `sample-silence.mp4`). Regenerate them with:

```powershell
powershell -File scripts/generate-samples.ps1
```

## API

Base URL: `http://localhost:4000/api`

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/video/upload` | Multipart upload (`video` field) → `{ jobId }` |
| `POST` | `/video/url` | `{ url }` direct video link → `{ jobId }` |
| `POST` | `/video/analyze` | `{ jobId, targetLanguage, includeAudio }` → starts the pipeline |
| `GET` | `/jobs/:jobId` | Stage/status polling → `{ status, stage, progress, error? }` |
| `GET` | `/jobs/:jobId/results` | Summary, key points, transcript, translation, info |
| `GET` | `/jobs/:jobId/audio` | Download cleaned speech MP3 |
| `GET` | `/video/formats` | Allowed extensions + max upload size |

Errors use `{ error: { code, message } }`.

## Architecture

```
frontend/  React + Vite SPA (TypeScript, Tailwind v4)
backend/
  src/
    app.ts               Express app: Helmet CSP, CORS, rate limits, static SPA
    config.ts            env loading + typed config
    routes/              video + job routes
    controllers/         request validation, job creation, results
    workers/pipeline.ts  7-stage async job pipeline
    services/
      videoService.ts    ffprobe metadata, validation
      audioService.ts    extract/clean/encode audio (+ optional Demucs)
      transcription.ts   speech-to-text + language detection
      summarization.ts   summary / key points / transcript formatting
      translation.ts     target-language translation
      ai/                provider abstraction (openaiCompatible, mock)
    utils/               ffmpeg wrapper, SSRF guard, files, errors
scripts/                 e2e.mjs, ui-test.mjs, generate-samples.ps1
testdata/                sample videos + UI screenshots
```

**Pipeline stages:** `probing` → `extracting-audio` → `cleaning-audio` → `transcribing` → `summarizing` → `translating` → `packaging` → `completed`.

## Security notes

- API key stays server-side; CSP, CORS allowlist, and rate limiting are on by default.
- URL ingestion blocks private/loopback/link-local addresses and re-validates every redirect (SSRF protection); downloads are size- and time-capped.
- Uploads are validated by extension **and** MIME type, stored under generated UUID names, and deleted on a TTL sweeper (default 30 min).
- `.env` is gitignored — never commit real keys.

## Limitations

- **Speech vs. music diagnosis**: audio with no recognizable speech fails with an explicit "no speech detected" error rather than a fake summary. Pure-music videos are rejected for the same reason.
- **Speech/music separation**: when Demucs is *not* installed (default), an ffmpeg fallback is used — band filtering + FFT noise reduction + loudness normalisation. This helps with noisy speech but is not true source separation. Set `DEMUCS_ENABLED=true` with `demucs` + Python installed for two-stem vocal separation.
- Long videos mean long transcription times; the job polls and shows per-stage progress.
- Translation quality depends on the configured chat model.

## Legal

Only process videos you have the right to use. Downloading third-party videos may violate copyright and the terms of service of the source site; this tool does not bypass DRM, paywalls, or access controls, and you are responsible for compliance with applicable laws and platform terms.
