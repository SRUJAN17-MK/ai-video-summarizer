import { AlertTriangle, X } from 'lucide-react';

interface Props {
  message: string;
  onDismiss?: () => void;
}

export default function ErrorBanner({ message, onDismiss }: Props) {
  return (
    <div
      role="alert"
      className="animate-fade-up flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <p className="flex-1 leading-relaxed">{message}</p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss error"
          className="rounded-lg p-1 text-red-400 transition hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-900/50 dark:hover:text-red-200"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
