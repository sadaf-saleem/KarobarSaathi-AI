import { Link } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageContext';
import LanguageSwitcher from '../components/LanguageSwitcher';

export default function Landing() {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen bg-gradient-to-b from-surface-50 to-white">
      {/* Header */}
      <header className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-md shadow-brand-500/20">
              <span className="text-white font-bold text-xl">K</span>
            </div>
            <div>
              <span className="font-bold text-surface-900 text-xl">KarobarSaathi</span>
              <span className="text-gold-400 font-bold text-xl ml-0.5">AI</span>
            </div>
          </div>
          <LanguageSwitcher />
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-20 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-brand-50 border border-brand-100 rounded-full text-sm font-medium text-brand-700 mb-6">
          <span className="w-2 h-2 rounded-full bg-brand-500 animate-pulse" />
          AI-Powered
        </div>

        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-surface-900 tracking-tight leading-tight mb-4">
          {t('landing_hero_title')}
        </h1>

        <p className="text-lg sm:text-xl text-brand-600 font-semibold mb-3">
          {t('tagline')}
        </p>

        <p className="text-base sm:text-lg text-surface-500 max-w-2xl mx-auto mb-10 leading-relaxed">
          {t('landing_hero_desc')}
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link to="/dashboard" className="btn-primary text-base px-8 py-3 shadow-lg shadow-brand-500/25">
            {t('landing_cta')}
            <svg className="w-5 h-5 rtl-flip" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </Link>
          <Link to="/scan" className="btn-secondary text-base px-8 py-3">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
            </svg>
            {t('nav_scan')}
          </Link>
        </div>

        <p className="mt-6 text-xs text-surface-400 flex items-center justify-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-amber-400" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2L1 21h22L12 2zm0 4l7.53 13H4.47L12 6zm-1 5v4h2v-4h-2zm0 6v2h2v-2h-2z" />
          </svg>
          <span className="inline-flex items-center gap-1">
            <span className="bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">Demo</span>
            {t('landing_demo_note')}
          </span>
        </p>
      </section>

      {/* Feature Cards */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-24">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              title: t('landing_scan_title'),
              desc: t('landing_scan_desc'),
              icon: (
                <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                </svg>
              ),
              color: 'from-brand-500 to-brand-600'
            },
            {
              title: t('landing_track_title'),
              desc: t('landing_track_desc'),
              icon: (
                <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
              ),
              color: 'from-gold-400 to-gold-500'
            },
            {
              title: t('landing_insights_title'),
              desc: t('landing_insights_desc'),
              icon: (
                <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              ),
              color: 'from-blue-500 to-blue-600'
            }
          ].map((f, i) => (
            <div key={i} className="card p-6 text-center hover:shadow-lg transition-shadow">
              <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${f.color} flex items-center justify-center mx-auto mb-4 text-white shadow-md`}>
                {f.icon}
              </div>
              <h3 className="font-bold text-surface-800 text-lg mb-2">{f.title}</h3>
              <p className="text-sm text-surface-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-surface-200 py-8 text-center text-sm text-surface-400">
        <p>&copy; 2026 KarobarSaathi AI &mdash; {t('tagline')}</p>
      </footer>
    </div>
  );
}
