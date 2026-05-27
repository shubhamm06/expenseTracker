import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import Modal from '../components/Modal';

export default function Vouchers() {
  const [vouchers, setVouchers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedVoucher, setSelectedVoucher] = useState(null);
  const [usage, setUsage] = useState([]);
  const [topups, setTopups] = useState([]);
  const [newVoucher, setNewVoucher] = useState({ name: '', initial_amount: '', purchase_date: '' });
  const [newUsage, setNewUsage] = useState({ amount: '', date: new Date().toLocaleDateString('en-CA'), description: '', category_id: '' });
  const [newTopup, setNewTopup] = useState({ amount: '', date: new Date().toLocaleDateString('en-CA'), description: '', is_gift_card: true });
  const [showTopup, setShowTopup] = useState(false);
  const [showAddUsage, setShowAddUsage] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null);
  const [emailModal, setEmailModal] = useState(null);
  const [syncSchedule, setSyncSchedule] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [showShareToast, setShowShareToast] = useState(false);
  const [voucherTypeFilter, setVoucherTypeFilter] = useState('all');
  const [filters, setFilters] = useState({
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
  });

  useEffect(() => {
    Promise.all([
      loadVouchers(),
      fetch('/api/categories').then(r => r.json()),
      fetch('/api/settings/sync-schedule').then(r => r.json()),
      fetch('/api/vouchers/usage/auto-categorize', { method: 'POST' }),
    ]).then(([list, cats, schedule]) => {
      setCategories(cats);
      setSyncSchedule(schedule);
      if (list && list.length > 0) {
        const amazonPay = list.find(v => v.name === 'Amazon Pay Balance') || list[0];
        selectVoucher(amazonPay);
      }
    });
  }, []);

  const [quickAddModal, setQuickAddModal] = useState(null);

  useEffect(() => {
    const action = searchParams.get('action');
    if (action === 'topup' && selectedVoucher) {
      const amount = searchParams.get('amount') || '10000';
      const desc = searchParams.get('desc') || 'Gift Card';
      setQuickAddModal({
        type: 'topup',
        amount,
        description: desc,
        date: new Date().toLocaleDateString('en-CA'),
        is_gift_card: true,
      });
      setSearchParams({});
    } else if (action === 'spend' && selectedVoucher) {
      const amount = searchParams.get('amount') || '';
      const desc = searchParams.get('desc') || '';
      setQuickAddModal({
        type: 'spend',
        amount,
        description: desc,
        date: new Date().toLocaleDateString('en-CA'),
        category_id: '',
      });
      setSearchParams({});
    }
  }, [selectedVoucher, searchParams]);

  function copyQuickAddLink() {
    const baseUrl = window.location.origin + '/vouchers?action=topup';
    navigator.clipboard.writeText(baseUrl);
    setShowShareToast(true);
    setTimeout(() => setShowShareToast(false), 2500);
  }

    function loadVouchers() {
    return fetch('/api/vouchers').then(r => r.json()).then(data => { setVouchers(data); return data; });
  }

  async function createVoucher(e) {
    e.preventDefault();
    await fetch('/api/vouchers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newVoucher.name,
        initial_amount: Number(newVoucher.initial_amount),
        purchase_date: newVoucher.purchase_date,
      }),
    });
    setNewVoucher({ name: '', initial_amount: '', purchase_date: '' });
    setShowCreate(false);
    loadVouchers();
  }

  function confirmDeleteVoucher(v) {
    setConfirmModal({
      title: 'Delete Voucher',
      message: `Are you sure you want to delete "${v.name}"? All usage history and top-ups will be permanently removed.`,
      confirmLabel: 'Delete',
      onConfirm: async () => {
        await fetch(`/api/vouchers/${v.id}`, { method: 'DELETE' });
        setConfirmModal(null);
        if (selectedVoucher?.id === v.id) {
          setSelectedVoucher(null);
          setUsage([]);
          setTopups([]);
        }
        loadVouchers();
      },
    });
  }

  async function selectVoucher(v) {
    setSelectedVoucher(v);
    setShowTopup(false);
    setShowAddUsage(false);
    await loadActivity(v.id);
  }

  async function autoCategorizeUsage() {
    await fetch('/api/vouchers/usage/auto-categorize', { method: 'POST' });
  }

  async function loadActivity(voucherId) {
    const params = new URLSearchParams({ month: String(filters.month), year: String(filters.year) });
    const [usageRes, topupsRes] = await Promise.all([
      fetch(`/api/vouchers/${voucherId}/usage?${params}`),
      fetch(`/api/vouchers/${voucherId}/topups?${params}`),
    ]);
    setUsage(await usageRes.json());
    setTopups(await topupsRes.json());
  }

  useEffect(() => {
    if (selectedVoucher) loadActivity(selectedVoucher.id);
  }, [filters]);

  function updateUsageCategory(usageId, categoryId) {
    fetch(`/api/vouchers/usage/${usageId}/category`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category_id: categoryId }),
    }).then(() => {
      setUsage(prev => prev.map(u => {
        if (u.id !== usageId) return u;
        const cat = categories.find(c => c.id === categoryId);
        return { ...u, category_id: categoryId, category_name: cat?.name || null, category_color: cat?.color || null };
      }));
    });
  }

  async function addUsage(e) {
    e.preventDefault();
    await fetch(`/api/vouchers/${selectedVoucher.id}/usage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: Number(newUsage.amount),
        date: newUsage.date,
        description: newUsage.description,
        category_id: newUsage.category_id ? Number(newUsage.category_id) : null,
      }),
    });
    setNewUsage({ amount: '', date: new Date().toLocaleDateString('en-CA'), description: '', category_id: '' });
    selectVoucher(selectedVoucher);
    loadVouchers();
  }

  function confirmDeleteEntry(type, id, description, amount) {
    setConfirmModal({
      title: 'Delete Entry',
      message: `Are you sure you want to delete "${description || 'this entry'}" (${formatCurrency(amount)})? The voucher balance will be adjusted.`,
      confirmLabel: 'Delete',
      onConfirm: async () => {
        const endpoint = type === 'usage' ? `/api/vouchers/usage/${id}` : `/api/vouchers/topup/${id}`;
        await fetch(endpoint, { method: 'DELETE' });
        setConfirmModal(null);
        loadActivity(selectedVoucher.id);
        loadVouchers();
      },
    });
  }

  async function addTopup(e) {
    e.preventDefault();
    await fetch(`/api/vouchers/${selectedVoucher.id}/topup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: Number(newTopup.amount),
        date: newTopup.date,
        description: newTopup.description,
        source: newTopup.is_gift_card ? 'manual' : 'refund',
      }),
    });
    setNewTopup({ amount: '', date: new Date().toLocaleDateString('en-CA'), description: '', is_gift_card: true });
    setShowTopup(false);
    selectVoucher(selectedVoucher);
    loadVouchers();
  }

  const usedPct = selectedVoucher
    ? ((selectedVoucher.initial_amount - selectedVoucher.remaining_amount) / selectedVoucher.initial_amount) * 100
    : 0;

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Gift Cards
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Track gift card balances and usage over time
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowCreate(!showCreate)} className={showCreate ? 'btn-secondary' : 'btn-primary'} title={showCreate ? 'Close the new voucher form' : 'Create a new voucher to track balance and usage'}>
            {showCreate ? (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
                Cancel
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                New Voucher
              </>
            )}
          </button>
          <button onClick={copyQuickAddLink} className="btn-secondary" title="Copy quick-add link (share via WhatsApp for easy top-ups)">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.935-2.186 2.25 2.25 0 0 0-3.935 2.186Z" />
            </svg>
            Quick Link
          </button>
        </div>
      </div>

      {/* Share Toast */}
      {showShareToast && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg animate-scale-in" style={{ background: 'var(--success-soft)', border: '1px solid var(--border)' }}>
          <svg className="w-4 h-4" style={{ color: 'var(--success)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
          <p className="text-sm font-medium" style={{ color: 'var(--success)' }}>
            Link copied! Share via WhatsApp for quick top-ups.
          </p>
        </div>
      )}

      {/* Amazon Pay Sync Schedule */}
      {syncSchedule && syncSchedule.amazon_pay_sync.enabled && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
          <svg className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--amber)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          <span style={{ color: 'var(--text-secondary)' }}>
            <span className="font-semibold" style={{ color: 'var(--amber)' }}>Amazon Pay auto-sync</span>{' — '}
            {syncSchedule.amazon_pay_sync.schedule}, next at{' '}
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
              {new Date(syncSchedule.amazon_pay_sync.next_at).toLocaleString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, day: 'numeric', month: 'short' })}
            </span>
          </span>
        </div>
      )}

      {/* Create Form */}
      {showCreate && (
        <form onSubmit={createVoucher} className="card p-5 animate-scale-in">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[150px]">
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Name</label>
              <input type="text" required value={newVoucher.name} onChange={e => setNewVoucher(v => ({ ...v, name: e.target.value }))}
                placeholder="Amazon Voucher" className="input-field" />
            </div>
            <div className="w-36">
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Amount</label>
              <input type="number" required value={newVoucher.initial_amount} onChange={e => setNewVoucher(v => ({ ...v, initial_amount: e.target.value }))}
                placeholder="5000" className="input-field" />
            </div>
            <div className="w-44">
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Purchase Date</label>
              <input type="date" required value={newVoucher.purchase_date} onChange={e => setNewVoucher(v => ({ ...v, purchase_date: e.target.value }))}
                className="input-field" />
            </div>
            <button type="submit" className="btn-primary" title="Create this voucher and start tracking its balance">Create</button>
          </div>
        </form>
      )}

      {/* Voucher Grid */}
      {vouchers.length === 0 ? (
        <div className="flex flex-col items-center py-16">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'var(--purple-soft)' }}>
            <svg className="w-7 h-7" style={{ color: 'var(--purple)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 11.25v8.25a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 1 0 9.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1 1 14.625 7.5H12m0 0V21m-8.625-9.75h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
            </svg>
          </div>
          <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>No vouchers yet</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Create one to start tracking usage</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {vouchers.map((v, idx) => {
            const pct = v.initial_amount > 0 ? (v.remaining_amount / v.initial_amount) * 100 : 0;
            const isSelected = selectedVoucher?.id === v.id;
            return (
              <div
                key={v.id}
                onClick={() => selectVoucher(v)}
                className={`card card-hover p-4 cursor-pointer animate-fade-in-up ${isSelected ? 'ring-2 ring-teal-500' : ''}`}
                style={{
                  animationDelay: `${idx * 60}ms`,
                  borderColor: isSelected ? 'var(--accent)' : undefined,
                }}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{v.name}</h3>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {new Date(v.purchase_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {pct <= 20 && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>LOW</span>
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); confirmDeleteVoucher(v); }}
                      className="p-1 rounded-lg hover:bg-[var(--surface)] transition-colors opacity-40 hover:opacity-100"
                      title="Delete this voucher"
                    >
                      <svg className="w-3.5 h-3.5" style={{ color: 'var(--danger)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="mt-4 flex items-baseline gap-1.5">
                  <span className="text-lg font-bold tabular-nums" style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                    {formatCurrency(v.remaining_amount)}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    / {formatCurrency(v.initial_amount)}
                  </span>
                </div>
                <div className="mt-2.5 w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--progress-bg)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${pct}%`,
                      background: pct > 50 ? 'var(--accent)' : pct > 20 ? 'var(--amber)' : 'var(--danger)',
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Usage Detail */}
      {selectedVoucher && (
        <div className="card overflow-hidden animate-scale-in">
          {/* Usage Header */}
          <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
            <div>
              <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedVoucher.name}</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {new Date(filters.year, filters.month - 1).toLocaleString('default', { month: 'long', year: 'numeric' })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={filters.month}
                onChange={e => setFilters(f => ({ ...f, month: Number(e.target.value) }))}
                className="rounded-lg px-2 py-1.5 text-xs font-medium shadow-xs focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition-all"
                style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {new Date(2000, i).toLocaleString('default', { month: 'short' })}
                  </option>
                ))}
              </select>
              <select
                value={filters.year}
                onChange={e => setFilters(f => ({ ...f, year: Number(e.target.value) }))}
                className="rounded-lg px-2 py-1.5 text-xs font-medium shadow-xs focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition-all"
                style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
              >
                {Array.from({ length: 5 }, (_, i) => {
                  const y = new Date().getFullYear() - i;
                  return <option key={y} value={y}>{y}</option>;
                })}
              </select>
              <div className="flex items-center rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                {['all', 'spend', 'topup'].map(type => (
                  <button
                    key={type}
                    onClick={() => setVoucherTypeFilter(type)}
                    className="px-2 py-1.5 text-[11px] font-medium transition-all"
                    style={{
                      background: voucherTypeFilter === type ? 'var(--accent)' : 'var(--card)',
                      color: voucherTypeFilter === type ? '#fff' : 'var(--text-muted)',
                    }}
                  >
                    {type === 'all' ? 'All' : type === 'spend' ? 'Spends' : 'Top-ups'}
                  </button>
                ))}
              </div>
              <button
                onClick={() => { setShowAddUsage(!showAddUsage); setShowTopup(false); }}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{
                  background: showAddUsage ? 'var(--accent-soft)' : 'var(--surface)',
                  color: showAddUsage ? 'var(--accent)' : 'var(--text-secondary)',
                  border: '1px solid var(--border)',
                }}
                title="Record a spend from this voucher"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
                </svg>
                Add Spend
              </button>
              <button
                onClick={() => { setShowTopup(!showTopup); setShowAddUsage(false); }}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{
                  background: showTopup ? 'var(--success-soft)' : 'var(--surface)',
                  color: showTopup ? 'var(--success)' : 'var(--text-secondary)',
                  border: '1px solid var(--border)',
                }}
                title="Add balance to this voucher"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add Balance
              </button>
              {(usage.length > 0 || topups.length > 0) && (
                <button
                  onClick={() => setConfirmModal({
                    title: 'Clear Month',
                    message: `Delete all ${usage.length + topups.length} entries for ${new Date(filters.year, filters.month - 1).toLocaleString('default', { month: 'long', year: 'numeric' })}? Voucher balance will be adjusted accordingly.`,
                    confirmLabel: 'Clear All',
                    onConfirm: async () => {
                      await fetch(`/api/vouchers/${selectedVoucher.id}/clear-month?month=${filters.month}&year=${filters.year}`, { method: 'DELETE' });
                      setConfirmModal(null);
                      loadActivity(selectedVoucher.id);
                      loadVouchers();
                    },
                  })}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  style={{
                    background: 'var(--surface)',
                    color: 'var(--danger)',
                    border: '1px solid var(--border)',
                  }}
                  title="Delete all entries for the selected month"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                  </svg>
                  Clear Month
                </button>
              )}
            </div>
          </div>

          {/* Add Balance Form */}
          {showTopup && (
            <form onSubmit={addTopup} className="px-5 py-4 border-b flex flex-wrap gap-3 items-end" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <div className="w-28">
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Amount</label>
                <input type="number" required value={newTopup.amount} onChange={e => setNewTopup(t => ({ ...t, amount: e.target.value }))}
                  className="input-field" placeholder="500" />
              </div>
              <div className="w-36">
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Date</label>
                <input type="date" required value={newTopup.date} onChange={e => setNewTopup(t => ({ ...t, date: e.target.value }))}
                  className="input-field" />
              </div>
              <div className="flex-1 min-w-[120px]">
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Description</label>
                <input type="text" value={newTopup.description} onChange={e => setNewTopup(t => ({ ...t, description: e.target.value }))}
                  placeholder="Refund, Gift card, etc." className="input-field" />
              </div>
              <div className="flex items-center h-[38px]">
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={newTopup.is_gift_card}
                    onChange={e => setNewTopup(t => ({ ...t, is_gift_card: e.target.checked }))}
                    className="w-3.5 h-3.5 rounded accent-[var(--success)]"
                  />
                  <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Gift card</span>
                </label>
              </div>
              <button type="submit" className="px-3 py-2 rounded-lg text-sm font-medium transition-colors" style={{ background: 'var(--accent)', color: 'white' }} title="Add balance to voucher">
                <svg className="w-3.5 h-3.5 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add
              </button>
            </form>
          )}

          {/* Add Usage Form */}
          {showAddUsage && (
            <form onSubmit={addUsage} className="px-5 py-4 border-b flex flex-wrap gap-3 items-end" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <div className="w-28">
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Amount</label>
                <input type="number" required value={newUsage.amount} onChange={e => setNewUsage(u => ({ ...u, amount: e.target.value }))}
                  className="input-field" placeholder="500" />
              </div>
              <div className="w-36">
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Date</label>
                <input type="date" required value={newUsage.date} onChange={e => setNewUsage(u => ({ ...u, date: e.target.value }))}
                  className="input-field" />
              </div>
              <div className="flex-1 min-w-[120px]">
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Description</label>
                <input type="text" value={newUsage.description} onChange={e => setNewUsage(u => ({ ...u, description: e.target.value }))}
                  placeholder="Groceries" className="input-field" />
              </div>
              <button type="submit" className="btn-primary" title="Record a new voucher usage and deduct from balance">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add
              </button>
            </form>
          )}

          {/* Activity Table */}
          {usage.length === 0 && topups.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                No activity in {new Date(filters.year, filters.month - 1).toLocaleString('default', { month: 'long', year: 'numeric' })}
              </p>
            </div>
          ) : (<>
            {/* Table Header */}
            <div className="grid grid-cols-[80px_1fr_130px_120px_56px] gap-3 px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-center"
              style={{ borderBottom: '2px solid var(--header-divider)', color: 'var(--text-secondary)', letterSpacing: '0.08em' }}>
              <span>Date</span>
              <span className="text-left">Description</span>
              <span>Category</span>
              <span>Amount</span>
              <span></span>
            </div>

            {/* Activity Rows */}
            <div className="transaction-rows overflow-y-auto" style={{ maxHeight: '480px' }}>
              {[
                ...usage.map(u => ({ ...u, _type: 'usage' })),
                ...topups.map(t => ({ ...t, _type: 'topup' })),
              ].filter(e => voucherTypeFilter === 'all' || (voucherTypeFilter === 'spend' ? e._type === 'usage' : e._type === 'topup'))
              .sort((a, b) => b.date.localeCompare(a.date)).map((entry, idx) => {
                const rowBg = idx % 2 === 1 ? 'var(--row-stripe)' : 'transparent';
                const isManualTopup = entry._type === 'topup' && entry.source === 'manual';
                const isRefund = entry._type === 'topup' && entry.source !== 'manual';
                return (
                  <div
                    key={`${entry._type}-${entry.id}`}
                    className="grid grid-cols-[80px_1fr_130px_120px_56px] gap-3 px-4 py-3 items-center transition-colors duration-150 animate-slide-in"
                    style={{ animationDelay: `${Math.min(idx * 20, 400)}ms`, background: rowBg }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--table-row-hover)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = rowBg; }}
                  >
                    <span className="text-xs font-medium tabular-nums" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                      {new Date(entry.date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    </span>

                    <div className="min-w-0">
                      <span className="text-sm truncate block" style={{ color: 'var(--text-secondary)' }}>
                        {entry.description || '—'}
                      </span>
                      <span className="text-[10px] font-semibold mt-0.5 inline-block px-1.5 py-0.5 rounded" style={{
                        background: entry._type === 'usage' ? 'var(--danger-soft)' : isManualTopup ? 'var(--success-soft)' : 'var(--accent-soft)',
                        color: entry._type === 'usage' ? 'var(--danger)' : isManualTopup ? 'var(--success)' : 'var(--accent)',
                      }}>
                        {entry._type === 'usage' ? 'SPEND' : isManualTopup ? 'TOP UP' : 'REFUND'}
                      </span>
                    </div>

                    <div className="flex justify-center">
                      {entry._type === 'usage' ? (
                        <select
                          value={entry.category_id || ''}
                          onChange={e => updateUsageCategory(entry.id, Number(e.target.value) || null)}
                          className="text-xs rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition-all truncate w-full"
                          style={{
                            background: entry.category_color ? entry.category_color + '18' : 'var(--input-bg)',
                            border: `1px solid ${entry.category_color ? entry.category_color + '40' : 'var(--border)'}`,
                            color: entry.category_id ? 'var(--text-secondary)' : 'var(--text-muted)',
                          }}
                        >
                          <option value="">Uncategorized</option>
                          {categories.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </div>

                    <span className="text-sm font-semibold tabular-nums text-right" style={{
                      fontFamily: 'var(--font-mono)',
                      color: entry._type === 'topup' ? 'var(--success)' : 'var(--danger)',
                    }}>
                      {entry._type === 'topup' ? '+' : '-'}{formatCurrency(entry.amount)}
                    </span>

                    <div className="flex items-center justify-end gap-0.5">
                      {entry.email_metadata ? (
                        <button
                          onClick={() => setEmailModal(JSON.parse(entry.email_metadata))}
                          className="p-1 rounded hover:bg-[var(--surface)] transition-colors opacity-40 hover:opacity-100"
                          title="View source email"
                        >
                          <svg className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                          </svg>
                        </button>
                      ) : <span className="w-[22px]" />}
                      <button
                        onClick={() => confirmDeleteEntry(entry._type, entry.id, entry.description, entry.amount)}
                        className="p-1 rounded hover:bg-[var(--surface)] transition-colors opacity-40 hover:opacity-100"
                        title="Delete this entry"
                      >
                        <svg className="w-3.5 h-3.5" style={{ color: 'var(--danger)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Table Footer */}
            {(() => {
              const totalDebit = usage.reduce((s, u) => s + u.amount, 0);
              const totalCredit = topups.reduce((s, t) => s + t.amount, 0);
              const net = totalDebit - totalCredit;
              return (
                <div className="flex items-center justify-between px-4 py-3 border-t"
                  style={{ background: 'var(--table-header-bg)', borderColor: 'var(--border)' }}>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {usage.length + topups.length} entries
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium px-2.5 py-1 rounded-md"
                      style={{ color: 'var(--danger)', background: 'var(--stat-debit-bg)', border: '1px solid var(--stat-debit-border)' }}>
                      Debit: {formatCurrency(totalDebit)}
                    </span>
                    <span className="text-xs font-medium px-2.5 py-1 rounded-md"
                      style={{ color: 'var(--success)', background: 'var(--stat-credit-bg)', border: '1px solid var(--stat-credit-border)' }}>
                      Credit: {formatCurrency(totalCredit)}
                    </span>
                    <span className="text-xs font-bold px-2.5 py-1 rounded-md"
                      style={{
                        color: net > 0 ? 'var(--danger)' : 'var(--success)',
                        background: net > 0 ? 'var(--stat-debit-bg)' : 'var(--stat-credit-bg)',
                        border: `1px solid ${net > 0 ? 'var(--stat-debit-border)' : 'var(--stat-credit-border)'}`,
                      }}>
                      Net: {formatCurrency(net)}
                    </span>
                  </div>
                </div>
              );
            })()}
          </>)}
        </div>
      )}

      {/* Quick Add Modal */}
      {quickAddModal && (
        <QuickAddModal
          data={quickAddModal}
          voucher={selectedVoucher}
          categories={categories}
          onClose={() => setQuickAddModal(null)}
          onSubmit={async (data) => {
            if (data.type === 'topup') {
              await fetch(`/api/vouchers/${selectedVoucher.id}/topup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  amount: Number(data.amount),
                  date: data.date,
                  description: data.description,
                  source: data.is_gift_card ? 'manual' : 'refund',
                }),
              });
            } else {
              await fetch(`/api/vouchers/${selectedVoucher.id}/usage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  amount: Number(data.amount),
                  date: data.date,
                  description: data.description,
                  category_id: data.category_id ? Number(data.category_id) : null,
                }),
              });
            }
            setQuickAddModal(null);
            loadActivity(selectedVoucher.id);
            loadVouchers();
          }}
        />
      )}

      {/* Confirm Modal */}
      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          onConfirm={confirmModal.onConfirm}
          onClose={() => setConfirmModal(null)}
        />
      )}

      {emailModal && (
        <EmailDetailModal email={emailModal} onClose={() => setEmailModal(null)} />
      )}
    </div>
  );
}

