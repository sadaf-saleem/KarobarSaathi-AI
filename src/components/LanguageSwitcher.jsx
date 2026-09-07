import { useLanguage } from '../i18n/LanguageContext';

export default function LanguageSwitcher() {
  const { lang, setLang, LANGS } = useLanguage();

  return (
    <div className="relative group">
      <button className="btn-ghost !px-2.5 !py-1.5 text-xs gap-1.5">
        <svg className="w-4 h-4 rtl-flip" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 21l5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 016-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 01-3.827-5.802" />
        </svg>
        <span className="hidden sm:inline">{LANGS.find(l => l.code === lang)?.label || 'EN'}</span>
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {/* Dropdown */}
      <div className="absolute right-0 top-full mt-1 bg-white border border-surface-200 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 min-w-[140px]">
        {LANGS.map(l => (
          <button
            key={l.code}
            onClick={() => setLang(l.code)}
            className={`w-full text-left px-3.5 py-2 text-sm hover:bg-surface-50 transition-colors first:rounded-t-lg last:rounded-b-lg ${
              lang === l.code ? 'text-brand-600 font-medium bg-brand-50' : 'text-surface-700'
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}
