import { useLanguage } from '../i18n/LanguageContext';

export function TransactionItem({ tx, onDelete, onEdit }) {
  const { t, lang } = useLanguage();
  const isSale = tx.type === 'sale';
  const dateStr = new Date(tx.date).toLocaleDateString(lang === 'ur' ? 'ur-PK' : 'en-PK', {
    day: 'numeric', month: 'short', year: 'numeric'
  });

  const sourceLabel = tx.source === 'receipt_scan'
    ? t('tx_source_receipt')
    : tx.source === 'seed_demo'
    ? t('tx_source_seed')
    : tx.source === 'voice'
    ? t('tx_source_voice')
    : t('tx_source_manual');

  return (
    <div className="card-hover p-4 flex items-start gap-4 animate-fade-in">
      {/* Icon */}
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
        isSale ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
      }`}>
        {isSale ? (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6L9 12.75l4.286-4.286a11.948 11.948 0 014.306 6.43l.776 2.898m0 0l3.182-5.511m-3.182 5.51l-5.511-3.181" />
          </svg>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-surface-800 text-sm">{tx.description || tx.category}</span>
          <span className={isSale ? 'badge-sale' : 'badge-expense'}>
            {isSale ? t('receipt_type_sale') : t('receipt_type_expense')}
          </span>
          {tx.source === 'seed_demo' && <span className="badge-demo">{sourceLabel}</span>}
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-surface-500">
          <span>{dateStr}</span>
          <span>{tx.category}</span>
          {tx.vendor && <span>{tx.vendor}</span>}
          <span>{sourceLabel}</span>
        </div>
        {/* Items */}
        {Array.isArray(tx.items) && tx.items.length > 0 && (
          <div className="mt-2 text-xs text-surface-500">
            {tx.items.map((item, i) => (
              <span key={i} className="inline-block bg-surface-100 rounded px-2 py-0.5 mr-1.5 mb-1">
                {item.name}{item.qty > 1 ? ` x${item.qty}` : ''}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Amount & Actions */}
      <div className="text-right shrink-0">
        <div className={`font-bold text-base ${isSale ? 'text-emerald-600' : 'text-red-600'}`}>
          {isSale ? '+' : '-'} Rs. {tx.amount.toLocaleString()}
        </div>
        <div className="flex items-center gap-1 mt-2 justify-end">
          {onEdit && (
            <button onClick={() => onEdit(tx)} className="btn-ghost !px-2 !py-1 text-xs">
              {t('tx_edit')}
            </button>
          )}
          {onDelete && (
            <button onClick={() => onDelete(tx.id)} className="btn-ghost !px-2 !py-1 text-xs text-red-500 hover:text-red-700 hover:bg-red-50">
              {t('tx_delete')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function StatCard({ label, value, icon, color = 'brand', prefix = 'Rs. ' }) {
  const colors = {
    brand: 'bg-brand-50 text-brand-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    red: 'bg-red-50 text-red-600',
    blue: 'bg-blue-50 text-blue-600',
    amber: 'bg-amber-50 text-amber-600'
  };

  return (
    <div className="stat-card">
      <div className="flex items-center justify-between">
        <span className="stat-label">{label}</span>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${colors[color] || colors.brand}`}>
          {icon}
        </div>
      </div>
      <span className="stat-value">
        {prefix}{typeof value === 'number' ? value.toLocaleString() : value}
      </span>
    </div>
  );
}