function QuickAddModal({ data, voucher, categories, onClose, onSubmit }) {
  const [form, setForm] = useState(data);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    await onSubmit(form);
    setSaving(false);
  }

  const isTopup = form.type === 'topup';

  return (
    <Modal open={true} onClose={onClose}>
      <div className="text-center mb-5">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ background: isTopup ? 'var(--success-soft)' : 'var(--danger-soft)' }}>
          <svg className="w-7 h-7" style={{ color: isTopup ? 'var(--success)' : 'var(--danger)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            {isTopup ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
            )}
          </svg>
        </div>
        <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
          {isTopup ? 'Add Balance' : 'Record Spend'}
        </h2>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          {voucher?.name}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Amount</label>
            <input
              type="number"
              required
              value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
              className="input-field text-lg font-bold"
              style={{ fontFamily: 'var(--font-mono)' }}
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Date</label>
            <input
              type="date"
              required
              value={form.date}
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
              className="input-field"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Description</label>
          <input
            type="text"
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            className="input-field"
            placeholder={isTopup ? 'Gift Card, Cashback, etc.' : 'What did you buy?'}
          />
        </div>

        {isTopup && (
          <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
            <input
              type="checkbox"
              checked={form.is_gift_card}
              onChange={e => setForm(f => ({ ...f, is_gift_card: e.target.checked }))}
              className="w-4 h-4 rounded accent-[var(--success)]"
            />
            Gift card purchase
          </label>
        )}

        {!isTopup && (
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Category</label>
            <select
              value={form.category_id}
              onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}
              className="select-field"
            >
              <option value="">Uncategorized</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button type="submit" disabled={saving || !form.amount} className="btn-primary flex-1 justify-center">
            {saving ? 'Saving...' : isTopup ? 'Add Balance' : 'Record Spend'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmModal({ title, message, confirmLabel, onConfirm, onClose }) {
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    await onConfirm();
    setLoading(false);
  }

  return (
    <Modal open={true} onClose={onClose}>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
          style={{ background: 'var(--danger-soft)' }}>
          <svg className="w-5 h-5" style={{ color: 'var(--danger)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
        </div>
        <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
      </div>
      <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{message}</p>
      <div className="flex items-center justify-end gap-2 mt-4">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm font-medium rounded-lg transition-all"
          style={{ color: 'var(--text-secondary)', background: 'var(--input-bg)', border: '1px solid var(--border)' }}
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium rounded-lg transition-all disabled:opacity-50"
          style={{ background: 'var(--danger)', color: '#fff' }}
        >
          {loading ? 'Deleting...' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}

function EmailDetailModal({ email, onClose }) {
  const bodyText = email.bodyFull || email.bodyExcerpt || '';

  const highlights = extractHighlights(bodyText, email.subject);

  return (
    <Modal open={true} onClose={onClose}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: 'var(--accent-soft)' }}>
            <svg className="w-4.5 h-4.5" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
            </svg>
          </div>
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Source Email</h3>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--surface)] transition-colors">
          <svg className="w-5 h-5" style={{ color: 'var(--text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="space-y-2.5 text-sm">
        <div className="flex gap-2">
          <span className="font-medium shrink-0" style={{ color: 'var(--text-muted)', width: '60px' }}>From</span>
          <span style={{ color: 'var(--text-primary)' }}>{email.from}</span>
        </div>
        <div className="flex gap-2">
          <span className="font-medium shrink-0" style={{ color: 'var(--text-muted)', width: '60px' }}>Subject</span>
          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{email.subject}</span>
        </div>
        <div className="flex gap-2">
          <span className="font-medium shrink-0" style={{ color: 'var(--text-muted)', width: '60px' }}>Date</span>
          <span style={{ color: 'var(--text-secondary)' }}>
            {email.emailDate ? new Date(email.emailDate).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
          </span>
        </div>
      </div>

      {highlights.length > 0 && (
        <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Key Details</p>
          <div className="flex flex-wrap gap-2">
            {highlights.map((h, i) => (
              <div key={i} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--text-muted)' }}>{h.label}</span>
                <span className="font-semibold" style={{ color: h.color || 'var(--text-primary)' }}>{h.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
        <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Email Body</p>
        <pre className="text-xs leading-relaxed whitespace-pre-wrap overflow-y-auto rounded-lg p-3" style={{
          color: 'var(--text-secondary)',
          background: 'var(--surface)',
          maxHeight: '400px',
          fontFamily: 'inherit',
        }}>
          {bodyText || 'No email body available.'}
        </pre>
      </div>

      <div className="mt-4 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
        <button onClick={onClose} className="btn-secondary w-full">Close</button>
      </div>
    </Modal>
  );
}

function extractHighlights(body, subject) {
  const highlights = [];
  const combined = `${subject || ''} ${body}`;

  const balancePatterns = [
    /(?:updated|available|current|new|total)\s*(?:amazon\s*pay\s*)?balance[:\s]*₹\s*([\d,]+(?:\.\d+)?)/i,
    /balance[:\s]*₹\s*([\d,]+(?:\.\d+)?)/i,
    /₹\s*([\d,]+(?:\.\d+)?)\s*(?:has been|was)\s*(?:added|credited)/i,
  ];
  for (const pat of balancePatterns) {
    const m = combined.match(pat);
    if (m) {
      highlights.push({ label: 'Balance', value: `₹${m[1]}`, color: 'var(--success)' });
      break;
    }
  }

  const merchantMatch = combined.match(/(?:payment|paid)\s*(?:of\s*₹[\d,]+(?:\.\d+)?\s*)?to\s+(.+?)(?:\s+was|\s+on|\s*\.|\s*$)/i);
  if (merchantMatch) {
    highlights.push({ label: 'To', value: merchantMatch[1].trim().substring(0, 40) });
  }

  const refundMatch = combined.match(/refund\s*(?:of\s*)?₹\s*([\d,]+(?:\.\d+)?)/i);
  if (refundMatch) {
    highlights.push({ label: 'Refund', value: `₹${refundMatch[1]}`, color: 'var(--success)' });
  }

  const orderMatch = combined.match(/order\s*(?:#|id|no\.?)?[:\s]*([\w-]{5,})/i);
  if (orderMatch) {
    highlights.push({ label: 'Order', value: orderMatch[1] });
  }

  const txnIdMatch = combined.match(/(?:transaction|txn|ref)\s*(?:#|id|no\.?)?[:\s]*([\w-]{6,})/i);
  if (txnIdMatch && txnIdMatch[1] !== orderMatch?.[1]) {
    highlights.push({ label: 'Txn ID', value: txnIdMatch[1].substring(0, 20) });
  }

  return highlights;
}
