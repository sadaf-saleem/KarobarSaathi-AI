import { useState, useEffect } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { api } from '../lib/api';

const TYPE_ICONS = {
  success: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
    </svg>
  ),
  warning: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  ),
  info: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
    </svg>
  )
};

const TYPE_COLORS = {
  success: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  warning: 'bg-amber-50 text-amber-600 border-amber-200',
  info: 'bg-blue-50 text-blue-600 border-blue-200'
};

const TYPE_ICON_BG = {
  success: 'bg-emerald-100',
  warning: 'bg-amber-100',
  info: 'bg-blue-100'
};

export default function Insights() {
  const { t, lang } = useLanguage();
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    try {
      setLoading(true);
      const data = await api.getInsights();
      setInsights(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const getInsightText = (insight) => {
    if (lang === 'ur' && insight.urdu) return insight.urdu;
    if (lang === 'roman' && insight.roman) return insight.roman;
    return insight.en;
  };

  return (
    <div className="page-container">
      <div className="mb-6">
        <h1 className="page-title !mb-1">{t('insights_title')}</h1>
        <p className="text-sm text-surface-500">{t('insights_desc')}</p>
      </div>

      {/* Data-driven notice */}
      <div className="flex items-start gap-3 mb-6 bg-surface-100 rounded-lg px-4 py-3 text-sm text-surface-600">
        <svg className="w-5 h-5 text-surface-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
        </svg>
        <span>{t('insights_data_driven')}</span>
      </div>

      {loading ? (
        <div className="space-y-4 animate-pulse">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-24 bg-surface-200 rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <div className="card p-8 text-center">
          <p className="text-surface-600 mb-4">{error}</p>
          <button onClick={load} className="btn-primary text-sm">{t('receipt_try_again')}</button>
        </div>
      ) : insights.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="w-14 h-14 rounded-full bg-surface-100 flex items-center justify-center mx-auto mb-3">
            <svg className="w-7 h-7 text-surface-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <p className="text-surface-500">{t('insights_empty')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {insights.map((insight, i) => {
            const type = insight.type || 'info';
            return (
              <div
                key={i}
                className={`card p-5 border-l-4 animate-slide-up ${TYPE_COLORS[type]}`}
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <div className="flex items-start gap-4">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${TYPE_ICON_BG[type]}`}>
                    {TYPE_ICONS[type]}
                  </div>
                  <div className="flex-1">
                    <p className={`text-sm leading-relaxed ${lang === 'ur' ? 'urdu-text text-base' : ''}`}>
                      {getInsightText(insight)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
