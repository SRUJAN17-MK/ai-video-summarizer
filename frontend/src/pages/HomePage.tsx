import { useEffect, useRef, useState } from 'react';
import { AudioLines, Loader2, Sparkles, Wand2 } from 'lucide-react';
import Header from '../components/Header';
import InputTabs from '../components/InputTabs';
import LanguageSelector from '../components/LanguageSelector';
import ProcessingStages from '../components/ProcessingStages';
import ResultsDashboard from '../components/ResultsDashboard';
import ErrorBanner from '../components/ErrorBanner';
import { useTheme } from '../hooks/useTheme';
import { analyzeVideo, ApiError, fetchJob, fetchResults, health, submitVideoUrl, uploadVideo } from '../services/api';
import { languageByCode } from '../types/languages';
import type { PublicJob, Results, VideoInfo } from '../types';

function messageOf(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return "We couldn't process this video. Please try again or use another video.";
}

export default function HomePage() {
  const { theme, toggle } = useTheme();

  const [mode, setMode] = useState<'upload' | 'url'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);

  const [urlValue, setUrlValue] = useState('');
  const [urlBusy, setUrlBusy] = useState(false);

  const [targetLanguage, setTargetLanguage] = useState('en');
  const [generateAudio, setGenerateAudio] = useState(false);

  const [analyzing, setAnalyzing] = useState(false);
  const [job, setJob] = useState<PublicJob | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [configWarning, setConfigWarning] = useState<string | null>(null);
  const [maxUploadMb, setMaxUploadMb] = useState(200);

  const processingRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // ---------------------------------------------------------------- health --
  useEffect(() => {
    health()
      .then((h) => {
        setMaxUploadMb(h.maxUploadMb || 200);
        if (!h.aiConfigured) {
          setConfigWarning(
            'The AI service is not configured on this server yet. Add AI_API_KEY to backend/.env (see .env.example) before analyzing videos.',
          );
        }
      })
      .catch(() => undefined);
  }, []);

  // ---------------------------------------------------------------- upload --
  const handleFileSelected = async (nextFile: File) => {
    setError(null);
    setResults(null);
    setJob(null);
    setConfigWarning((w) => w);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(nextFile);
    setPreviewUrl(URL.createObjectURL(nextFile));
    setVideo(null);
    setUploadPercent(0);
    try {
      const res = await uploadVideo(nextFile, setUploadPercent);
      setVideo(res.video);
      setUploadPercent(100);
    } catch (err) {
      setError(messageOf(err));
      setFile(null);
      setUploadPercent(null);
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
      }
    }
  };

  const handleClearFile = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
    setVideo(null);
    setUploadPercent(null);
    setError(null);
  };

  // ------------------------------------------------------------------- url --
  const handleUrlSubmit = async () => {
    const value = urlValue.trim();
    if (value.length < 8) {
      setError('Please enter a valid publicly accessible video URL.');
      return;
    }
    setUrlBusy(true);
    setError(null);
    setResults(null);
    setJob(null);
    try {
      const res = await submitVideoUrl(value);
      setVideo(res.video);
    } catch (err) {
      setError(messageOf(err));
      setVideo(null);
    } finally {
      setUrlBusy(false);
    }
  };

  // --------------------------------------------------------------- analyze --
  const handleAnalyze = async () => {
    if (!video) {
      setError(
        mode === 'upload'
          ? 'Please choose a video file first.'
          : 'Please paste a video URL and click "Load video" first.',
      );
      return;
    }
    if (!targetLanguage) {
      setError('Please choose a target language for the translation.');
      return;
    }
    if (!languageByCode(targetLanguage)) {
      setError('Please choose a valid target language.');
      return;
    }

    setAnalyzing(true);
    setError(null);
    setResults(null);
    try {
      const started = await analyzeVideo({ videoId: video.videoId, targetLanguage, generateAudio });
      setJob(started);
      setTimeout(() => processingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    } catch (err) {
      setError(messageOf(err));
      setJob(null);
    } finally {
      setAnalyzing(false);
    }
  };

  // ----------------------------------------------------------- job polling --
  const jobId = job?.jobId;
  const jobStatus = job?.status;
  useEffect(() => {
    if (!jobId || !jobStatus || jobStatus === 'completed' || jobStatus === 'failed') return;

    let failures = 0;
    const timer = window.setInterval(async () => {
      try {
        const updated = await fetchJob(jobId);
        failures = 0;
        setJob(updated);
        if (updated.status === 'completed') {
          const res = await fetchResults(jobId);
          setResults(res);
          setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
        } else if (updated.status === 'failed') {
          setError(updated.error ?? "We couldn't process this video. Please try again or use another video.");
        }
      } catch (err) {
        failures += 1;
        if (failures >= 4) {
          window.clearInterval(timer);
          setError(messageOf(err));
        }
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [jobId, jobStatus]);

  const handleReset = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
    setVideo(null);
    setUploadPercent(null);
    setUrlValue('');
    setJob(null);
    setResults(null);
    setError(null);
    setGenerateAudio(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const busy = analyzing || urlBusy || Boolean(job && job.status !== 'completed' && job.status !== 'failed' && !results);
  const selectedLanguage = languageByCode(targetLanguage);

  return (
    <div className="min-h-screen">
      <Header theme={theme} onToggleTheme={toggle} />

      <main className="mx-auto max-w-5xl space-y-4 px-4 pb-20">
        {configWarning && (
          <div className="animate-fade-up rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200">
            {configWarning}
          </div>
        )}

        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        {!results && (
          <div className="space-y-4">
            <InputTabs
              mode={mode}
              onModeChange={(next) => {
                setMode(next);
                setError(null);
              }}
              file={file}
              previewUrl={previewUrl}
              video={video}
              uploadPercent={uploadPercent}
              urlValue={urlValue}
              urlBusy={urlBusy}
              maxUploadMb={maxUploadMb}
              disabled={busy}
              onFileSelected={handleFileSelected}
              onClearFile={handleClearFile}
              onUrlChange={setUrlValue}
              onUrlSubmit={handleUrlSubmit}
            />

            <LanguageSelector value={targetLanguage} onChange={setTargetLanguage} disabled={busy} />

            <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center dark:border-slate-800 dark:bg-slate-900">
              <label className="flex cursor-pointer items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={generateAudio}
                  onChange={(e) => setGenerateAudio(e.target.checked)}
                  disabled={busy}
                  className="h-4 w-4 rounded border-slate-300 accent-indigo-600"
                />
                <span className="flex items-center gap-2">
                  <AudioLines className="h-4 w-4 text-slate-400" aria-hidden />
                  Generate speech-only audio
                </span>
              </label>
              <p className="text-xs text-slate-400 dark:text-slate-500">
                Optional &middot; creates a downloadable audio file with background music/noise reduced.
              </p>
            </div>

            <button
              type="button"
              onClick={handleAnalyze}
              disabled={busy}
              className="group relative flex w-full items-center justify-center gap-3 overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:shadow-xl hover:shadow-indigo-500/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:text-lg dark:ring-offset-slate-950"
            >
              {analyzing ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Wand2 className="h-5 w-5 transition-transform group-hover:rotate-12" />
              )}
              {analyzing ? 'Starting…' : 'Analyze & Summarize Video'}
              {!analyzing && <Sparkles className="h-4 w-4 opacity-80" aria-hidden />}
            </button>
          </div>
        )}

        {job && !results && (
          <div ref={processingRef}>
            <ProcessingStages job={job} />
          </div>
        )}

        {results && (
          <div ref={resultsRef}>
            <ResultsDashboard results={results} onReset={handleReset} />
          </div>
        )}

        <footer className="pt-6 text-center text-xs leading-relaxed text-slate-400 dark:text-slate-600">
          {video && selectedLanguage ? (
            <p>
              Summary will be translated to <strong className="font-semibold text-slate-500 dark:text-slate-400">{selectedLanguage.name}</strong>.
              Uploaded videos are processed temporarily and deleted automatically.
            </p>
          ) : (
            <p>Uploaded videos are processed temporarily and deleted automatically. API keys never reach the browser.</p>
          )}
        </footer>
      </main>
    </div>
  );
}
