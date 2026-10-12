import { CheckCircle2, CircleDashed, Loader2, XCircle } from 'lucide-react';
import { STAGE_KEYS, STAGE_LABELS, type PublicJob } from '../types';

interface Props {
  job: PublicJob;
}

export default function ProcessingStages({ job }: Props) {
  const states = STAGE_KEYS.map((key) => ({ key, label: STAGE_LABELS[key], state: job.stages[key] ?? 'pending' }));
  const doneCount = states.filter((s) => s.state === 'done').length;
  const percent = Math.round((doneCount / states.length) * 100);
  const failed = job.status === 'failed';

  return (
    <section
      aria-live="polite"
      aria-busy={job.status !== 'failed'}
      className="animate-fade-up rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
          {failed ? 'Processing stopped' : 'Processing your video'}
        </h2>
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
          {doneCount}/{states.length} stages
        </span>
      </div>

      <div className="mb-5 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          className={`h-full rounded-full transition-all duration-500 ${failed ? 'bg-red-500' : 'bg-gradient-to-r from-indigo-500 to-violet-500'}`}
          style={{ width: `${failed ? 100 : Math.max(percent, 4)}%` }}
        />
      </div>

      <ol className="space-y-3">
        {states.map(({ key, label, state }) => (
          <li key={key} className="flex items-center gap-3 text-sm">
            <span className="flex h-6 w-6 items-center justify-center">
              {state === 'done' && <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-label="completed" />}
              {state === 'active' && !failed && (
                <Loader2 className="h-5 w-5 animate-spin text-indigo-500" aria-label="in progress" />
              )}
              {state === 'pending' && <CircleDashed className="h-5 w-5 text-slate-300 dark:text-slate-600" aria-label="pending" />}
              {state === 'error' && <XCircle className="h-5 w-5 text-red-500" aria-label="failed" />}
            </span>
            <span
              className={
                state === 'done'
                  ? 'text-slate-700 dark:text-slate-200'
                  : state === 'active'
                    ? 'font-medium text-indigo-600 dark:text-indigo-300'
                    : 'text-slate-400 dark:text-slate-500'
              }
            >
              {label}
            </span>
          </li>
        ))}
      </ol>

      <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
        Long videos can take a few minutes. Progress is updated stage by stage - no fake percentages.
      </p>
    </section>
  );
}
