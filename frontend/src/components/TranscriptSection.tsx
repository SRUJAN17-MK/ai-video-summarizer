import { useState } from 'react';
import { ChevronDown, Copy, FileText } from 'lucide-react';
import { copyText } from '../lib/downloads';

interface Props {
  transcript: string;
}

export default function TranscriptSection({ transcript }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    const ok = await copyText(transcript);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-2 text-sm font-semibold text-slate-700 transition hover:text-indigo-600 dark:text-slate-200 dark:hover:text-indigo-300"
        >
          <FileText className="h-4 w-4 text-slate-400" aria-hidden />
          View Transcript
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        </button>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-300 dark:hover:border-indigo-500 dark:hover:text-indigo-300"
        >
          <Copy className="h-3.5 w-3.5" />
          {copied ? 'Copied!' : 'Copy Transcript'}
        </button>
      </div>

      {open && (
        <div className="border-t border-slate-100 px-5 py-4 dark:border-slate-800">
          <div className="scroll-slim max-h-80 overflow-y-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm leading-relaxed text-slate-700 dark:bg-slate-950/60 dark:text-slate-300">
            {transcript}
          </div>
        </div>
      )}
    </section>
  );
}
