import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageContext';
import { api } from '../lib/api';

// ── Voice-text parser ───────────────────────────────────
// Extracts transaction fields from natural-language speech (English + Roman Urdu).
// No backend needed — all parsing is client-side regex.

const SALE_RE = /\b(sale|sold|bech|becha|bikee|biki|revenue|income|customer\s*(?:ne|paid|gave|purchase))\b/i;
const EXPENSE_RE = /\b(purchase|purchased|bought|buy|khareed|khareeda|maal|expense|kharcha|kharch|supplier|vendor\s*bill|bizn?ess\s*expense)\b/i;

// Amount patterns: "5000", "Rs. 5000", "Rs 5000", "5000 rupees", "5000 rupay", "5,000"
const AMOUNT_RE = /(?:rs\.?|₨)\s*([\d,]+(?:\.\d+)?)\b|\b([\d,]+(?:\.\d+)?)\s*(?:rupees?|rupay|rupye|rs\.?)\b|\b([\d,]{3,}(?:\.\d+)?)\b/gi;

function parseAmounts(text) {
  const amounts = [];
  let m;
  AMOUNT_RE.lastIndex = 0;
  while ((m = AMOUNT_RE.exec(text)) !== null) {
    const raw = (m[1] || m[2] || m[3] || '').replace(/,/g, '');
    const n = parseFloat(raw);
    if (!isNaN(n) && n > 0) amounts.push(n);
  }
  return amounts;
}

function classifyType(text) {
  const hasSale = SALE_RE.test(text);
  const hasExpense = EXPENSE_RE.test(text);
  if (hasSale && !hasExpense) return 'sale';
  if (hasExpense && !hasSale) return 'expense';
  if (hasSale && hasExpense) return 'ambiguous'; // both mentioned — user must choose
  return 'ambiguous'; // neither — user must choose
}

function parseVoiceText(text) {
  if (!text || !text.trim()) return null;

  const type = classifyType(text);
  const amounts = parseAmounts(text);

  // Use the largest amount as the total (most likely the main transaction value)
  const total = amounts.length > 0 ? Math.max(...amounts) : 0;

  // Build a clean description from the original text
  const description = text.trim().replace(/\s+/g, ' ').substring(0, 200);

  return {
    type,
    total,
    description,
    date: new Date().toISOString().split('T')[0],
    category: '',
    vendor: '',
    items: []
  };
}

// ── Speech recognition wrapper ──────────────────────────
function getSpeechRecognition() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

// ── Steps ───────────────────────────────────────────────
const STEPS = { IDLE: 0, LISTENING: 1, TRANSCRIBED: 2, REVIEW: 3, SAVED: 4 };

