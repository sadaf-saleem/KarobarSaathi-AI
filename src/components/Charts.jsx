import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell
} from 'recharts';
import { useLanguage } from '../i18n/LanguageContext';

const COLORS = ['#0E8B6E', '#F5A623', '#3B82F6', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16'];

function formatPKR(val) {
  if (val >= 1000000) return `Rs. ${(val / 1000000).toFixed(1)}M`;
  if (val >= 1000) return `Rs. ${(val / 1000).toFixed(1)}K`;
  return `Rs. ${val.toLocaleString()}`;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-surface-200 rounded-lg shadow-lg px-3 py-2 text-sm">
      <p className="font-medium text-surface-700 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }} className="font-medium">
          {p.name}: Rs. {p.value.toLocaleString()}
        </p>
      ))}
    </div>
  );
}

export function SalesExpenseChart({ monthly }) {
  const { t } = useLanguage();

  // Aggregate by month
  const map = {};
  monthly.forEach(m => {
    if (!map[m.month]) map[m.month] = { month: m.month };
    map[m.month][m.type === 'sale' ? 'Sales' : 'Expenses'] = m.total;
  });
  const data = Object.values(map).sort((a, b) => a.month.localeCompare(b.month));

  if (!data.length) return <EmptyChart t={t} />;

  return (
    <div className="card p-5">
      <h3 className="text-base font-semibold text-surface-800 mb-4">{t('dash_sales_vs_expenses')}</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#64748B' }} tickFormatter={v => v.slice(5)} />
            <YAxis tick={{ fontSize: 12, fill: '#64748B' }} tickFormatter={formatPKR} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Sales" fill="#0E8B6E" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Expenses" fill="#EF4444" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function ExpenseCategoryChart({ categories }) {
  const { t } = useLanguage();

  if (!categories?.length) return <EmptyChart t={t} />;

  return (
    <div className="card p-5">
      <h3 className="text-base font-semibold text-surface-800 mb-4">{t('dash_expense_categories')}</h3>
      <div className="h-64 flex items-center">
        <div className="w-1/2 h-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={categories}
                dataKey="total"
                nameKey="category"
                cx="50%"
                cy="50%"
                innerRadius={40}
                outerRadius={80}
                strokeWidth={2}
                stroke="#fff"
              >
                {categories.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(val) => `Rs. ${val.toLocaleString()}`} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="w-1/2 space-y-1.5 pl-2">
          {categories.slice(0, 6).map((c, i) => (
            <div key={c.category} className="flex items-center gap-2 text-xs">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
              <span className="text-surface-600 truncate">{c.category}</span>
              <span className="text-surface-800 font-medium ml-auto">Rs. {c.total.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EmptyChart({ t }) {
  return (
    <div className="card p-5 flex flex-col items-center justify-center h-64 text-surface-400">
      <svg className="w-8 h-8 mb-2 text-surface-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
      <span className="text-sm">{t ? t('dash_no_data') : 'No data available for chart'}</span>
    </div>
  );
}
