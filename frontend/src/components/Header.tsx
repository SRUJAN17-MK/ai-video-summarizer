import { Clapperboard, Moon, Sun } from 'lucide-react';

interface Props {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export default function Header({ theme, onToggleTheme }: Props) {
  return (
    <header className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-70 dark:opacity-50"
        style={{
          background:
            'radial-gradient(60rem 24rem at 50% -12rem, rgba(99,102,241,0.35), transparent 65%), radial-gradient(40rem 18rem at 85% 0%, rgba(168,85,247,0.25), transparent 60%)',
        }}
      />
      <div className="mx-auto flex max-w-5xl items-start justify-between gap-4 px-4 pt-8 pb-6 sm:pt-12">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/30">
            <Clapperboard className="h-7 w-7" aria-hidden />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              <span className="bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-500 bg-clip-text text-transparent dark:from-indigo-300 dark:via-violet-300 dark:to-fuchsia-300">
                AI Video Summarizer
              </span>
            </h1>
            <p className="mt-1 max-w-xl text-sm text-slate-600 sm:text-base dark:text-slate-400">
              Upload a video or paste a link. Get an AI-powered summary in your language.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white/80 text-slate-600 transition hover:bg-white hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300 dark:hover:text-indigo-300"
        >
          {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>
      </div>
    </header>
  );
}
