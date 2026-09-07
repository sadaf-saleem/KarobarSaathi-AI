import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { api } from '../lib/api';
import { TransactionItem } from '../components/TransactionCard';

export default function Transactions() {
  const { t } = useLanguage();
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState(null);
  const [categories, setCategories] = useState({ sale: [], expense: [] });
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const params = {};
      if (filter === 'sales') params.type = 'sale';
      if (filter === 'expenses') params.type = 'expense';
      const data = await api.getTransactions(params);
      setTransactions(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.getCategories().then(setCategories).catch(() => {});
  }, []);

  const handleDelete = async (id) => {
    if (!window.confirm(t('tx_delete_confirm'))) return;
    try {
      await api.deleteTransaction(id);
      setTransactions(prev => prev.filter(tx => tx.id !== id));
    } catch (e) {
      setError(e.message || 'Failed to delete transaction.');
    }
  };

  const startEdit = (tx) => {
    setEditingId(tx.id);
    setEditData({ ...tx, items: Array.isArray(tx.items) ? tx.items : [] });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditData(null);
  };

  const saveEdit = async () => {
    if (!editData) return;
    try {
      const updated = await api.updateTransaction(editData.id, {
        date: editData.date,
        type: editData.type,
        category: editData.category,
        amount: editData.amount,
        description: editData.description,
        vendor: editData.vendor,
        items: editData.items
      });
      setTransactions(prev => prev.map(tx => tx.id === updated.id ? updated : tx));
      cancelEdit();
    } catch (e) {
      setError(e.message || 'Failed to save changes.');
    }
  };

  const filters = [
    { key: 'all', label: t('tx_filter_all') },
    { key: 'sales', label: t('tx_filter_sales') },
    { key: 'expenses', label: t('tx_filter_expenses') }
  ];

  return (
    <div className="page-container">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="page-title !mb-0">{t('tx_title')}</h1>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 mb-6 bg-surface-100 p-1 rounded-lg w-fit">
        {filters.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              filter === f.key
                ? 'bg-white text-surface-800 shadow-sm'
                : 'text-surface-500 hover:text-surface-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[...Array(5)].map((_, i) => <div key={i} className="h-20 bg-surface-200 rounded-xl" />)}
        </div>
      ) : transactions.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="w-14 h-14 rounded-full bg-surface-100 flex items-center justify-center mx-auto mb-3">
            <svg className="w-7 h-7 text-surface-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12H9.75m3 0h.008v.008H12.75v-.008zM12 15h.008v.008H12V15zm-3 0h.008v.008H9V15zm0-3h.008v.008H9V12zm0-3h.008v.008H9V9z" />
            </svg>
          </div>
          <p className="text-surface-500">{t('tx_empty')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {transactions.map(tx => (
            editingId === tx.id && editData ? (
              <EditForm
                key={tx.id}
                data={editData}
                categories={categories}
                onChange={setEditData}
                onSave={saveEdit}
                onCancel={cancelEdit}
                t={t}
              />
            ) : (
              <TransactionItem
                key={tx.id}
                tx={tx}
                onDelete={handleDelete}
                onEdit={startEdit}
              />
            )
          ))}
        </div>
      )}
    </div>
  );
}

function EditForm({ data, categories, onChange, onSave, onCancel, t }) {
  const cats = data.type === 'sale' ? categories.sale : categories.expense;

  return (
    <div className="card p-5 animate-fade-in border-brand-200">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div>
          <label className="label">{t('manual_type')}</label>
          <select className="select" value={data.type} onChange={(e) => onChange(p => ({...p, type: e.target.value, category: ''}))}>
            <option value="sale">{t('receipt_type_sale')}</option>
            <option value="expense">{t('receipt_type_expense')}</option>
          </select>
        </div>
        <div>
          <label className="label">{t('manual_date')}</label>
          <input type="date" className="input" value={data.date} onChange={(e) => onChange(p => ({...p, date: e.target.value}))} />
        </div>
        <div>
          <label className="label">{t('manual_category')}</label>
          <select className="select" value={data.category} onChange={(e) => onChange(p => ({...p, category: e.target.value}))}>
            <option value="">{t('edit_select')}</option>
            {cats.map(c => <option key={c} value={c}>{c}</option>)}
            <option value="__custom">{t('edit_custom')}</option>
          </select>
          {data.category && !cats.includes(data.category) && data.category !== '' && (
            <input type="text" className="input mt-1" value={data.category} onChange={(e) => onChange(p => ({...p, category: e.target.value}))} />
          )}
        </div>
        <div>
          <label className="label">{t('manual_amount')}</label>
          <input type="number" className="input" value={data.amount} onChange={(e) => onChange(p => ({...p, amount: Number(e.target.value)}))} />
        </div>
        <div>
          <label className="label">{t('manual_vendor')}</label>
          <input type="text" className="input" value={data.vendor || ''} onChange={(e) => onChange(p => ({...p, vendor: e.target.value}))} />
        </div>
        <div>
          <label className="label">{t('manual_description')}</label>
          <input type="text" className="input" value={data.description || ''} onChange={(e) => onChange(p => ({...p, description: e.target.value}))} />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onSave} className="btn-primary text-sm !py-2 !px-4">{t('tx_save')}</button>
        <button onClick={onCancel} className="btn-secondary text-sm !py-2 !px-4">{t('receipt_cancel')}</button>
      </div>
    </div>
  );
}
