import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [comparison, setComparison] = useState([]);
  const [topMerchants, setTopMerchants] = useState([]);
  const [sourceBreakdown, setSourceBreakdown] = useState([]);
  const [syncSchedule, setSyncSchedule] = useState(null);
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
    const params = `month=${month}&year=${year}`;
    fetch(`/api/dashboard/summary?${params}`).then(r => r.json()).then(setSummary);
    fetch('/api/dashboard/monthly-comparison').then(r => r.json()).then(setComparison);
    fetch(`/api/dashboard/top-merchants?${params}`).then(r => r.json()).then(setTopMerchants);
    fetch(`/api/dashboard/source-breakdown?${params}`).then(r => r.json()).then(setSourceBreakdown);
    fetch('/api/settings/sync-schedule').then(r => r.json()).then(setSyncSchedule);
  }, [month, year]);

  if (!summary) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="relative">
          <div className="w-10 h-10 border-3 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        </div>
      </div>
    );
  }

  const monthLabel = new Date(year, month - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
  const netSpend = (summary.total_spend || 0) - (summary.total_credit || 0);

  const container = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.04 } },
  };
  const item = {
    hidden: { opacity: 0, y: 12 },
    show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } },
  };

  return (
    <motion.div className="space-y-5" variants={container} initial="hidden" animate="show">
      {/* Header Row */}
      <motion.div variants={item} className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            {getGreeting()}
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{monthLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className="select-field w-auto text-xs">
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>{new Date(2000, i).toLocaleString('default', { month: 'short' })}</option>
            ))}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="select-field w-auto text-xs">
            {Array.from({ length: 5 }, (_, i) => {
              const y = new Date().getFullYear() - i;
              return <option key={y} value={y}>{y}</option>;
            })}
          </select>
        </div>
      </motion.div>

      {/* Sync Schedule */}
      {syncSchedule && (syncSchedule.statement_sync.enabled || syncSchedule.amazon_pay_sync.enabled) && (
        <motion.div variants={item} className="flex items-center gap-3 flex-wrap px-3 py-2 rounded-lg text-[11px]" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
          <svg className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          {syncSchedule.statement_sync.enabled && (
            <span style={{ color: 'var(--text-secondary)' }}>
              <span className="font-semibold" style={{ color: 'var(--purple)' }}>Statements</span>{' '}
              {new Date(syncSchedule.statement_sync.next_at).toLocaleString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, day: 'numeric', month: 'short' })}
            </span>
          )}
          {syncSchedule.amazon_pay_sync.enabled && (
            <span style={{ color: 'var(--text-secondary)' }}>
              <span className="font-semibold" style={{ color: 'var(--amber)' }}>Amazon Pay</span>{' '}
              {new Date(syncSchedule.amazon_pay_sync.next_at).toLocaleString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, day: 'numeric', month: 'short' })}
            </span>
          )}
        </motion.div>
      )}

      {/* KPI Banner */}
      <motion.div variants={item} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KPICard label="Total Debit" value={summary.total_spend} color="var(--danger)" />
        <KPICard label="Amazon Pay" value={summary.voucher_spend} color="var(--purple)" />
        <KPICard label="Total Credit" value={summary.total_credit} color="var(--success)" />
        <KPICard label="Net Spend" value={netSpend} color={netSpend > 0 ? 'var(--danger)' : 'var(--success)'} />
        <KPICard label="Not Mine" value={summary.reimbursable_total} color="var(--amber)" />
      </motion.div>



      {/* Row: Source Breakdown + Net Spend Ring */}
      <motion.div variants={item} className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Per-Source / Per-Card Breakdown */}
        <div className="card p-4 lg:col-span-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Spend by Account</h3>
          {sourceBreakdown.length === 0 ? (
            <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>No data</p>
          ) : (
            <div className="space-y-2.5">
              {[...sourceBreakdown].sort((a, b) => (b.debit - b.credit) - (a.debit - a.credit)).map((src, i) => {
                const maxNet = Math.max(...sourceBreakdown.map(s => s.debit - s.credit));
                const net = src.debit - src.credit;
                const pct = maxNet > 0 ? (net / maxNet) * 100 : 0;
                return (
                  <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{src.source || 'Unknown'}</span>
                      <span className="text-xs font-semibold tabular-nums" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                        {formatCurrency(src.debit - src.credit)}
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--progress-bg)' }}>
                      <motion.div className="h-full rounded-full" initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.6, delay: i * 0.05 }} style={{ background: 'var(--danger)' }} />
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        {/* Net Spend Ring */}
        <NetSpendCard netSpend={netSpend} totalSpend={summary.total_spend || 1} />
      </motion.div>

      {/* Row: Category Donut + Top Merchants */}
      <motion.div variants={item} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Category Donut */}
        <div className="card p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Categories</h3>
          {summary.category_breakdown.length === 0 ? (
            <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>No data</p>
          ) : (
            <div className="flex items-center gap-4">
              <div className="w-[140px] h-[140px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={summary.category_breakdown} dataKey="total" nameKey="name"
                      cx="50%" cy="50%" innerRadius={40} outerRadius={65} paddingAngle={2}
                      animationBegin={0} animationDuration={600}>
                      {summary.category_breakdown.map((cat, i) => (
                        <Cell key={i} fill={cat.color || '#a8a29e'} stroke="none" />
                      ))}
                    </Pie>
                    <Tooltip content={<DonutTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-1.5">
                {summary.category_breakdown.map((cat, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color || '#a8a29e' }} />
                      <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{cat.name || 'Uncategorized'}</span>
                    </div>
                    <span className="font-semibold tabular-nums shrink-0 ml-2" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                      {formatCurrency(cat.total)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Top Merchants */}
        <div className="card p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Top Spends</h3>
          {topMerchants.length === 0 ? (
            <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>No data</p>
          ) : (
            <div className="space-y-2">
              {topMerchants.slice(0, 6).map((m, i) => {
                const maxTotal = topMerchants[0]?.total || 1;
                const pct = (m.total / maxTotal) * 100;
                return (
                  <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs truncate pr-2" style={{ color: 'var(--text-secondary)', maxWidth: '70%' }}>{m.description}</span>
                      <span className="text-xs font-semibold tabular-nums shrink-0" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                        {formatCurrency(m.total)}
                      </span>
                    </div>
                    <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: 'var(--progress-bg)' }}>
                      <motion.div className="h-full rounded-full" initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.5, delay: i * 0.04 }} style={{ background: 'var(--accent)' }} />
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>

      {/* Month-over-Month Chart */}
      {comparison.length > 0 && (
        <motion.div variants={item} className="card p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Month-over-Month</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={comparison} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--table-row-hover)' }} />
              <Legend wrapperStyle={{ fontSize: '0.65rem', color: 'var(--text-muted)' }} iconType="circle" iconSize={6} />
              <Bar dataKey="total" name="Debit" fill="var(--danger)" radius={[4, 4, 0, 0]} maxBarSize={32} />
              <Bar dataKey="credit" name="Credit" fill="var(--success)" radius={[4, 4, 0, 0]} maxBarSize={32} />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      )}
    </motion.div>
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function KPICard({ label, value, color }) {
  return (
    <motion.div className="card p-3" whileHover={{ scale: 1.02 }} transition={{ type: 'spring', stiffness: 400, damping: 25 }}>
      <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-lg font-bold tabular-nums" style={{ fontFamily: 'var(--font-mono)', color }}>
        <AnimatedNumber value={value} />
      </p>
    </motion.div>
  );
}

function NetSpendCard({ netSpend, totalSpend }) {
  const ratio = Math.min(Math.abs(netSpend) / totalSpend, 1);
  const circumference = 2 * Math.PI * 40;
  const strokeDashoffset = circumference * (1 - ratio);
  const color = netSpend > 0 ? 'var(--danger)' : 'var(--success)';

  return (
    <div className="card p-4 flex flex-col items-center justify-center">
      <div className="relative w-24 h-24">
        <svg width="96" height="96" viewBox="0 0 96 96">
          <circle cx="48" cy="48" r="40" fill="none" stroke="var(--progress-bg)" strokeWidth="7" />
          <motion.circle cx="48" cy="48" r="40" fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
            strokeDasharray={circumference} initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }} transition={{ duration: 1, ease: [0.4, 0, 0.2, 1] }}
            transform="rotate(-90 48 48)" style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold tabular-nums" style={{ color }}>{Math.round(ratio * 100)}%</span>
        </div>
      </div>
      <p className="text-[10px] font-semibold uppercase tracking-wider mt-2" style={{ color: 'var(--text-muted)' }}>
        {netSpend > 0 ? 'Outflow' : 'Inflow'}
      </p>
      <p className="text-base font-bold tabular-nums" style={{ fontFamily: 'var(--font-mono)', color }}>
        <AnimatedNumber value={Math.abs(netSpend)} />
      </p>
    </div>
  );
}

function AnimatedNumber({ value, duration = 700 }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef(null);
  const startTime = useRef(null);
  const startValue = useRef(0);

  useEffect(() => {
    if (value == null || isNaN(value)) return;
    startValue.current = display;
    startTime.current = performance.now();
    function animate(now) {
      const elapsed = now - startTime.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(startValue.current + (value - startValue.current) * eased));
      if (progress < 1) ref.current = requestAnimationFrame(animate);
    }
    ref.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(ref.current);
  }, [value]);

  return formatCurrency(display);
}

function DonutTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const data = payload[0];
  return (
    <div style={{ background: 'var(--tooltip-bg)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.4rem 0.6rem', fontSize: '0.7rem', boxShadow: '0 4px 16px rgba(0,0,0,0.2)' }}>
      <div className="flex items-center gap-1.5">
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: data.payload.color || '#a8a29e' }} />
        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{data.name || 'Uncategorized'}</span>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>{formatCurrency(data.value)}</p>
    </div>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const data = payload[0]?.payload;
  if (!data) return null;
  return (
    <div style={{ background: 'var(--tooltip-bg)', border: '1px solid var(--border)', borderRadius: '10px', padding: '0.5rem 0.7rem', fontSize: '0.7rem', boxShadow: '0 4px 16px rgba(0,0,0,0.2)' }}>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '2px', fontWeight: 600 }}>{label}</p>
      <p style={{ color: 'var(--danger)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>Debit: {formatCurrency(data.total)}</p>
      <p style={{ color: 'var(--success)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>Credit: {formatCurrency(data.credit)}</p>
    </div>
  );
}

function formatCurrency(amount) {
  if (amount == null || isNaN(amount)) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}
