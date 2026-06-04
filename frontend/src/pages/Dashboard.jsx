import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Area, AreaChart } from 'recharts';

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
    Promise.all([
      fetch(`/api/dashboard/summary?${params}`).then(r => r.json()),
      fetch('/api/dashboard/monthly-comparison').then(r => r.json()),
      fetch(`/api/dashboard/top-merchants?${params}`).then(r => r.json()),
      fetch(`/api/dashboard/source-breakdown?${params}`).then(r => r.json()),
      fetch('/api/settings/sync-schedule').then(r => r.json()),
    ]).then(([s, c, m, b, sc]) => {
      setSummary(s);
      setComparison(c);
      setTopMerchants(m);
      setSourceBreakdown(b);
      setSyncSchedule(sc);
    });
  }, [month, year]);

  if (!summary) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="relative">
          <div className="w-12 h-12 border-3 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
          <div className="absolute inset-0 w-12 h-12 rounded-full animate-pulse" style={{ background: 'var(--accent)', opacity: 0.1 }} />
        </div>
      </div>
    );
  }

  const monthLabel = new Date(year, month - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
  const totalDebit = summary.total_spend || 0;
  const totalCredit = (summary.total_credit || 0) + (summary.voucher_refunds || 0);
  const othersShare = (summary.card_others_share || 0) + (summary.voucher_others_share || 0);
  const netSpend = totalDebit - totalCredit - othersShare;

  const container = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.06 } },
  };
  const item = {
    hidden: { opacity: 0, y: 16 },
    show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 260, damping: 22 } },
  };

  return (
    <motion.div className="space-y-6 pb-6" variants={container} initial="hidden" animate="show">
      {/* Header */}
      <motion.div variants={item} className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            {getGreeting()} 👋
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Here's your spending summary for <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>{monthLabel}</span>
          </p>
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

      {/* Sync Schedule Chip */}
      {syncSchedule && (syncSchedule.statement_sync.enabled || syncSchedule.amazon_pay_sync.enabled) && (
        <motion.div variants={item} className="flex items-center gap-3 flex-wrap px-4 py-2.5 rounded-xl text-[11px]" style={{ background: 'var(--card)', border: '1px solid var(--border)', backdropFilter: 'blur(8px)' }}>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--success)' }} />
            <span className="font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Next Sync</span>
          </div>
          {syncSchedule.statement_sync.enabled && (
            <span className="px-2 py-0.5 rounded-md" style={{ background: 'var(--purple-soft, rgba(139,92,246,0.1))', color: 'var(--purple, #8b5cf6)' }}>
              Statements · {new Date(syncSchedule.statement_sync.next_at).toLocaleString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, day: 'numeric', month: 'short' })}
            </span>
          )}
          {syncSchedule.amazon_pay_sync.enabled && (
            <span className="px-2 py-0.5 rounded-md" style={{ background: 'rgba(245,158,11,0.1)', color: '#d97706' }}>
              Amazon Pay · {new Date(syncSchedule.amazon_pay_sync.next_at).toLocaleString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, day: 'numeric', month: 'short' })}
            </span>
          )}
        </motion.div>
      )}

      {/* KPI Cards */}
      <motion.div variants={item} className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          label="Total Debit"
          value={totalDebit}
          subtitle={`Cards: ${formatCurrency(summary.direct_spend || 0)} · AP: ${formatCurrency(summary.voucher_spend || 0)}`}
          color="#ef4444"
          gradient="linear-gradient(135deg, rgba(239,68,68,0.12) 0%, rgba(239,68,68,0.03) 100%)"
          borderColor="rgba(239,68,68,0.2)"
          icon="↗"
        />
        <KPICard
          label="Total Credit"
          value={totalCredit}
          subtitle={`Cards: ${formatCurrency(summary.total_credit || 0)} · AP: ${formatCurrency(summary.voucher_refunds || 0)}`}
          color="#22c55e"
          gradient="linear-gradient(135deg, rgba(34,197,94,0.12) 0%, rgba(34,197,94,0.03) 100%)"
          borderColor="rgba(34,197,94,0.2)"
          icon="↙"
        />
        <KPICard
          label="Others Share"
          value={othersShare}
          subtitle={`Cards: ${formatCurrency(summary.card_others_share || 0)} · AP: ${formatCurrency(summary.voucher_others_share || 0)}`}
          color="#d97706"
          gradient="linear-gradient(135deg, rgba(245,158,11,0.12) 0%, rgba(245,158,11,0.03) 100%)"
          borderColor="rgba(245,158,11,0.2)"
          icon="⇄"
        />
        <KPICard
          label="Net Spend"
          value={netSpend}
          subtitle="Debit − Credit − Others"
          color={netSpend > 0 ? '#ef4444' : '#22c55e'}
          gradient={netSpend > 0
            ? "linear-gradient(135deg, rgba(239,68,68,0.12) 0%, rgba(239,68,68,0.03) 100%)"
            : "linear-gradient(135deg, rgba(34,197,94,0.12) 0%, rgba(34,197,94,0.03) 100%)"}
          borderColor={netSpend > 0 ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)'}
          icon="≡"
          highlight
        />
      </motion.div>

      {/* Source Breakdown + Net Spend Ring */}
      <motion.div variants={item}>
        <div className="card p-5 rounded-2xl" style={{ border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Spend by Account</h3>
            <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
              {sourceBreakdown.length} sources
            </span>
          </div>
          {sourceBreakdown.length === 0 ? (
            <p className="text-sm py-6 text-center" style={{ color: 'var(--text-muted)' }}>No data for this month</p>
          ) : (
            <div className="space-y-3">
              {[...sourceBreakdown].sort((a, b) => (b.debit - b.credit) - (a.debit - a.credit)).map((src, i) => {
                const maxNet = Math.max(...sourceBreakdown.map(s => s.debit - s.credit));
                const net = src.debit - src.credit;
                const pct = maxNet > 0 ? (net / maxNet) * 100 : 0;
                return (
                  <motion.div key={i} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06, type: 'spring', stiffness: 200 }}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                          {(src.source || 'U')[0].toUpperCase()}
                        </div>
                        <span className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{src.source || 'Unknown'}</span>
                      </div>
                      <span className="text-xs font-bold tabular-nums" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                        {formatCurrency(net)}
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'var(--progress-bg)' }}>
                      <motion.div className="h-full rounded-full" initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.8, delay: i * 0.06, ease: [0.4, 0, 0.2, 1] }}
                        style={{ background: `linear-gradient(90deg, var(--danger) 0%, rgba(239,68,68,0.6) 100%)` }} />
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

      </motion.div>

      {/* Category Donut + Top Merchants */}
      <motion.div variants={item} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5 rounded-2xl" style={{ border: '1px solid var(--border)' }}>
          <h3 className="text-xs font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--text-muted)' }}>Categories</h3>
          {summary.category_breakdown.length === 0 ? (
            <p className="text-sm py-6 text-center" style={{ color: 'var(--text-muted)' }}>No data</p>
          ) : (
            <div className="flex items-center gap-5">
              <div className="w-[150px] h-[150px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={summary.category_breakdown} dataKey="total" nameKey="name"
                      cx="50%" cy="50%" innerRadius={42} outerRadius={68} paddingAngle={2}
                      animationBegin={0} animationDuration={800} animationEasing="ease-out">
                      {summary.category_breakdown.map((cat, i) => (
                        <Cell key={i} fill={cat.color || '#a8a29e'} stroke="none" />
                      ))}
                    </Pie>
                    <Tooltip content={<DonutTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-2 max-h-[150px] overflow-y-auto">
                {summary.category_breakdown.map((cat, i) => (
                  <motion.div key={i} className="flex items-center justify-between text-xs"
                    initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}>
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.color || '#a8a29e', boxShadow: `0 0 6px ${cat.color || '#a8a29e'}50` }} />
                      <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{cat.name || 'Uncategorized'}</span>
                    </div>
                    <span className="font-bold tabular-nums shrink-0 ml-2" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                      {formatCurrency(cat.total)}
                    </span>
                  </motion.div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="card p-5 rounded-2xl" style={{ border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Top Spends</h3>
            <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--danger)' }}>
              {topMerchants.length} merchants
            </span>
          </div>
          {topMerchants.length === 0 ? (
            <p className="text-sm py-6 text-center" style={{ color: 'var(--text-muted)' }}>No data</p>
          ) : (
            <div className="space-y-2.5">
              {topMerchants.slice(0, 6).map((m, i) => {
                const maxTotal = topMerchants[0]?.total || 1;
                const pct = (m.total / maxTotal) * 100;
                return (
                  <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05, type: 'spring', stiffness: 200 }}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold w-4 text-center" style={{ color: 'var(--text-muted)' }}>{i + 1}</span>
                        <span className="text-xs truncate" style={{ color: 'var(--text-secondary)', maxWidth: '60%' }}>{m.description}</span>
                      </div>
                      <span className="text-xs font-bold tabular-nums shrink-0" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                        {formatCurrency(m.total)}
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--progress-bg)' }}>
                      <motion.div className="h-full rounded-full" initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.6, delay: i * 0.05, ease: [0.4, 0, 0.2, 1] }}
                        style={{ background: `linear-gradient(90deg, var(--accent) 0%, rgba(99,102,241,0.5) 100%)` }} />
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
        <motion.div variants={item} className="card p-5 rounded-2xl" style={{ border: '1px solid var(--border)' }}>
          <h3 className="text-xs font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--text-muted)' }}>Month-over-Month</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={comparison} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--table-row-hover)', radius: 8 }} />
              <Legend wrapperStyle={{ fontSize: '0.65rem', color: 'var(--text-muted)', paddingTop: '12px' }} iconType="circle" iconSize={7} />
              <Bar dataKey="total" name="Debit" fill="var(--danger)" radius={[6, 6, 0, 0]} maxBarSize={36} />
              <Bar dataKey="credit" name="Credit" fill="var(--success)" radius={[6, 6, 0, 0]} maxBarSize={36} />
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

function KPICard({ label, value, color, gradient, borderColor, subtitle, icon, highlight }) {
  return (
    <motion.div
      className="relative overflow-hidden rounded-xl p-4"
      style={{ background: gradient, border: `1px solid ${borderColor}` }}
      whileHover={{ scale: 1.03, y: -2 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      {highlight && (
        <div className="absolute top-0 right-0 w-16 h-16 opacity-10" style={{ background: `radial-gradient(circle at top right, ${color}, transparent)` }} />
      )}
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</p>
        <span className="text-sm opacity-60">{icon}</span>
      </div>
      <p className="text-xl font-extrabold tabular-nums leading-none" style={{ fontFamily: 'var(--font-mono)', color }}>
        <AnimatedNumber value={value} />
      </p>
      {subtitle && <p className="text-[11px] mt-2 leading-tight font-medium" style={{ color: 'var(--text-secondary)' }}>{subtitle}</p>}
    </motion.div>
  );
}


function AnimatedNumber({ value, duration = 800 }) {
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
    <div style={{ background: 'var(--tooltip-bg)', border: '1px solid var(--border)', borderRadius: '12px', padding: '0.5rem 0.75rem', fontSize: '0.7rem', boxShadow: '0 8px 32px rgba(0,0,0,0.25)', backdropFilter: 'blur(8px)' }}>
      <div className="flex items-center gap-2">
        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: data.payload.color || '#a8a29e', boxShadow: `0 0 6px ${data.payload.color || '#a8a29e'}` }} />
        <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{data.name || 'Uncategorized'}</span>
      </div>
      <p className="mt-1" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{formatCurrency(data.value)}</p>
    </div>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const data = payload[0]?.payload;
  if (!data) return null;
  return (
    <div style={{ background: 'var(--tooltip-bg)', border: '1px solid var(--border)', borderRadius: '12px', padding: '0.6rem 0.8rem', fontSize: '0.7rem', boxShadow: '0 8px 32px rgba(0,0,0,0.25)', backdropFilter: 'blur(8px)' }}>
      <p className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>{label}</p>
      <div className="space-y-0.5">
        <p style={{ color: '#ef4444', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>↗ Debit: {formatCurrency(data.total)}</p>
        <p style={{ color: '#22c55e', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>↙ Credit: {formatCurrency(data.credit)}</p>
      </div>
    </div>
  );
}

function formatCurrency(amount) {
  if (amount == null || isNaN(amount)) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}
