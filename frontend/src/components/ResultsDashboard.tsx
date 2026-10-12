import { useState, type ReactNode } from 'react';
import {
  Award,
  AudioLines,
  ClipboardCheck,
  Copy,
  Download,
  FileDown,
  FileText,
  Info,
  Languages,
  ListChecks,
  Loader2,
  RotateCcw,
  ScrollText,
  Sparkles,
} from 'lucide-react';
import type { Results } from '../types';
import TranscriptSection from './TranscriptSection';
import {
  buildResultsText,
  buildSummaryText,
  buildTranslationText,
  copyText,
  downloadBlob,
  downloadResultsPdf,
  summaryFilename,
} from '../lib/downloads';
import { logger } from '../lib/logger';

const log = logger.child('results');

interface Props {
  results: Results;
  onReset: () => void;
}

type CopyTarget = 'summary' | 'translation' | 'transcript' | null;

export default function ResultsDashboard({ results, onReset }: Props) {
  const [copied, setCopied] = useState<CopyTarget>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const doCopy = async (target: CopyTarget, text: string) => {
    const ok = await copyText(text);
    if (ok) {
      setCopied(target);
      setTimeout(() => setCopied(null), 2000);
    } else {
      setActionError('Could not access the clipboard. Please select the text and copy manually.');
    }
  };

  const savePdf = async () => {
    setPdfBusy(true);
    setActionError(null);
    try {
      await downloadResultsPdf(results, summaryFilename(results, 'pdf'));
    } catch (err) {
      log.warn('PDF export failed', { err });
      setActionError('PDF generation failed in this browser. You can still use "Download Results (TXT)" instead.');
    } finally {
      setPdfBusy(false);
    }
  };

  const confidence =
    typeof results.detectedLanguage.confidence === 'number'
      ? Math.round(results.detectedLanguage.confidence * 100)
      : null;

  const btn =
    'inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60';
  const btnSoft =
    `${btn} border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:text-indigo-600 hover:shadow-sm ` +
    'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-indigo-500 dark:hover:text-indigo-300';

  return (
    <section aria-labelledby="results-heading" className="animate-fade-up space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300">
            <ClipboardCheck className="h-5 w-5" />
          </span>
          <div>
            <h2 id="results-heading" className="text-xl font-bold text-slate-800 dark:text-slate-100">
              Results
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Processing completed in {(results.processingTimeMs / 1000).toFixed(1)}s</p>
          </div>
        </div>
        <button type="button" onClick={onReset} className={btnSoft}>
          <RotateCcw className="h-4 w-4" />
          Analyze another video
        </button>
      </div>

      {/* ------------------------------------------------ video information */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <InfoCard label="Video" value={results.video.name} icon={<FileText className="h-4 w-4" />} />
        <InfoCard label="Duration" value={results.video.durationLabel} icon={<ScrollText className="h-4 w-4" />} />
        <InfoCard
          label="Detected Language"
          value={results.detectedLanguage.name}
          sub={confidence !== null ? `Confidence: ${confidence}%` : undefined}
          icon={<Languages className="h-4 w-4" />}
          highlight
        />
        <InfoCard label="Status" value="Completed" icon={<Award className="h-4 w-4" />} />
      </div>

      {results.notices.length > 0 && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs leading-relaxed text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200">
          {results.notices.map((notice, index) => (
            <p key={index} className="flex gap-2">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{notice}</span>
            </p>
          ))}
        </div>
      )}

      {/* ------------------------------------------------------- AI summary */}
      <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-indigo-500" aria-hidden />
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">AI Summary</h3>
        </div>
        <p className="text-[15px] leading-relaxed text-slate-700 dark:text-slate-200">{results.summary.summary}</p>
      </article>

      {/* ------------------------------------------------------- key points */}
      <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex items-center gap-2">
          <ListChecks className="h-5 w-5 text-violet-500" aria-hidden />
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Key Points</h3>
        </div>
        <ol className="space-y-2.5">
          {results.summary.keyPoints.map((point, index) => (
            <li key={index} className="flex gap-3 text-[15px] leading-relaxed text-slate-700 dark:text-slate-200">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-600 dark:bg-violet-950 dark:text-violet-300">
                {index + 1}
              </span>
              <span>{point}</span>
            </li>
          ))}
        </ol>
      </article>

      {/* -------------------------------------------------- translated card */}
      <article className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50/80 to-violet-50/60 p-6 shadow-sm dark:border-indigo-900/70 dark:from-indigo-950/50 dark:to-violet-950/40">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Languages className="h-5 w-5 text-indigo-600 dark:text-indigo-300" aria-hidden />
          <h3 className="text-sm font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
            {results.translation.alreadyTranslated
              ? `${results.targetLanguage.name} Summary`
              : `${results.targetLanguage.name} Summary (Translated)`}
          </h3>
          {results.targetLanguage.flag && <span aria-hidden>{results.targetLanguage.flag}</span>}
          {results.translation.alreadyTranslated && (
            <span className="rounded-full bg-white/70 px-2.5 py-0.5 text-[11px] font-medium text-indigo-600 ring-1 ring-indigo-200 dark:bg-slate-900/60 dark:text-indigo-300 dark:ring-indigo-800">
              video already in target language
            </span>
          )}
        </div>
        <p className="text-[15px] leading-relaxed text-slate-800 dark:text-slate-100">{results.translation.summary}</p>
        {results.translation.keyPoints.length > 0 && !results.translation.alreadyTranslated && (
          <ul className="mt-4 space-y-2 border-t border-indigo-100 pt-4 dark:border-indigo-900/60">
            {results.translation.keyPoints.map((point, index) => (
              <li key={index} className="flex gap-2.5 text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                <span aria-hidden className="text-indigo-500">
                  •
                </span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        )}
      </article>

      {/* ---------------------------------------------------- speech audio */}
      {results.audioUrl && (
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center gap-2">
            <AudioLines className="h-5 w-5 text-emerald-500" aria-hidden />
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Speech-only audio
            </h3>
          </div>
          <audio controls src={results.audioUrl} className="w-full">
            Your browser does not support the audio element.
          </audio>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Background music and noise were reduced as much as practically possible - not removed perfectly.
            </p>
            <a href={results.audioUrl} download className={btnSoft}>
              <Download className="h-4 w-4" />
              Download audio
            </a>
          </div>
        </article>
      )}

      {/* -------------------------------------------------------- transcript */}
      <TranscriptSection transcript={results.transcript} />

      {/* --------------------------------------------------- action buttons */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => doCopy('summary', buildSummaryText(results))} className={btnSoft}>
            {copied === 'summary' ? <ClipboardCheck className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
            {copied === 'summary' ? 'Copied!' : 'Copy Summary'}
          </button>

          <button type="button" onClick={() => doCopy('translation', buildTranslationText(results))} className={btnSoft}>
            {copied === 'translation' ? <ClipboardCheck className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
            {copied === 'translation' ? 'Copied!' : 'Copy Translation'}
          </button>

          <button
            type="button"
            onClick={() => downloadBlob(buildSummaryText(results), summaryFilename(results, 'txt'), 'text/plain')}
            className={btnSoft}
          >
            <Download className="h-4 w-4" />
            Download Summary
          </button>

          <button
            type="button"
            onClick={() => downloadBlob(results.transcript, `video-transcript-${results.targetLanguage.code}.txt`, 'text/plain')}
            className={btnSoft}
          >
            <FileText className="h-4 w-4" />
            Download Transcript
          </button>

          <button
            type="button"
            onClick={() => downloadBlob(buildResultsText(results), `video-results-${results.targetLanguage.code}.txt`, 'text/plain')}
            className={btnSoft}
          >
            <FileDown className="h-4 w-4" />
            Download Results (TXT)
          </button>

          <button
            type="button"
            onClick={savePdf}
            disabled={pdfBusy}
            className={`${btn} border-transparent bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm hover:from-indigo-500 hover:to-violet-500 dark:from-indigo-500 dark:to-violet-500`}
          >
            {pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
            {pdfBusy ? 'Preparing PDF…' : 'Download Results (PDF)'}
          </button>
        </div>

        {actionError && (
          <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
            {actionError}
          </p>
        )}
      </div>
    </section>
  );
}

function InfoCard({
  label,
  value,
  sub,
  icon,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: ReactNode;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 shadow-sm ${
        highlight
          ? 'border-indigo-200 bg-indigo-50/70 dark:border-indigo-900/70 dark:bg-indigo-950/40'
          : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
      }`}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
        <span className={highlight ? 'text-indigo-500' : 'text-slate-400'}>{icon}</span>
        {label}
      </div>
      <p className="mt-1.5 truncate text-sm font-semibold text-slate-700 dark:text-slate-200" title={value}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-indigo-600 dark:text-indigo-300">{sub}</p>}
    </div>
  );
}
