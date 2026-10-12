import { useCallback, useRef, useState, type DragEvent } from 'react';
import { Film, Link2, Loader2, UploadCloud, X } from 'lucide-react';
import type { VideoInfo } from '../types';

const ACCEPTED = '.mp4,.webm,.mov,.avi,.mkv';

interface Props {
  mode: 'upload' | 'url';
  onModeChange: (mode: 'upload' | 'url') => void;
  file: File | null;
  previewUrl: string | null;
  video: VideoInfo | null;
  uploadPercent: number | null;
  urlValue: string;
  urlBusy: boolean;
  maxUploadMb: number;
  disabled: boolean;
  onFileSelected: (file: File) => void;
  onClearFile: () => void;
  onUrlChange: (value: string) => void;
  onUrlSubmit: () => void;
}

function humanFileSize(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

export default function InputTabs(props: Props) {
  const {
    mode,
    onModeChange,
    file,
    previewUrl,
    video,
    uploadPercent,
    urlValue,
    urlBusy,
    maxUploadMb,
    disabled,
    onFileSelected,
    onClearFile,
    onUrlChange,
    onUrlSubmit,
  } = props;

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleFile = useCallback(
    (candidate: File | undefined | null) => {
      setLocalError(null);
      if (!candidate) return;
      const ext = `.${candidate.name.split('.').pop()?.toLowerCase() ?? ''}`;
      if (!ACCEPTED.split(',').includes(ext)) {
        setLocalError('This video format is not supported. Please upload MP4, WebM, MOV, AVI, or MKV.');
        return;
      }
      if (candidate.size > maxUploadMb * 1024 * 1024) {
        setLocalError(`This file is larger than the ${maxUploadMb} MB limit. Please choose a smaller video.`);
        return;
      }
      onFileSelected(candidate);
    },
    [maxUploadMb, onFileSelected],
  );

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    handleFile(event.dataTransfer.files?.[0]);
  };

  const showLocalError = mode === 'upload' ? localError : null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/80" role="tablist" aria-label="Video input method">
        {(['upload', 'url'] as const).map((tab) => (
          <button
            key={tab}
            role="tab"
            type="button"
            aria-selected={mode === tab}
            disabled={disabled}
            onClick={() => onModeChange(tab)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
              mode === tab
                ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-900 dark:text-indigo-300'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {tab === 'upload' ? <UploadCloud className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
            {tab === 'upload' ? 'Upload Video' : 'Video URL'}
          </button>
        ))}
      </div>

      {mode === 'upload' ? (
        <div>
          {!file ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                if (!disabled) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => !disabled && inputRef.current?.click()}
              role="button"
              tabIndex={disabled ? -1 : 0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (!disabled) inputRef.current?.click();
                }
              }}
              className={`flex min-h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${
                dragging
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40'
                  : 'border-slate-300 bg-slate-50 hover:border-indigo-400 hover:bg-indigo-50/50 dark:border-slate-700 dark:bg-slate-950/50 dark:hover:border-indigo-500 dark:hover:bg-indigo-950/30'
              } ${disabled ? 'pointer-events-none opacity-60' : ''}`}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300">
                <UploadCloud className="h-6 w-6" />
              </div>
              <div>
                <p className="font-semibold text-slate-700 dark:text-slate-200">Drop video here</p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  or <span className="font-medium text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-300">Browse Files</span>
                </p>
              </div>
              <p className="text-xs text-slate-400 dark:text-slate-500">
                MP4, WebM, MOV, AVI, MKV &middot; up to {maxUploadMb} MB
              </p>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED}
                className="hidden"
                onChange={(e) => {
                  handleFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-3 bg-slate-50 px-4 py-3 dark:bg-slate-950/60">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300">
                  <Film className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">
                    {video?.name ?? file.name}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {humanFileSize(video?.sizeBytes ?? file.size)}
                    {video ? ` · ${video.durationLabel}` : ''}
                    {uploadPercent !== null && uploadPercent < 100 ? ` · uploading ${uploadPercent}%` : video ? ' · uploaded' : ''}
                  </p>
                </div>
                {!disabled && (
                  <button
                    type="button"
                    onClick={onClearFile}
                    aria-label="Remove selected video"
                    className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-800"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              {previewUrl && (
                <video
                  key={previewUrl}
                  src={previewUrl}
                  controls
                  preload="metadata"
                  className="aspect-video w-full bg-black"
                />
              )}
            </div>
          )}
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onUrlSubmit();
          }}
          className="space-y-3"
        >
          <label htmlFor="video-url" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Paste video URL
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="video-url"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              disabled={disabled}
              value={urlValue}
              onChange={(e) => onUrlChange(e.target.value)}
              placeholder="https://example.com/video.mp4"
              className="w-full flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
            <button
              type="submit"
              disabled={disabled || urlBusy || urlValue.trim().length < 8}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-800 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-700 dark:hover:bg-slate-600"
            >
              {urlBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              {urlBusy ? 'Loading…' : 'Load video'}
            </button>
          </div>
          <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            Use a direct, publicly accessible link to a video file (MP4, WebM, MOV, AVI, MKV).
            Private, authenticated or DRM-protected content is not supported and is never bypassed.
          </p>
          {video && video.origin === 'url' && (
            <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-3 bg-slate-50 px-4 py-3 dark:bg-slate-950/60">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300">
                  <Film className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{video.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {video.sizeLabel} · {video.durationLabel}
                  </p>
                </div>
              </div>
            </div>
          )}
        </form>
      )}

      {showLocalError && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {showLocalError}
        </p>
      )}
    </section>
  );
}
