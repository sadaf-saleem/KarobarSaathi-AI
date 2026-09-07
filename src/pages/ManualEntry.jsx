import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageContext';
import { api } from '../lib/api';

export default function ManualEntry() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [categories, setCategories] = useState({ sale: [], expense: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [form, setForm] = useState({
    type: 'expense',
    date: new Date().toISOString().split('T')[0],
    category: '',
    amount: '',
    description: '',
    vendor: '',
    items: [{ name: '', qty: 1, price: 0 }]
  });

  useEffect(() => {
    api.getCategories().then(setCategories).catch(() => {});
  }, []);

  const cats = form.type === 'sale' ? categories.sale : categories.expense;

  const updateItem = (idx, field, value) => {
    setForm(prev => {
      const items = [...prev.items];
      items[idx] = { ...items[idx], [field]: value };
      return { ...prev, items };
    });
  };

  const addItem = () => {
    setForm(prev => ({ ...prev, items: [...prev.items, { name: '', qty: 1, price: 0 }] }));
  };

  const removeItem = (idx) => {
    setForm(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }));
  };

  const calcTotal = () => {
    return form.items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const total = form.amount ? Number(form.amount) : calcTotal();
      if (!total || total <= 0) throw new Error('Please enter a valid amount');
      if (!form.category) throw new Error('Please select a category');

      await api.createTransaction({
        date: form.date,
        type: form.type,
        category: form.category,
        amount: total,
        description: form.description,
        vendor: form.vendor,
        items: form.items.filter(i => i.name),
        source: 'manual'
      });
      setSuccess(true);
      setTimeout(() => navigate('/dashboard'), 1500);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (success) {
    return (
      <div className="page-container max-w-2xl">
        <div className="card p-10 text-center animate-slide-up">
          <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-surface-900">{t('manual_success')}</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container max-w-2xl">
      <h1 className="page-title">{t('manual_title')}</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-6 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="card p-6 space-y-5">
        {/* Type Toggle */}
        <div>
          <label className="label">{t('manual_type')}</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setForm(p => ({ ...p, type: 'sale', category: '' }))}
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                form.type === 'sale'
                  ? 'bg-emerald-500 text-white shadow-sm'
                  : 'bg-surface-100 text-surface-600 hover:bg-surface-200'
              }`}
            >
              {t('receipt_type_sale')}
            </button>
            <button
              type="button"
              onClick={() => setForm(p => ({ ...p, type: 'expense', category: '' }))}
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                form.type === 'expense'
                  ? 'bg-red-500 text-white shadow-sm'
                  : 'bg-surface-100 text-surface-600 hover:bg-surface-200'
              }`}
            >
              {t('receipt_type_expense')}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">{t('manual_date')}</label>
            <input type="date" className="input" value={form.date} onChange={(e) => setForm(p => ({...p, date: e.target.value}))} required />
          </div>
          <div>
            <label className="label">{t('manual_category')}</label>
            <select className="select" value={form.category} onChange={(e) => setForm(p => ({...p, category: e.target.value}))} required>
              <option value="">{t('manual_select_category')}</option>
              {cats.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label">{t('manual_amount')}</label>
            <input
              type="number" className="input" placeholder="0"
              value={form.amount}
              onChange={(e) => setForm(p => ({...p, amount: e.target.value}))}
            />
          </div>
          <div>
            <label className="label">{t('manual_vendor')}</label>
            <input
              type="text" className="input" placeholder={t('manual_optional')}
              value={form.vendor}
              onChange={(e) => setForm(p => ({...p, vendor: e.target.value}))}
            />
          </div>
        </div>

        <div>
          <label className="label">{t('manual_description')}</label>
          <input
            type="text" className="input" placeholder={t('manual_desc_placeholder')}
            value={form.description}
            onChange={(e) => setForm(p => ({...p, description: e.target.value}))}
          />
        </div>

        {/* Items */}
        <div>
          <label className="label">{t('manual_items')}</label>
          <div className="space-y-2">
            {form.items.map((item, i) => (
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
                {form.items.length > 1 && (
                  <button type="button" onClick={() => removeItem(i)} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
          <button type="button" onClick={addItem} className="btn-ghost text-sm mt-2 !px-3 !py-1.5 text-brand-600">
            {t('manual_add_item')}
          </button>
          {calcTotal() > 0 && (
            <p className="text-sm text-surface-600 mt-2">
              {t('manual_items_total')}: <span className="font-bold">Rs. {calcTotal().toLocaleString()}</span>
            </p>
          )}
        </div>

        <button type="submit" disabled={saving} className="btn-primary w-full">
          {saving ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          )}
          {t('manual_submit')}
        </button>
      </form>
    </div>
  );
}