export default function VoiceEntry() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [step, setStep] = useState(STEPS.IDLE);
  const [transcript, setTranscript] = useState('');
  const [interimText, setInterimText] = useState('');
  const [formData, setFormData] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState({ sale: [], expense: [] });
  const [unsupported, setUnsupported] = useState(false);
  const recognitionRef = useRef(null);

  useEffect(() => {
    api.getCategories().then(setCategories).catch(() => {});
  }, []);

  // Check browser support on mount
  useEffect(() => {
    if (!getSpeechRecognition()) {
      setUnsupported(true);
    }
  }, []);

  const startListening = useCallback(() => {
    const SR = getSpeechRecognition();
    if (!SR) {
      setUnsupported(true);
      return;
    }
    setError(null);
    setTranscript('');
    setInterimText('');
    setFormData(null);

    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    // Use English as primary — Roman Urdu words are mostly ASCII and work fine
    recognition.lang = 'en-PK';
    recognition.maxAlternatives = 1;

    let finalTranscript = '';

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript + ' ';
        } else {
          interim += result[0].transcript;
        }
      }
      setTranscript(finalTranscript.trim());
      setInterimText(interim);
    };

    recognition.onerror = (event) => {
      if (event.error === 'not-allowed') {
        setError('Microphone permission denied. Please allow microphone access and try again.');
      } else if (event.error === 'no-speech') {
        setError('No speech detected. Please speak clearly and try again.');
      } else if (event.error === 'network') {
        setError('Network error — speech recognition requires an internet connection.');
      } else {
        setError(`Speech recognition error: ${event.error}`);
      }
      setStep(STEPS.IDLE);
    };

    recognition.onend = () => {
      const full = finalTranscript.trim();
      if (full) {
        setTranscript(full);
        const parsed = parseVoiceText(full);
        if (parsed) {
          setFormData(parsed);
          setStep(STEPS.REVIEW);
        } else {
          setStep(STEPS.TRANSCRIBED);
        }
      } else {
        setStep(STEPS.IDLE);
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setStep(STEPS.LISTENING);
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  }, []);

  const processTranscript = useCallback(() => {
    const text = transcript.trim();
    if (!text) return;
    const parsed = parseVoiceText(text);
    if (parsed) {
      setFormData(parsed);
      setStep(STEPS.REVIEW);
    }
  }, [transcript]);

  const saveTransaction = async () => {
    if (formData.type === 'ambiguous') {
      setError('Please choose whether this is a Sale or an Expense before saving.');
      return;
    }
    if (!formData.total || formData.total <= 0) {
      setError('Please enter a valid amount.');
      return;
    }
    if (!formData.category) {
      setError('Please select a category.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.createTransaction({
        date: formData.date,
        type: formData.type,
        category: formData.category,
        amount: formData.total,
        description: formData.description,
        items: formData.items,
        vendor: formData.vendor,
        source: 'voice'
      });
      setStep(STEPS.SAVED);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setStep(STEPS.IDLE);
    setTranscript('');
    setInterimText('');
    setFormData(null);
    setError(null);
  };

  const cats = formData ? (formData.type === 'sale' ? categories.sale : categories.expense) : [];

  // ── Unsupported browser ─────────────────────────────
  if (unsupported) {
    return (
      <div className="page-container max-w-2xl">
        <h1 className="page-title">{t('voice_title')}</h1>
        <div className="card p-10 text-center animate-slide-up">
          <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-surface-900 mb-2">{t('voice_unsupported')}</h2>
          <p className="text-sm text-surface-500 mb-6">{t('voice_unsupported_desc')}</p>
          <div className="flex gap-3 justify-center">
            <Link to="/add" className="btn-primary text-sm">{t('tx_add')}</Link>
            <Link to="/scan" className="btn-secondary text-sm">{t('nav_scan')}</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container max-w-2xl">
      <h1 className="page-title">{t('voice_title')}</h1>

      {/* Progress steps */}
      <div className="flex items-center gap-2 mb-8">
        {[{ key: 'step_speak' }, { key: 'step_transcript' }, { key: 'step_review' }, { key: 'step_save' }].map((step_item, i) => (
          <div key={step_item.key} className="flex items-center gap-2 flex-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
              i <= step ? 'bg-brand-500 text-white' : 'bg-surface-200 text-surface-500'
            }`}>
              {i < step ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              ) : i + 1}
            </div>
            <span className={`text-xs font-medium hidden sm:inline ${i <= step ? 'text-brand-700' : 'text-surface-400'}`}>{t(step_item.key)}</span>
            {i < 3 && <div className={`flex-1 h-0.5 rounded ${i < step ? 'bg-brand-400' : 'bg-surface-200'}`} />}
          </div>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-6 text-sm animate-fade-in">
          {error}
        </div>
      )}

      {/* STEP: IDLE — show mic button */}
      {step === STEPS.IDLE && (
        <div className="animate-fade-in">
          <div className="card p-10 text-center">
            <p className="text-sm text-surface-500 mb-6">{t('voice_instruction')}</p>
            <button
              onClick={startListening}
              className="group relative inline-flex items-center justify-center w-24 h-24 rounded-full bg-brand-500 hover:bg-brand-600 text-white shadow-lg hover:shadow-xl transition-all"
              aria-label="Start recording"
            >
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
              </svg>
              <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-400 border-2 border-white" />
            </button>
            <p className="text-xs text-surface-400 mt-4">{t('voice_click_mic')}</p>
          </div>

          {/* Tips */}
          <div className="card p-5 mt-5">
            <h3 className="text-sm font-semibold text-surface-700 mb-3">{t('voice_tips_title')}</h3>
            <ul className="space-y-2 text-sm text-surface-500">
              <li className="flex items-start gap-2">
                <span className="text-brand-500 mt-0.5">•</span>
                <span>"{t('voice_example_sale')}"</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-brand-500 mt-0.5">•</span>
                <span>"{t('voice_example_expense')}"</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-brand-500 mt-0.5">•</span>
                <span>"{t('voice_example_ambiguous')}"</span>
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* STEP: LISTENING — pulsing mic + interim text */}
      {step === STEPS.LISTENING && (
        <div className="animate-fade-in">
          <div className="card p-10 text-center">
            {/* Pulsing mic */}
            <div className="relative inline-flex items-center justify-center mb-6">
              <div className="absolute w-28 h-28 rounded-full bg-red-100 animate-ping opacity-30" />
              <div className="absolute w-24 h-24 rounded-full bg-red-200 animate-pulse opacity-40" />
              <button
                onClick={stopListening}
                className="relative z-10 w-20 h-20 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-lg transition-all flex items-center justify-center"
                aria-label="Stop recording"
              >
                <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            </div>
            <p className="font-semibold text-surface-800 mb-1">{t('voice_listening')}</p>
            <p className="text-xs text-surface-400 mb-4">{t('voice_tap_stop')}</p>

            {/* Live transcript */}
            {(transcript || interimText) && (
              <div className="bg-surface-50 rounded-lg p-4 text-left max-h-32 overflow-y-auto">
                <p className="text-sm text-surface-700">
                  {transcript}
                  {interimText && <span className="text-surface-400 italic"> {interimText}</span>}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* STEP: TRANSCRIBED — text captured but no amount found */}
      {step === STEPS.TRANSCRIBED && (
        <div className="animate-slide-up">
          <div className="card p-6">
            <h3 className="font-semibold text-surface-800 mb-2">{t('voice_transcript_title')}</h3>
            <div className="bg-surface-50 rounded-lg p-4 mb-4">
              <p className="text-sm text-surface-700">{transcript}</p>
            </div>
            <p className="text-sm text-amber-600 mb-4">{t('voice_no_amount')}</p>
            <div>
              <label className="label">{t('manual_amount')}</label>
              <input
                type="number"
                className="input"
                placeholder="0"
                onChange={(e) => {
                  const amt = Number(e.target.value);
                  if (amt > 0) {
                    const parsed = parseVoiceText(transcript) || {
                      type: 'ambiguous', total: amt, description: transcript, date: new Date().toISOString().split('T')[0],
                      category: '', vendor: '', items: []
                    };
                    parsed.total = amt;
                    setFormData(parsed);
                    setStep(STEPS.REVIEW);
                  }
                }}
              />
            </div>
            <button onClick={reset} className="btn-secondary mt-4 text-sm">{t('voice_try_again')}</button>
          </div>
        </div>
      )}

      {/* STEP: REVIEW — editable form */}
      {step === STEPS.REVIEW && formData && (
        <div className="animate-slide-up space-y-5">
          {/* Voice badge */}
          <div className="bg-violet-50 border border-violet-200 rounded-lg px-4 py-3 text-sm text-violet-800 flex items-start gap-3">
            <svg className="w-5 h-5 text-violet-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
            </svg>
            <div>
              <span className="font-medium">{t('voice_badge_label')}</span>
              <p className="text-xs text-violet-700 mt-1">{t('voice_review_hint')}</p>
            </div>
          </div>

          {/* Transcribed text */}
          <details className="card p-4" open>
            <summary className="text-sm font-medium text-surface-600 cursor-pointer hover:text-surface-800">
              {t('voice_transcript_title')}
            </summary>
            <p className="mt-3 text-xs text-surface-500 bg-surface-50 p-3 rounded-lg">{transcript}</p>
          </details>

          {/* Ambiguous type confirmation */}
          {formData.type === 'ambiguous' && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
              <div className="flex items-center gap-2 mb-1">
                <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.754m-.075 3.546h.008v.008h-.008v-.008zm-2.024 3.775a7.5 7.5 0 1 0 6.89-11.918 7.5 7.5 0 0 0-6.89 11.918z" />
                </svg>
                <span className="font-medium">{t('voice_type_confirm')}</span>
              </div>
              <p className="text-xs mb-3">{t('voice_type_confirm_desc')}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setFormData(p => ({ ...p, type: 'sale' }))}
                  className="btn-primary flex-1 !py-2 !text-sm"
                >
                  {t('receipt_type_sale')}
                </button>
                <button
                  type="button"
                  onClick={() => setFormData(p => ({ ...p, type: 'expense' }))}
                  className="btn-secondary flex-1 !py-2 !text-sm"
                >
                  {t('receipt_type_expense')}
                </button>
              </div>
            </div>
          )}

          <div className="card p-5">
            <h3 className="font-semibold text-surface-800 mb-4">{t('voice_review_title')}</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
              <div>
                <label className="label">{t('manual_type')}</label>
                <select
                  className={formData.type === 'ambiguous' ? 'select !border-amber-400 !bg-amber-50' : 'select'}
                  value={formData.type}
                  onChange={(e) => setFormData(p => ({ ...p, type: e.target.value, category: '' }))}
                >
                  {formData.type === 'ambiguous' && <option value="ambiguous">Please choose…</option>}
                  <option value="sale">{t('receipt_type_sale')}</option>
                  <option value="expense">{t('receipt_type_expense')}</option>
                </select>
              </div>
              <div>
                <label className="label">{t('manual_date')}</label>
                <input type="date" className="input" value={formData.date} onChange={(e) => setFormData(p => ({ ...p, date: e.target.value }))} />
              </div>
              <div>
                <label className="label">{t('manual_category')}</label>
                <select className="select" value={formData.category} onChange={(e) => setFormData(p => ({ ...p, category: e.target.value }))}>
                  <option value="">Select category...</option>
                  {cats.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="label">{t('manual_amount')}</label>
                <input
                  type="number" className="input" placeholder="0"
                  value={formData.total || ''}
                  onChange={(e) => setFormData(p => ({ ...p, total: Number(e.target.value) }))}
                />
              </div>
              <div>
                <label className="label">{t('manual_vendor')}</label>
                <input
                  type="text" className="input" placeholder="Optional"
                  value={formData.vendor}
                  onChange={(e) => setFormData(p => ({ ...p, vendor: e.target.value }))}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="label">{t('manual_description')}</label>
                <input
                  type="text" className="input"
                  value={formData.description}
                  onChange={(e) => setFormData(p => ({ ...p, description: e.target.value }))}
                />
              </div>
            </div>

            {/* Total display */}
            <div className="flex items-center justify-between py-3 border-t border-surface-200">
              <span className="font-semibold text-surface-700">Total</span>
              <span className="text-xl font-bold text-surface-900">Rs. {(formData.total || 0).toLocaleString()}</span>
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={saveTransaction} disabled={saving} className="btn-primary flex-1">
              {saving ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              )}
              {t('receipt_confirm_save')}
            </button>
            <button onClick={reset} className="btn-secondary">{t('voice_try_again')}</button>
          </div>
        </div>
      )}

      {/* STEP: SAVED */}
      {step === STEPS.SAVED && (
        <div className="animate-slide-up text-center">
          <div className="card p-10">
            <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-surface-900 mb-2">{t('receipt_saved')}</h2>
            <p className="text-sm text-surface-500 mb-6">{t('voice_saved_desc')}</p>
            <div className="flex gap-3 justify-center flex-wrap">
              <button onClick={reset} className="btn-primary">{t('voice_record_another')}</button>
              <button onClick={() => navigate('/dashboard')} className="btn-secondary">{t('nav_dashboard')}</button>
              <button onClick={() => navigate('/insights')} className="btn-ghost text-brand-600">{t('nav_insights')} &rarr;</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
