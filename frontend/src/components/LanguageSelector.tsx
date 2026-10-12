import { Globe } from 'lucide-react';
import { LANGUAGES } from '../types/languages';

interface Props {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
}

export default function LanguageSelector({ value, onChange, disabled }: Props) {
  return (
    <section aria-labelledby="target-language-heading" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex items-center gap-2">
        <Globe className="h-5 w-5 text-indigo-500" aria-hidden />
        <h2 id="target-language-heading" className="text-base font-semibold text-slate-800 dark:text-slate-100">
          Translate Summary To
        </h2>
      </div>

      <fieldset disabled={disabled} className="border-0 p-0 m-0">
        <legend className="sr-only">Choose the language for the translated summary</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {LANGUAGES.map((language) => {
            const checked = value === language.code;
            return (
              <label
                key={language.code}
                className="relative cursor-pointer select-none"
                title={language.nativeName && language.nativeName !== language.name ? language.nativeName : language.name}
              >
                <input
                  type="radio"
                  name="target-language"
                  value={language.code}
                  checked={checked}
                  onChange={() => onChange(language.code)}
                  className="peer sr-only"
                />
                <div
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition
                    peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500 peer-focus-visible:ring-offset-2
                    dark:peer-focus-visible:ring-offset-slate-950
                    ${
                      checked
                        ? 'border-indigo-500 bg-indigo-50 font-semibold text-indigo-700 shadow-sm dark:bg-indigo-950/50 dark:text-indigo-300'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800/60'
                    }`}
                >
                  <span aria-hidden className="text-base leading-none">
                    {language.flag ?? '🌐'}
                  </span>
                  <span className="truncate">{language.name}</span>
                </div>
              </label>
            );
          })}
        </div>
      </fieldset>
    </section>
  );
}
