import { useState, useEffect } from 'react';
import Modal from '../components/Modal';

export default function Transactions() {
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState(null);
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [selectedSources, setSelectedSources] = useState(new Set());
  const [collapsedSources, setCollapsedSources] = useState(new Set());
  const [confirmModal, setConfirmModal] = useState(null);
  const [renamingSource, setRenamingSource] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [addingSource, setAddingSource] = useState(null);
  const [dueDates, setDueDates] = useState({});
  const [filters, setFilters] = useState({
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
  });

  useEffect(() => {
    fetch('/api/categories').then(r => r.json()).then(setCategories);
  }, []);

  function loadTransactions() {
    const params = new URLSearchParams({
      month: String(filters.month),
      year: String(filters.year),
    });
    fetch(`/api/transactions?${params}`).then(r => r.json()).then(setTransactions);
    const now = new Date();
    const isCurrentMonth = filters.month === now.getMonth() + 1 && filters.year === now.getFullYear();
    if (isCurrentMonth) {
      fetch(`/api/transactions/due-dates?${params}`).then(r => r.json()).then(setDueDates);
    } else {
      setDueDates({});
    }
  }

  useEffect(() => {
    loadTransactions();
  }, [filters]);

  async function refreshCategories() {
    setRefreshing(true);
    try {
      const res = await fetch('/api/rules/apply', { method: 'POST' });
      const data = await res.json();
      setRefreshResult(data);
      loadTransactions();
      setTimeout(() => setRefreshResult(null), 4000);
    } finally {
      setRefreshing(false);
    }
  }

  function updateCategory(id, categoryId) {
    fetch(`/api/transactions/${id}/category`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category_id: categoryId }),
    }).then(() => {
      setTransactions(prev =>
        prev.map(t => {
          if (t.id !== id) return t;
          const cat = categories.find(c => c.id === categoryId);
          return { ...t, category_id: categoryId, category_name: cat?.name, category_color: cat?.color || null };
        })
      );
    });
  }

  function toggleReimbursable(id, current) {
    fetch(`/api/transactions/${id}/reimbursable`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_reimbursable: !current }),
    }).then(() => {
      setTransactions(prev =>
        prev.map(t => t.id === id ? { ...t, is_reimbursable: !current ? 1 : 0 } : t)
      );
    });
  }

  async function saveTransaction(updated) {
    await fetch(`/api/transactions/${updated.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
    loadTransactions();
    setEditingTransaction(null);
  }

  async function deleteTransaction(id) {
    await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
    loadTransactions();
    setEditingTransaction(null);
  }

  const totalDebit = transactions.filter(t => t.type !== 'credit' && !t.is_reimbursable).reduce((s, t) => s + t.amount, 0);
  const totalCredit = transactions.filter(t => t.type === 'credit' && !t.is_reimbursable).reduce((s, t) => s + t.amount, 0);
  const netAmount = totalDebit - totalCredit;
  const reimbursableCount = transactions.filter(t => t.is_reimbursable).length;

  const monthLabel = new Date(filters.year, filters.month - 1).toLocaleString('default', { month: 'long', year: 'numeric' });

  // Group transactions by source
  const sourceGroups = {};
  for (const t of transactions) {
    const key = t.source || 'Unknown';
    if (!sourceGroups[key]) sourceGroups[key] = [];
    sourceGroups[key].push(t);
  }
  // Sort sources: most recent transaction first
  const sourceNames = Object.keys(sourceGroups).sort((a, b) => {
    if (a === 'Unknown') return 1;
    if (b === 'Unknown') return -1;
    const latestA = sourceGroups[a][0]?.date || '';
    const latestB = sourceGroups[b][0]?.date || '';
    return latestB.localeCompare(latestA);
  });

  // Auto-select most recent source on first load
  useEffect(() => {
    if (sourceNames.length > 0 && selectedSources.size === 0) {
      setSelectedSources(new Set([sourceNames[0]]));
    }
  }, [transactions]);

  function toggleSource(name) {
    setSelectedSources(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  function confirmDownload(sourceName) {
    setConfirmModal({
      title: 'Download Source File',
      message: `Download the original file imported for "${sourceName}"?`,
      confirmLabel: 'Download',
      variant: 'accent',
      onConfirm: () => {
        window.location.href = `/api/upload/files/by-source/download?source=${encodeURIComponent(sourceName)}`;
        setConfirmModal(null);
      },
    });
  }

  function confirmDeleteSource(sourceName, count) {
    setConfirmModal({
      title: 'Delete All Transactions',
      message: `This will permanently delete all ${count} transaction${count !== 1 ? 's' : ''} from "${sourceName}". This action cannot be undone.`,
      confirmLabel: 'Delete All',
      variant: 'danger',
      onConfirm: async () => {
        await fetch(`/api/transactions/by-source?source=${encodeURIComponent(sourceName)}`, { method: 'DELETE' });
        setConfirmModal(null);
        loadTransactions();
      },
    });
  }

  function toggleCollapse(sourceName) {
    setCollapsedSources(prev => {
      const next = new Set(prev);
      if (next.has(sourceName)) {
        next.delete(sourceName);
      } else {
        next.add(sourceName);
      }
      return next;
    });
  }

  function startRename(sourceName) {
    setRenamingSource(sourceName);
    setRenameValue(sourceName);
  }

  function submitRename(oldSource) {
    const newSource = renameValue.trim();
    if (!newSource || newSource === oldSource) {
      setRenamingSource(null);
      return;
    }
    setConfirmModal({
      title: 'Rename Source',
      message: `This will rename "${oldSource}" to "${newSource}" across all transactions in every month and all associated uploaded files.`,
      confirmLabel: 'Rename All',
      variant: 'accent',
      onConfirm: async () => {
        await fetch('/api/transactions/rename-source', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ old_source: oldSource, new_source: newSource }),
        });
        setConfirmModal(null);
        setRenamingSource(null);
        loadTransactions();
      },
    });
  }

  return (
    <div className="space-y-5 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Transactions
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{monthLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refreshCategories}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium shadow-xs focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition-all disabled:opacity-50"
            style={{ background: 'var(--accent-soft)', border: '1px solid var(--border)', color: 'var(--accent)' }}
            title="Apply categorization rules to all uncategorized transactions across all months"
          >
            <svg className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.992 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            {refreshing ? 'Applying...' : 'Auto-categorize'}
          </button>
          <select
            value={filters.month}
            onChange={e => setFilters(f => ({ ...f, month: Number(e.target.value) }))}
            className="rounded-lg px-3 py-2 text-sm font-medium shadow-xs focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition-all"
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
            className="rounded-lg px-3 py-2 text-sm font-medium shadow-xs focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition-all"
            style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          >
            {Array.from({ length: 5 }, (_, i) => {
              const y = new Date().getFullYear() - i;
              return <option key={y} value={y}>{y}</option>;
            })}
          </select>
        </div>
      </div>

      {/* Refresh Result Toast */}
      {refreshResult && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg animate-scale-in"
          style={{ background: 'var(--success-soft)', border: '1px solid var(--border)' }}>
          <svg className="w-4 h-4 shrink-0" style={{ color: 'var(--success)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
          <p className="text-sm font-medium" style={{ color: 'var(--success)' }}>
            Applied rules to {refreshResult.applied} transaction{refreshResult.applied !== 1 ? 's' : ''} across all months
          </p>
        </div>
      )}

      {/* Overall Stats Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <StatPill label="Transactions" value={transactions.length} />
        <StatPill label="Debit" value={formatCurrency(totalDebit)} variant="debit" />
        <StatPill label="Credit" value={formatCurrency(totalCredit)} variant="credit" />
        <StatPill label="Net" value={formatCurrency(netAmount)} variant={netAmount > 0 ? 'debit' : 'credit'} />
        {reimbursableCount > 0 && (
          <StatPill label="Not Mine" value={reimbursableCount} muted />
        )}
      </div>

      {/* Source Toggles */}
      {sourceNames.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Sources:</span>
          {sourceNames.map(name => {
            const isActive = selectedSources.has(name);
            return (
              <button
                key={name}
                onClick={() => toggleSource(name)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: isActive ? 'var(--accent)' : 'var(--card)',
                  color: isActive ? '#fff' : 'var(--text-secondary)',
                  border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                  opacity: isActive ? 1 : 0.7,
                }}
                title={isActive ? `Hide transactions from ${name}` : `Show transactions from ${name}`}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
                </svg>
                {name}
                <span className="opacity-70">({sourceGroups[name].length})</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Transaction Tables - One per selected source */}
      {transactions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 animate-fade-in-up">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'var(--empty-icon-bg)' }}>
            <svg className="w-7 h-7" style={{ color: 'var(--empty-icon-color)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m6.75 12H9.75m3 0h3m-3 3h-3m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
          </div>
          <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>No transactions this month</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Upload a statement to get started</p>
        </div>
      ) : selectedSources.size === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 animate-fade-in-up">
          <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>No sources selected</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Click a source above to view its transactions</p>
        </div>
      ) : (
        <div className="space-y-5">
          {sourceNames.filter(name => selectedSources.has(name)).map(sourceName => {
            const group = sourceGroups[sourceName];
            const groupDebit = group.filter(t => t.type !== 'credit' && !t.is_reimbursable).reduce((s, t) => s + t.amount, 0);
            const groupCredit = group.filter(t => t.type === 'credit' && !t.is_reimbursable).reduce((s, t) => s + t.amount, 0);
            const groupNet = groupDebit - groupCredit;

            const isCollapsed = collapsedSources.has(sourceName);

            return (
              <div key={sourceName} className="rounded-xl overflow-hidden" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
                {/* Source Header */}
                <div className="flex items-center justify-between px-4 py-3"
                  style={{ background: 'var(--table-header-bg)', borderBottom: isCollapsed ? 'none' : '1px solid var(--border)' }}>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleCollapse(sourceName)}
                      className="w-6 h-6 rounded-md flex items-center justify-center transition-all hover:bg-[var(--surface)]"
                      style={{ color: 'var(--text-muted)' }}
                      title={isCollapsed ? `Expand ${sourceName} transactions` : `Collapse ${sourceName} transactions`}
                    >
                      <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                      </svg>
                    </button>
                    <svg className="w-4 h-4" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
                    </svg>
                    {renamingSource === sourceName ? (
                      <input
                        type="text"
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') submitRename(sourceName);
                          if (e.key === 'Escape') setRenamingSource(null);
                        }}
                        onBlur={() => setRenamingSource(null)}
                        autoFocus
                        className="text-sm font-semibold px-2 py-0.5 rounded-md w-40"
                        style={{ color: 'var(--text-primary)', background: 'var(--input-bg)', border: '1px solid var(--accent)', outline: 'none' }}
                      />
                    ) : (
                      <span className="text-sm font-semibold flex items-center gap-1.5 group/name" style={{ color: 'var(--text-primary)' }}>
                        {sourceName}
                        <button
                          onClick={e => { e.stopPropagation(); startRename(sourceName); }}
                          className="opacity-40 hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-[var(--surface)]"
                          style={{ color: 'var(--accent)' }}
                          title="Rename this source"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                          </svg>
                        </button>
                        {dueDates[sourceName] && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md ml-1"
                            style={{
                              color: new Date(dueDates[sourceName]) < new Date() ? 'var(--danger)' : 'var(--warning, #d97706)',
                              background: new Date(dueDates[sourceName]) < new Date() ? 'var(--danger-soft, rgba(239,68,68,0.08))' : 'var(--warning-soft, rgba(217,119,6,0.08))',
                              border: '1px solid currentColor',
                              opacity: 0.9,
                            }}
                          >
                            Due: {new Date(dueDates[sourceName] + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                  {isCollapsed ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-0.5 rounded-md" style={{ color: 'var(--text-muted)', background: 'var(--pill-default-bg)' }}>
                        {group.length} txn{group.length !== 1 ? 's' : ''}
                      </span>
                      <span className="text-xs font-medium px-2 py-0.5 rounded-md"
                        style={{ color: 'var(--danger)', background: 'var(--stat-debit-bg)' }}>
                        -{formatCurrency(groupDebit)}
                      </span>
                      <span className="text-xs font-medium px-2 py-0.5 rounded-md"
                        style={{ color: 'var(--success)', background: 'var(--stat-credit-bg)' }}>
                        +{formatCurrency(groupCredit)}
                      </span>
                      <span className="text-xs font-bold px-2 py-0.5 rounded-md"
                        style={{ color: groupNet > 0 ? 'var(--danger)' : 'var(--success)', background: groupNet > 0 ? 'var(--stat-debit-bg)' : 'var(--stat-credit-bg)' }}>
                        Net: {formatCurrency(groupNet)}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setAddingSource(sourceName)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all hover:opacity-80"
                        style={{ color: 'var(--success)', background: 'var(--success-soft)', border: '1px solid var(--border)' }}
                        title={`Add a manual transaction to ${sourceName}`}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                        Add
                      </button>
                      <button
                        onClick={() => confirmDownload(sourceName)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all hover:opacity-80"
                        style={{ color: 'var(--accent)', background: 'var(--accent-soft)', border: '1px solid var(--border)' }}
                        title={`Download source file for ${sourceName}`}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                        </svg>
                        Download
                      </button>
                      <button
                        onClick={() => confirmDeleteSource(sourceName, group.length)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all hover:opacity-80"
                        style={{ color: 'var(--danger)', background: 'var(--danger-soft, rgba(239,68,68,0.08))', border: '1px solid var(--border)' }}
                        title={`Delete all transactions from ${sourceName}`}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                        </svg>
                        Delete
                      </button>
                    </div>
                  )}
                </div>

                {!isCollapsed && <>
                {/* Table Header */}
                <div className="grid grid-cols-[80px_1fr_130px_140px_56px] gap-3 px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-center"
                  style={{ borderBottom: '2px solid var(--header-divider)', color: 'var(--text-secondary)', letterSpacing: '0.08em' }}>
                  <span>Date</span>
                  <span>Description</span>
                  <span>Amount</span>
                  <span>Category</span>
                  <span>Not Mine</span>
                </div>

                {/* Transaction Rows */}
                <div className="transaction-rows overflow-y-auto" style={{ maxHeight: '480px' }}>
                  {group.map((t, idx) => {
                    const rowBg = t.is_reimbursable
                      ? 'var(--table-row-hover)'
                      : idx % 2 === 1 ? 'var(--row-stripe)' : 'transparent';
                    return (
                    <div
                      key={t.id}
                      onDoubleClick={() => setEditingTransaction({ ...t })}
                      className="px-4 py-3 group transition-colors duration-150 animate-slide-in cursor-pointer"
                      style={{
                        animationDelay: `${Math.min(idx * 20, 400)}ms`,
                        background: rowBg,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--table-row-hover)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = rowBg; }}
                    >
                      <div className="grid grid-cols-[80px_1fr_130px_140px_56px] gap-3 items-center">
                      <span
                        className="text-xs font-medium tabular-nums"
                        style={{ fontFamily: 'var(--font-mono)', color: t.is_reimbursable ? 'var(--text-muted)' : 'var(--text-secondary)' }}
                      >
                        {formatDate(t.date)}
                      </span>

                      <span
                        className={`text-sm truncate pr-2 transition-colors ${t.is_reimbursable ? 'line-through' : ''}`}
                        style={{ color: t.is_reimbursable ? 'var(--text-muted)' : 'var(--text-secondary)' }}
                      >
                        {t.description}
                      </span>

                      <span
                        className={`text-sm font-semibold text-right pr-3 tabular-nums ${t.is_reimbursable ? 'line-through' : ''}`}
                        style={{
                          fontFamily: 'var(--font-mono)',
                          color: t.is_reimbursable ? 'var(--text-muted)' : t.type === 'credit' ? 'var(--success)' : 'var(--danger)',
                        }}
                      >
                        {t.type === 'credit' ? '+' : '-'}{formatCurrency(t.amount)}
                      </span>

                      <select
                        value={t.category_id || ''}
                        onChange={e => updateCategory(t.id, Number(e.target.value) || null)}
                        onDoubleClick={e => e.stopPropagation()}
                        className="text-xs rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition-all truncate"
                        style={{
                          background: t.category_color ? t.category_color + '18' : 'var(--input-bg)',
                          border: `1px solid ${t.category_color ? t.category_color + '40' : 'var(--border)'}`,
                          color: t.category_id ? 'var(--text-secondary)' : 'var(--text-muted)',
                          opacity: t.is_reimbursable ? 0.5 : 1,
                        }}
                      >
                        <option value="" style={{ color: 'var(--text-muted)' }}>Uncategorized</option>
                        {categories.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>

                      <div className="flex justify-center">
                        <button
                          onClick={() => toggleReimbursable(t.id, t.is_reimbursable)}
                          onDoubleClick={e => e.stopPropagation()}
                          className="w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-200"
                          style={{
                            background: t.is_reimbursable ? 'var(--amber-soft)' : 'var(--empty-icon-bg)',
                            color: t.is_reimbursable ? 'var(--amber)' : 'var(--text-muted)',
                          }}
                          title={t.is_reimbursable ? 'Marked as not mine (excluded from totals)' : 'Mark as not my expense'}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
                          </svg>
                        </button>
                      </div>
                      </div>
                      {t.notes && (
                        <div className="grid grid-cols-[80px_1fr_130px_140px_56px] gap-3 -mt-0.5">
                          <span></span>
                          <span></span>
                          <span className="text-xs italic pr-3 text-right" style={{ color: 'var(--text-muted)' }}>
                            {t.notes}
                          </span>
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>

                {/* Source Footer */}
                <div className="flex items-center justify-between px-4 py-3 border-t"
                  style={{ background: 'var(--table-header-bg)', borderColor: 'var(--border)' }}>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {group.length} transaction{group.length !== 1 ? 's' : ''}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium px-2.5 py-1 rounded-md"
                      style={{ color: 'var(--danger)', background: 'var(--stat-debit-bg)', border: '1px solid var(--stat-debit-border)' }}>
                      Debit: {formatCurrency(groupDebit)}
                    </span>
                    <span className="text-xs font-medium px-2.5 py-1 rounded-md"
                      style={{ color: 'var(--success)', background: 'var(--stat-credit-bg)', border: '1px solid var(--stat-credit-border)' }}>
                      Credit: {formatCurrency(groupCredit)}
                    </span>
                    <span className="text-xs font-bold px-2.5 py-1 rounded-md"
                      style={{
                        color: groupNet > 0 ? 'var(--danger)' : 'var(--success)',
                        background: groupNet > 0 ? 'var(--stat-debit-bg)' : 'var(--stat-credit-bg)',
                        border: `1px solid ${groupNet > 0 ? 'var(--stat-debit-border)' : 'var(--stat-credit-border)'}`,
                      }}>
                      Net: {formatCurrency(groupNet)}
                    </span>
                  </div>
                </div>
                </>}
              </div>
            );
          })}
        </div>
      )}
      {editingTransaction && (
        <EditTransactionModal
          transaction={editingTransaction}
          categories={categories}
          onSave={saveTransaction}
          onDelete={deleteTransaction}
          onClose={() => setEditingTransaction(null)}
        />
      )}
      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          variant={confirmModal.variant}
          onConfirm={confirmModal.onConfirm}
          onClose={() => setConfirmModal(null)}
        />
      )}
      {addingSource && (
        <AddTransactionModal
          source={addingSource}
          categories={categories}
          onClose={() => setAddingSource(null)}
          onAdded={() => { setAddingSource(null); loadTransactions(); }}
        />
      )}
    </div>
  );
}

function EditTransactionModal({ transaction, categories, onSave, onDelete, onClose }) {
  const [form, setForm] = useState({
    date: transaction.date,
    description: transaction.description,
    amount: transaction.amount,
    type: transaction.type || 'debit',
    category_id: transaction.category_id || '',
    is_reimbursable: !!transaction.is_reimbursable,
    is_voucher_purchase: !!transaction.is_voucher_purchase,
    notes: transaction.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function handleChange(field, value) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    await onSave({
      id: transaction.id,
      ...form,
      amount: Number(form.amount),
      category_id: form.category_id || null,
      source: transaction.source,
    });
    setSaving(false);
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await onDelete(transaction.id);
  }

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const inputStyle = {
    background: 'var(--input-bg)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
  };

  return (
    <Modal open={true} onClose={onClose}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Edit Transaction</h2>
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
          style={{ color: 'var(--text-muted)' }}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Date</label>
            <input
              type="date"
              value={form.date}
              onChange={e => handleChange('date', e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition-all"
              style={inputStyle}
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Type</label>
            <select
              value={form.type}
              onChange={e => handleChange('type', e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition-all"
              style={inputStyle}
            >
              <option value="debit">Debit</option>
              <option value="credit">Credit</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Description</label>
          <input
            type="text"
            value={form.description}
            onChange={e => handleChange('description', e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition-all"
            style={inputStyle}
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Amount</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.amount}
              onChange={e => handleChange('amount', e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition-all"
              style={inputStyle}
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Category</label>
            <select
              value={form.category_id}
              onChange={e => handleChange('category_id', e.target.value ? Number(e.target.value) : '')}
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition-all"
              style={inputStyle}
            >
              <option value="">Uncategorized</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Notes</label>
          <textarea
            value={form.notes}
            onChange={e => handleChange('notes', e.target.value)}
            rows={2}
            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition-all resize-none"
            style={inputStyle}
            placeholder="Optional notes..."
          />
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
            <input
              type="checkbox"
              checked={form.is_reimbursable}
              onChange={e => handleChange('is_reimbursable', e.target.checked)}
              className="rounded"
              style={{ borderColor: 'var(--checkbox-border)' }}
            />
            Not My Expense
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
            <input
              type="checkbox"
              checked={form.is_voucher_purchase}
              onChange={e => handleChange('is_voucher_purchase', e.target.checked)}
              className="rounded"
              style={{ borderColor: 'var(--checkbox-border)' }}
            />
            Voucher Purchase
          </label>
        </div>

        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={handleDelete}
            className="text-sm font-medium px-3 py-2 rounded-lg transition-all"
            style={{
              background: confirmDelete ? 'var(--danger-soft)' : 'transparent',
              color: 'var(--danger)',
              border: confirmDelete ? '1px solid var(--danger)' : '1px solid transparent',
            }}
            title={confirmDelete ? 'Click again to permanently delete this transaction' : 'Delete this transaction'}
          >
            {confirmDelete ? 'Confirm Delete?' : 'Delete'}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium rounded-lg transition-all"
              style={{ color: 'var(--text-secondary)' }}
              title="Discard changes and close"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-all disabled:opacity-50"
              style={{ background: 'var(--accent)' }}
              title="Save changes to this transaction"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function AddTransactionModal({ source, categories, onClose, onAdded }) {
  const [form, setForm] = useState({
    date: new Date().toLocaleDateString('en-CA'),
    description: '',
    amount: '',
    type: 'debit',
    category_id: '',
    notes: '',
    is_reimbursable: false,
  });
  const [saving, setSaving] = useState(false);

  function handleChange(field, value) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          amount: parseFloat(form.amount),
          category_id: form.category_id ? Number(form.category_id) : null,
          source,
        }),
      });
      if (res.ok) onAdded();
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = {
    background: 'var(--input-bg)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
  };

  return (
    <Modal open={true} onClose={onClose}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Add Transaction</h2>
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
          style={{ color: 'var(--text-muted)' }}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <p className="text-xs mb-4 px-2 py-1 rounded" style={{ background: 'var(--surface)', color: 'var(--text-muted)' }}>
        Source: <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{source}</span>
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Date</label>
            <input
              type="date"
              value={form.date}
              onChange={e => handleChange('date', e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition-all"
              style={inputStyle}
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Type</label>
            <select
              value={form.type}
              onChange={e => handleChange('type', e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition-all"
              style={inputStyle}
            >
              <option value="debit">Debit</option>
              <option value="credit">Credit</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Description</label>
          <input
            type="text"
            value={form.description}
            onChange={e => handleChange('description', e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition-all"
            style={inputStyle}
            required
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Amount</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.amount}
              onChange={e => handleChange('amount', e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition-all"
              style={inputStyle}
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Category</label>
            <select
              value={form.category_id}
              onChange={e => handleChange('category_id', e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition-all"
              style={inputStyle}
            >
              <option value="">Uncategorized</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Notes</label>
          <textarea
            value={form.notes}
            onChange={e => handleChange('notes', e.target.value)}
            rows={2}
            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition-all resize-none"
            style={inputStyle}
            placeholder="Optional notes..."
          />
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
          <input
            type="checkbox"
            checked={form.is_reimbursable}
            onChange={e => handleChange('is_reimbursable', e.target.checked)}
            className="rounded"
            style={{ borderColor: 'var(--checkbox-border)' }}
          />
          Not My Expense
        </label>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-lg transition-all"
            style={{ color: 'var(--text-secondary)' }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-all disabled:opacity-50"
            style={{ background: 'var(--accent)' }}
          >
            {saving ? 'Adding...' : 'Add Transaction'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function StatPill({ label, value, variant, muted }) {
  const getStyle = () => {
    if (variant === 'debit') return { background: 'var(--stat-debit-bg)', border: '1px solid var(--stat-debit-border)', color: 'var(--stat-debit-text)' };
    if (variant === 'credit') return { background: 'var(--stat-credit-bg)', border: '1px solid var(--stat-credit-border)', color: 'var(--stat-credit-text)' };
    if (muted) return { background: 'var(--stat-muted-bg)', border: '1px solid var(--stat-muted-border)', color: 'var(--stat-muted-text)' };
    return { background: 'var(--pill-default-bg)', border: '1px solid var(--pill-default-border)', color: 'var(--pill-default-text)' };
  };

  return (
    <div
      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
      style={getStyle()}
    >
      <span className="opacity-70">{label}</span>
      <span className="font-bold text-base">{value}</span>
    </div>
  );
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}

function ConfirmModal({ title, message, confirmLabel, variant, onConfirm, onClose }) {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  async function handleConfirm() {
    setLoading(true);
    await onConfirm();
    setLoading(false);
  }

  const confirmStyle = variant === 'danger'
    ? { background: 'var(--danger)', color: '#fff' }
    : { background: 'var(--accent)', color: '#fff' };

  return (
    <Modal open={true} onClose={onClose}>
      <div className="flex items-center gap-3 mb-3">
        {variant === 'danger' ? (
          <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
            style={{ background: 'var(--danger-soft, rgba(239,68,68,0.1))' }}>
            <svg className="w-5 h-5" style={{ color: 'var(--danger)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
          </div>
        ) : (
          <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
            style={{ background: 'var(--accent-soft)' }}>
            <svg className="w-5 h-5" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
          </div>
        )}
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
          style={confirmStyle}
        >
          {loading ? 'Processing...' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
