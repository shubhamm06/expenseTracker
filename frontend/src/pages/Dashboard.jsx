import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [comparison, setComparison] = useState([]);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.getMonth() + 1;
  });
  const [year, setYear] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.getFullYear();
  });

  useEffect(() => {
    fetch(`/api/dashboard/summary?month=${month}&year=${year}`)
      .then(r => r.json())
      .then(setSummary);
    fetch('/api/dashboard/monthly-comparison')
      .then(r => r.json())
      .then(setComparison);
  }, [month, year]);

  if (!summary) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  const monthLabel = new Date(year, month - 1).toLocaleString('default', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Monthly Overview
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{monthLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={month}
            onChange={e => setMonth(Number(e.target.value))}
            className="select-field w-auto"
          >
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {new Date(2000, i).toLocaleString('default', { month: 'long' })}
              </option>
            ))}
          </select>
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            className="select-field w-auto"
          >
            {Array.from({ length: 5 }, (_, i) => {
              const y = new Date().getFullYear() - i;
              return <option key={y} value={y}>{y}</option>;
            })}
          </select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          label="Total Debit"
          value={formatCurrency(summary.total_spend)}
          icon={<CardIcon />}
          color="var(--danger)"
          bg="var(--danger-soft)"
          tooltip="All debits: card/bank spends + Amazon Pay usage (excludes friend expenses)"
        />
        <SummaryCard
          label="Total Credit"
          value={formatCurrency(summary.total_credit)}
          icon={<CreditIcon />}
          color="var(--success)"
          bg="var(--success-soft)"
          tooltip="All credits/refunds received in your bank/card statements"
        />
        <SummaryCard
          label="My Card Spends"
          value={formatCurrency(summary.direct_spend)}
          icon={<TotalIcon />}
          color="var(--text-primary)"
          bg="var(--empty-icon-bg)"
          tooltip="Your credit/debit card spends only, excluding Amazon Pay voucher purchases and friend expenses"
        />
        <SummaryCard
          label="Amazon Pay Usage"
          value={formatCurrency(summary.voucher_spend)}
          icon={<VoucherUsageIcon />}
          color="var(--purple)"
          bg="var(--purple-soft)"
          tooltip="Net Amazon Pay balance used this month (spends minus refunds)"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard
          label="Not My Expenses"
          value={formatCurrency(summary.reimbursable_total)}
          icon={<ReimbIcon />}
          color="var(--amber)"
          bg="var(--amber-soft)"
          small
          tooltip="Transactions marked as friend/shared expenses — excluded from all totals"
        />
        <SummaryCard
          label="Net Spend"
          value={formatCurrency((summary.total_spend || 0) - (summary.total_credit || 0))}
          icon={<EffectiveIcon />}
          color={((summary.total_spend || 0) - (summary.total_credit || 0)) > 0 ? 'var(--danger)' : 'var(--success)'}
          bg={((summary.total_spend || 0) - (summary.total_credit || 0)) > 0 ? 'var(--danger-soft)' : 'var(--success-soft)'}
          small
          tooltip="Total Debit minus Total Credit — your actual outflow this month"
        />
      </div>

      {/* Category Breakdown */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--text-muted)' }}>
          Category Breakdown
        </h2>
        {summary.category_breakdown.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No transactions this month</p>
        ) : (
          <div className="space-y-3">
            {summary.category_breakdown.map((cat, i) => {
              const maxAmount = Math.max(...summary.category_breakdown.map(c => c.total));
              const pct = maxAmount > 0 ? (cat.total / maxAmount) * 100 : 0;
              return (
                <div key={i} className="animate-slide-in" style={{ animationDelay: `${i * 50}ms` }}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat.color || '#a8a29e' }} />
                      <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {cat.name || 'Uncategorized'}
                      </span>
                    </div>
                    <span className="text-sm font-semibold tabular-nums" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                      {formatCurrency(cat.total)}
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--progress-bg)' }}>
                    <div
                      className="h-full rounded-full transition-all duration-700 ease-out"
                      style={{ width: `${pct}%`, backgroundColor: cat.color || '#a8a29e' }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Monthly Comparison Chart */}
      {comparison.length > 0 && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--text-muted)' }}>
            Month-over-Month
          </h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={comparison} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={v => `${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                content={<ChartTooltip />}
                cursor={{ fill: 'var(--table-row-hover)' }}
              />
              <Legend
                wrapperStyle={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}
                iconType="circle"
                iconSize={8}
              />
              <Bar dataKey="total" name="Debit" fill="var(--danger)" radius={[4, 4, 0, 0]} maxBarSize={36} />
              <Bar dataKey="credit" name="Credit" fill="var(--success)" radius={[4, 4, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const data = payload[0]?.payload;
  if (!data) return null;
  return (
    <div style={{
      background: 'var(--tooltip-bg)',
      border: '1px solid var(--border)',
      borderRadius: '0.5rem',
      padding: '0.5rem 0.75rem',
      fontSize: '0.75rem',
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
    }}>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>{label}</p>
      <p style={{ color: 'var(--danger)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
        Debit: {formatCurrency(data.total)}
      </p>
      <p style={{ color: 'var(--success)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
        Credit: {formatCurrency(data.credit)}
      </p>
    </div>
  );
}

function SummaryCard({ label, value, icon, color, bg, small, subtitle, tooltip }) {
  return (
    <div className="card p-4 flex items-start gap-3" title={tooltip}>
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: bg }}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{label}</p>
        <p className={`font-bold tabular-nums mt-0.5 ${small ? 'text-base' : 'text-lg'}`} style={{ fontFamily: 'var(--font-mono)', color }}>
          {value}
        </p>
        {subtitle && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{subtitle}</p>}
      </div>
    </div>
  );
}

function TotalIcon() {
  return <svg className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" /></svg>;
}

function CardIcon() {
  return <svg className="w-4 h-4" style={{ color: 'var(--danger)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" /></svg>;
}

function CreditIcon() {
  return <svg className="w-4 h-4" style={{ color: 'var(--success)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>;
}

function VoucherUsageIcon() {
  return <svg className="w-4 h-4" style={{ color: 'var(--purple)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 11.25v8.25a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 1 0 9.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1 1 14.625 7.5H12m0 0V21m-8.625-9.75h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>;
}

function ReimbIcon() {
  return <svg className="w-4 h-4" style={{ color: 'var(--amber)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" /></svg>;
}

function EffectiveIcon() {
  return <svg className="w-4 h-4" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0 0 12 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52 2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 0 1-2.031.352 5.988 5.988 0 0 1-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.971Zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0 2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 0 1-2.031.352 5.989 5.989 0 0 1-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.971Z" /></svg>;
}

function formatCurrency(amount) {
  if (amount == null || isNaN(amount)) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}
