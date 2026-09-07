import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageContext';
import { api } from '../lib/api';

const STEPS = {
  UPLOAD: 0, PROCESSING: 1, REVIEW: 2, SAVED: 3,
  // MULTI_REVIEW/MULTI_SAVED are for multiple receipts detected inside a
  // single uploaded image (one photo containing 2+ separate receipts).
  MULTI_REVIEW: 4, MULTI_SAVED: 5
};

export default function ReceiptScan() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [step, setStep] = useState(STEPS.UPLOAD);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [formData, setFormData] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [ocrInfo, setOcrInfo] = useState(null);
  const [multiReceipts, setMultiReceipts] = useState(null);
  const [multiReceiptUrl, setMultiReceiptUrl] = useState(null);
  const [categories, setCategories] = useState({ sale: [], expense: [] });

  useEffect(() => {
    api.getCategories().then(setCategories).catch(() => {});
  }, []);

  const handleFile = useCallback((f) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) { setError('Please select an image file'); return; }
    if (f.size > 10 * 1024 * 1024) { setError('File too large (max 10MB)'); return; }
    setFile(f);
    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target.result);
    reader.readAsDataURL(f);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files?.[0]);
  }, [handleFile]);

  const processReceipt = async () => {
    if (!file) return;
    setStep(STEPS.PROCESSING);
    setError(null);
    setOcrInfo(null);
    setMultiReceipts(null);
    setMultiReceiptUrl(null);
    try {
      const res = await api.processReceipt(file);

      // ── Multi-receipt response ────────────────────
      if (res.multi && res.receipts?.length >= 2) {
        const mapped = res.receipts.map(r => ({
          date: r.extracted.date,
          type: r.extracted.type,
          category: r.extracted.category,
          vendor: r.extracted.vendor || '',
          description: r.extracted.description || '',
          total: r.extracted.total,
          items: r.extracted.items || [],
          paymentMethod: r.extracted.paymentMethod || '',
          confidence: r.confidence,
          mode: r.mode
        }));
        setMultiReceipts(mapped);
        setMultiReceiptUrl(res.receipt_url || '');
        setStep(STEPS.MULTI_REVIEW);
        return;
      }

      // ── Single receipt (unchanged) ────────────────
      setResult(res);
      setOcrInfo({
        mode: res.mode,
        confidence: res.confidence,
        rawText: res.rawText,
        lowConfidenceFields: res.extracted?.lowConfidenceFields || [],
        source: res.source || res.mode
      });
      setFormData({
        date: res.extracted.date,
        type: res.extracted.type,
        category: res.extracted.category,
        vendor: res.extracted.vendor || '',
        description: res.extracted.description || '',
        total: res.extracted.total,
        items: res.extracted.items || [],
        paymentMethod: res.extracted.paymentMethod || ''
      });
      setStep(STEPS.REVIEW);
    } catch (e) {
      setError(e.message);
      // Keep any raw text the backend managed to read, for debugging
      setOcrInfo(e.rawText ? { mode: 'error', confidence: 0, rawText: e.rawText, lowConfidenceFields: [] } : null);
      setStep(STEPS.UPLOAD);
    }
  };

  const updateItem = (idx, field, value) => {
    setFormData(prev => {
      const items = [...prev.items];
      items[idx] = { ...items[idx], [field]: value };
      const total = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
      return { ...prev, items, total };
    });
  };

  const removeItem = (idx) => {
    setFormData(prev => {
      const items = prev.items.filter((_, i) => i !== idx);
      const total = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
      return { ...prev, items, total };
    });
  };

  const addItem = () => {
    setFormData(prev => ({
      ...prev,
      items: [...prev.items, { name: '', qty: 1, price: 0 }]
    }));
  };

  const saveTransaction = async () => {
    // An ambiguous receipt must never be silently saved as Sale or Expense —
    // the user has to confirm the type first.
    if (formData.type === 'ambiguous') {
      setError('This receipt does not indicate whether it is a Sale or an Expense. Please choose the transaction type before saving.');
      return;
    }
    if (savingRef.current) return;
    savingRef.current = true;
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
        source: 'receipt_scan',
        receipt_url: result.receipt_url
      });
      setStep(STEPS.SAVED);
    } catch (e) {
      setError(e.message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const reset = () => {
    setStep(STEPS.UPLOAD);
    setFile(null);
    setPreview(null);
    setResult(null);
    setFormData(null);
    setError(null);
    setOcrInfo(null);
    setMultiReceipts(null);
    setMultiReceiptUrl(null);
  };

  // ── Multi-receipt helpers ─────────────────────────
  const updateMultiReceipt = (idx, field, value) => {
    setMultiReceipts(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  const updateMultiItem = (receiptIdx, itemIdx, field, value) => {
    setMultiReceipts(prev => {
      const receipts = [...prev];
      const items = [...receipts[receiptIdx].items];
      items[itemIdx] = { ...items[itemIdx], [field]: value };
      const total = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
      receipts[receiptIdx] = { ...receipts[receiptIdx], items, total };
      return receipts;
    });
  };

  const removeMultiItem = (receiptIdx, itemIdx) => {
    setMultiReceipts(prev => {
      const receipts = [...prev];
      const items = receipts[receiptIdx].items.filter((_, i) => i !== itemIdx);
      const total = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
      receipts[receiptIdx] = { ...receipts[receiptIdx], items, total };
      return receipts;
    });
  };

  const removeMultiReceipt = (idx) => {
    setMultiReceipts(prev => prev.filter((_, i) => i !== idx));
  };

  // Guards saveAllReceipts against firing twice from a rapid double-click
  // or double-tap (React's `saving` state doesn't disable the button
  // synchronously, so a very fast second click can slip through before
  // the re-render happens and cause every receipt to be saved twice).
  const savingRef = useRef(false);

  const saveAllReceipts = async () => {
    if (!multiReceipts || multiReceipts.length === 0) return;
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const errors = [];
    for (let i = 0; i < multiReceipts.length; i++) {
      const r = multiReceipts[i];
      if (r.type === 'ambiguous') {
        errors.push(`Receipt ${i + 1}: type is still ambiguous — please choose Sale or Expense`);
        continue;
      }
      try {
        await api.createTransaction({
          date: r.date || new Date().toISOString().split('T')[0],
          type: r.type,
          category: r.category || 'Other',
          amount: r.total,
          description: r.description,
          items: r.items,
          vendor: r.vendor,
          source: 'receipt_scan',
          receipt_url: multiReceiptUrl || ''
        });
      } catch (e) {
        errors.push(`Receipt ${i + 1}: ${e.message}`);
      }
    }
    if (errors.length > 0) {
      setError(errors.join('. '));
    }
    savingRef.current = false;
    setSaving(false);
    if (errors.length === 0) {
      setStep(STEPS.MULTI_SAVED);
    }
  };

  return (
    <div className="page-container max-w-3xl">
      <h1 className="page-title">{t('receipt_title')}</h1>

      {/* Progress Steps */}
      <div className="flex items-center gap-2 mb-8">
        {[{ key: 'step_upload' }, { key: 'step_process' }, { key: 'step_review' }, { key: 'step_save' }].map((step_item, i) => (
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

      {/* Raw OCR text from a failed attempt — debugging aid */}
      {ocrInfo?.mode === 'error' && ocrInfo.rawText && (
        <details className="card p-4 mb-6" open>
          <summary className="text-sm font-medium text-surface-600 cursor-pointer hover:text-surface-800">
            {t('receipt_raw_ocr_failed')}
          </summary>
          <pre className="mt-3 text-xs text-surface-500 bg-surface-50 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">
            {ocrInfo.rawText}
          </pre>
        </details>
      )}

      {/* STEP: UPLOAD */}
      {step === STEPS.UPLOAD && (
        <div className="animate-fade-in">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`card p-8 text-center border-2 border-dashed transition-colors cursor-pointer ${
              dragOver ? 'border-brand-400 bg-brand-50' : 'border-surface-300 hover:border-brand-300'
            }`}
          >
            <input
              type="file"
              accept="image/*"
              onChange={(e) => handleFile(e.target.files?.[0])}
              className="hidden"
              id="receipt-upload"
            />
            <label htmlFor="receipt-upload" className="cursor-pointer">
              <div className="w-16 h-16 rounded-full bg-brand-50 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-brand-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
              </div>
              <p className="font-medium text-surface-700 mb-1">{t('receipt_upload')}</p>
              <p className="text-sm text-surface-500">{t('receipt_drag')}</p>
              <p className="text-xs text-surface-400 mt-2">{t('receipt_formats')}</p>
            </label>
          </div>

          {/* Preview — single file */}
          {preview && (
            <div className="mt-6 animate-slide-up">
              <div className="card overflow-hidden">
                <div className="relative">
                  <img src={preview} alt="Receipt preview" className="w-full max-h-80 object-contain bg-surface-100" />
                </div>
                <div className="p-4 flex items-center justify-between">
                  <span className="text-sm text-surface-600">{file?.name}</span>
                  <button onClick={processReceipt} className="btn-primary">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                    </svg>
                    {t('receipt_process_btn')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* STEP: PROCESSING */}
      {step === STEPS.PROCESSING && (
        <div className="animate-fade-in">
          <div className="card overflow-hidden">
            <div className="relative">
              {preview && <img src={preview} alt="Processing" className="w-full max-h-80 object-contain bg-surface-100 opacity-60" />}
              <div className="scan-overlay">
                <div className="scan-line" />
              </div>
            </div>
            <div className="p-6 text-center">
              <div className="flex items-center justify-center gap-3 mb-2">
                <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                <span className="font-semibold text-surface-800">{t('receipt_processing')}</span>
              </div>
              <p className="text-sm text-surface-500">{t('receipt_ai_reading')}</p>
            </div>
          </div>
        </div>
      )}

      {/* STEP: REVIEW */}
      {step === STEPS.REVIEW && formData && (
        <div className="animate-slide-up space-y-5">
          {/* Source / mode indicator */}
          {ocrInfo?.mode === 'ai-vision' ? (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-800 flex items-start gap-3">
              <svg className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
              <div>
                <span className="font-medium">{t('receipt_ai_vision_mode')}</span>
                {ocrInfo.confidence > 0 && (
                  <span className="ml-2 text-xs">(confidence: {Math.round(ocrInfo.confidence)}%)</span>
                )}
                <p className="text-xs text-blue-700 mt-1">{t('receipt_ai_vision_desc')}</p>
              </div>
            </div>
          ) : ocrInfo?.mode === 'ocr' ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-800 flex items-start gap-3">
              <svg className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
              <div>
                <span className="font-medium">{t('receipt_ocr_mode')}</span>
                {ocrInfo.confidence > 0 && (
                  <span className="ml-2 text-xs">(confidence: {Math.round(ocrInfo.confidence)}%)</span>
                )}
                <p className="text-xs text-emerald-700 mt-1">{t('receipt_ocr_review')}</p>
              </div>
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
              {t('receipt_demo_mode')}
            </div>
          )}

          {/* Low-confidence field warnings */}
          {ocrInfo?.lowConfidenceFields?.length > 0 && (() => {
            const totalFailure = ['total', 'date', 'vendor', 'items'].every((f) => ocrInfo.lowConfidenceFields.includes(f));
            return (
              <div className={totalFailure ? 'bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800' : 'bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800'}>
                <div className="flex items-center gap-2 mb-1">
                  <svg className={totalFailure ? 'w-4 h-4 text-red-500' : 'w-4 h-4 text-amber-500'} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
                  </svg>
                  <span className="font-medium">{totalFailure ? 'OCR could not read this receipt' : 'Some fields may need correction'}</span>
                </div>
                <p className="text-xs">
                  {totalFailure
                    ? 'The OCR engines could not reliably read this image. The fields below have been left blank — please review the raw text and enter the correct details manually.'
                    : `The following fields could not be read clearly: ${ocrInfo.lowConfidenceFields.join(', ')}. Please review and correct them below.`}
                </p>
              </div>
            );
          })()}

          {/* Ambiguous transaction type — user must confirm Sale or Expense */}
          {formData.type === 'ambiguous' && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
              <div className="flex items-center gap-2 mb-1">
                <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.754m-.075 3.546h.008v.008h-.008v-.008zm-2.024 3.775a7.5 7.5 0 1 0 6.89-11.918 7.5 7.5 0 0 0-6.89 11.918z" />
                </svg>
                <span className="font-medium">Transaction type needs your confirmation</span>
              </div>
              <p className="text-xs mb-3">This receipt does not say whether it is a sale to a customer or an expense for your business. Please choose one — all other details are already filled in from the scan.</p>
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
            <h3 className="font-semibold text-surface-800 mb-4">{t('receipt_extracted')}</h3>
            <p className="text-xs text-surface-500 mb-5">{t('receipt_review')}</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
              <div>
                <label className="label">{t('manual_type')}</label>
                <select className={formData.type === 'ambiguous' ? 'select !border-amber-400 !bg-amber-50' : 'select'} value={formData.type} onChange={(e) => setFormData(p => ({...p, type: e.target.value}))}>
                  {formData.type === 'ambiguous' && <option value="ambiguous">Please choose…</option>}
                  <option value="sale">{t('receipt_type_sale')}</option>
                  <option value="expense">{t('receipt_type_expense')}</option>
                </select>
              </div>
              <div>
                <label className="label">{t('manual_date')}</label>
                <input type="date" className="input" value={formData.date} onChange={(e) => setFormData(p => ({...p, date: e.target.value}))} />
              </div>
              <div>
                <label className="label">{t('manual_category')}</label>
                <select className="select" value={formData.category} onChange={(e) => setFormData(p => ({...p, category: e.target.value}))}>
                  {formData.category && !categories[formData.type === 'ambiguous' ? 'expense' : formData.type]?.includes(formData.category) && (
                    <option value={formData.category}>{formData.category}</option>
                  )}
                  {(categories[formData.type === 'ambiguous' ? 'expense' : formData.type] || []).map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">{t('manual_vendor')}</label>
                <input type="text" className="input" value={formData.vendor} onChange={(e) => setFormData(p => ({...p, vendor: e.target.value}))} />
              </div>
              <div className="sm:col-span-2">
                <label className="label">{t('manual_description')}</label>
                <input type="text" className="input" value={formData.description} onChange={(e) => setFormData(p => ({...p, description: e.target.value}))} />
              </div>
            </div>

            {/* Items */}
            <div className="mb-4">
              <label className="label">{t('manual_items')}</label>
              <div className="space-y-2">
                {formData.items.map((item, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input
                      type="text" className="input flex-1 !py-2 text-sm" placeholder={t('manual_item_name')}
                      value={item.name} onChange={(e) => updateItem(i, 'name', e.target.value)}
                    />
                    <input
                      type="number" className="input w-16 !py-2 text-sm text-center" placeholder={t('manual_item_qty')}
                      value={item.qty} onChange={(e) => updateItem(i, 'qty', Number(e.target.value))}
                    />
                    <input
                      type="number" className="input w-24 !py-2 text-sm" placeholder={t('manual_item_price')}
                      value={item.price} onChange={(e) => updateItem(i, 'price', Number(e.target.value))}
                    />
                    <button onClick={() => removeItem(i)} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
              <button onClick={addItem} className="btn-ghost text-sm mt-2 !px-3 !py-1.5 text-brand-600">
                {t('manual_add_item')}
              </button>
            </div>

            {/* Total */}
            <div className="flex items-center justify-between py-3 border-t border-surface-200">
              <span className="font-semibold text-surface-700">{t('receipt_total_label')}</span>
              <span className="text-xl font-bold text-surface-900">Rs. {formData.total.toLocaleString()}</span>
            </div>

            {/* Payment method if detected */}
            {formData.paymentMethod && (
              <div className="flex items-center gap-2 pt-2 text-sm text-surface-500">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
                </svg>
                {t('receipt_payment_label')}: {formData.paymentMethod}
              </div>
            )}
          </div>

          {/* Raw OCR text (collapsible) */}
          {ocrInfo?.mode === 'ocr' && (
            <details className="card p-4" open>
              <summary className="text-sm font-medium text-surface-600 cursor-pointer hover:text-surface-800">
                {t('receipt_raw_text')}
              </summary>
              <pre className="mt-3 text-xs text-surface-500 bg-surface-50 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">
                {ocrInfo.rawText || '(no text returned by the OCR engines)'}
              </pre>
            </details>
          )}

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
            <button onClick={reset} className="btn-secondary">
              {t('receipt_cancel')}
            </button>
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
            <p className="text-sm text-surface-500 mb-6">{t('receipt_saved_desc')}</p>
            <div className="flex gap-3 justify-center flex-wrap">
              <button onClick={reset} className="btn-primary">
                {t('receipt_scan_new')}
              </button>
              <button onClick={() => navigate('/dashboard')} className="btn-secondary">
                {t('nav_dashboard')}
              </button>
              <button onClick={() => navigate('/insights')} className="btn-ghost text-brand-600">
                {t('nav_insights')} &rarr;
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP: MULTI-RECEIPT REVIEW */}
      {step === STEPS.MULTI_REVIEW && multiReceipts && (
        <div className="animate-slide-up space-y-5">
          {/* Header */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-800 flex items-start gap-3">
            <svg className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <div>
              <span className="font-medium">{multiReceipts.length} {t('multi_detected_title')}</span>
              <p className="text-xs text-blue-700 mt-1">{t('multi_detected_desc')}</p>
            </div>
          </div>

          {/* Each receipt card */}
          {multiReceipts.map((r, ri) => (
            <div key={ri} className="card p-5 border-l-4 border-l-brand-400">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-surface-800">
                  {t('multi_receipt_number')} {ri + 1}
                  {r.vendor && <span className="text-surface-500 font-normal"> — {r.vendor}</span>}
                </h3>
                <button
                  onClick={() => removeMultiReceipt(ri)}
                  className="btn-ghost !px-2 !py-1 text-xs text-red-500 hover:text-red-700 hover:bg-red-50"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  {t('multi_remove')}
                </button>
              </div>

              {/* Ambiguous type warning */}
              {r.type === 'ambiguous' && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800 mb-4">
                  <div className="flex items-center gap-2 mb-1">
                    <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
                    </svg>
                    <span className="font-medium">Transaction type needs your confirmation</span>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button type="button" onClick={() => updateMultiReceipt(ri, 'type', 'sale')} className="btn-primary flex-1 !py-1.5 !text-xs">{t('receipt_type_sale')}</button>
                    <button type="button" onClick={() => updateMultiReceipt(ri, 'type', 'expense')} className="btn-secondary flex-1 !py-1.5 !text-xs">{t('receipt_type_expense')}</button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="label">{t('manual_type')}</label>
                  <select className={r.type === 'ambiguous' ? 'select !border-amber-400 !bg-amber-50' : 'select'} value={r.type} onChange={(e) => updateMultiReceipt(ri, 'type', e.target.value)}>
                    {r.type === 'ambiguous' && <option value="ambiguous">Please choose…</option>}
                    <option value="sale">{t('receipt_type_sale')}</option>
                    <option value="expense">{t('receipt_type_expense')}</option>
                  </select>
                </div>
                <div>
                  <label className="label">{t('manual_date')}</label>
                  <input type="date" className="input" value={r.date || ''} onChange={(e) => updateMultiReceipt(ri, 'date', e.target.value)} />
                </div>
                <div>
                  <label className="label">{t('manual_category')}</label>
                  <select className="select" value={r.category || ''} onChange={(e) => updateMultiReceipt(ri, 'category', e.target.value)}>
                    {r.category && !categories[r.type === 'ambiguous' ? 'expense' : r.type]?.includes(r.category) && (
                      <option value={r.category}>{r.category}</option>
                    )}
                    {(categories[r.type === 'ambiguous' ? 'expense' : r.type] || []).map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">{t('manual_vendor')}</label>
                  <input type="text" className="input" value={r.vendor} onChange={(e) => updateMultiReceipt(ri, 'vendor', e.target.value)} />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">{t('manual_description')}</label>
                  <input type="text" className="input" value={r.description} onChange={(e) => updateMultiReceipt(ri, 'description', e.target.value)} />
                </div>
              </div>

              {/* Items */}
              {r.items.length > 0 && (
                <div className="mb-3">
                  <label className="label">{t('manual_items')}</label>
                  <div className="space-y-1.5">
                    {r.items.map((item, ii) => (
                      <div key={ii} className="flex gap-2 items-center">
                        <input type="text" className="input flex-1 !py-1.5 text-sm" value={item.name} onChange={(e) => updateMultiItem(ri, ii, 'name', e.target.value)} />
                        <input type="number" className="input w-14 !py-1.5 text-sm text-center" value={item.qty} onChange={(e) => updateMultiItem(ri, ii, 'qty', Number(e.target.value))} />
                        <input type="number" className="input w-20 !py-1.5 text-sm" value={item.price} onChange={(e) => updateMultiItem(ri, ii, 'price', Number(e.target.value))} />
                        <button onClick={() => removeMultiItem(ri, ii)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Total */}
              <div className="flex items-center justify-between py-2 border-t border-surface-200">
                <span className="text-sm font-medium text-surface-600">{t('receipt_total_label')}</span>
                <input
                  type="number" className="input w-32 !py-1.5 text-right font-bold text-surface-900"
                  value={r.total}
                  onChange={(e) => updateMultiReceipt(ri, 'total', Number(e.target.value))}
                />
              </div>
            </div>
          ))}

          {/* Action buttons */}
          <div className="flex gap-3">
            <button onClick={saveAllReceipts} disabled={saving || multiReceipts.length === 0} className="btn-primary flex-1">
              {saving ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              )}
              {saving ? t('multi_saving') : `${t('multi_save_all')} (${multiReceipts.length})`}
            </button>
            <button onClick={reset} className="btn-secondary">
              {t('receipt_cancel')}
            </button>
          </div>
        </div>
      )}

      {/* STEP: MULTI-SAVED */}
      {step === STEPS.MULTI_SAVED && (
        <div className="animate-slide-up text-center">
          <div className="card p-10">
            <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-surface-900 mb-2">{t('multi_saved_success')}</h2>
            <p className="text-sm text-surface-500 mb-6">{t('receipt_saved_desc')}</p>
            <div className="flex gap-3 justify-center flex-wrap">
              <button onClick={reset} className="btn-primary">
                {t('receipt_scan_new')}
              </button>
              <button onClick={() => navigate('/dashboard')} className="btn-secondary">
                {t('nav_dashboard')}
              </button>
              <button onClick={() => navigate('/insights')} className="btn-ghost text-brand-600">
                {t('nav_insights')} &rarr;
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
