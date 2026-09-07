import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageContext';
import { api } from '../lib/api';
import { SalesExpenseChart, ExpenseCategoryChart } from '../components/Charts';
import { TransactionItem, StatCard } from '../components/TransactionCard';

export default function Dashboard() {
  const { t } = useLanguage();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    try {
      setLoading(true);
      const d = await api.getDashboard();
      setData(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const hasData = data && data.txCount > 0;
  const hasSeed = data?.recent?.some(r => r.source === 'seed_demo');

  return (
    <div className="page-container">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="page-title !mb-1">{t('dash_title')}</h1>
          {hasSeed && (
            <span className="badge-demo text-xs">{t('dash_demo_label')}</span>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link to="/scan" className="btn-primary text-sm !py-2 !px-4">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
            </svg>
            {t('nav_scan')}
          </Link>
          <Link to="/voice" className="btn-secondary text-sm !py-2 !px-4">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
            </svg>
            {t('nav_voice')}
          </Link>
          <Link to="/add" className="btn-secondary text-sm !py-2 !px-4">
            {t('tx_add')}
          </Link>
        </div>
      </div>

      {!hasData ? (
        <div className="card p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-surface-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-surface-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          </div>
          <p className="text-surface-500">{t('dash_no_data')}</p>
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard
              label={t('dash_total_sales')}
              value={data.totalSales}
              color="emerald"
              icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" /></svg>}
            />
            <StatCard
              label={t('dash_total_expenses')}
              value={data.totalExpenses}
              color="red"
              icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6L9 12.75l4.286-4.286a11.948 11.948 0 014.306 6.43l.776 2.898m0 0l3.182-5.511m-3.182 5.51l-5.511-3.181" /></svg>}
            />
            <StatCard
              label={data.profit >= 0 ? t('dash_profit') : t('dash_loss')}
              value={Math.abs(data.profit)}
              color={data.profit >= 0 ? 'brand' : 'amber'}
              icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
            />
            <StatCard
              label={t('dash_transactions')}
              value={data.txCount}
              color="blue"
              prefix=""
              icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>}
            />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <SalesExpenseChart monthly={data.monthly || []} />
            <ExpenseCategoryChart categories={data.expenseByCategory || []} />
          </div>

          {/* Recent Transactions */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-surface-800">{t('dash_recent')}</h3>
              <Link to="/transactions" className="text-sm font-medium text-brand-600 hover:text-brand-700">
                {t('nav_transactions')} &rarr;
              </Link>
            </div>
            <div className="space-y-3">
              {data.recent.map(tx => (
                <TransactionItem key={tx.id} tx={tx} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="page-container">
      <div className="animate-pulse space-y-6">
        <div className="h-8 w-48 bg-surface-200 rounded-lg" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-surface-200 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-72 bg-surface-200 rounded-xl" />
          <div className="h-72 bg-surface-200 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }) {
  const { t } = useLanguage();
  return (
    <div className="page-container">
      <div className="card p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-3">
          <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <p className="text-surface-600 mb-4">{message}</p>
        <button onClick={onRetry} className="btn-primary text-sm">{t('receipt_try_again')}</button>
      </div>
    </div>
  );
}
