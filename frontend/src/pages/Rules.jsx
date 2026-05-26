import { useState, useEffect } from 'react';

export default function Rules() {
  const [rules, setRules] = useState([]);
  const [categories, setCategories] = useState([]);
  const [newPattern, setNewPattern] = useState('');
  const [newCategoryId, setNewCategoryId] = useState('');
  const [applyResult, setApplyResult] = useState(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryColor, setNewCategoryColor] = useState('#6b7280');

  useEffect(() => {
    loadRules();
    loadCategories();
  }, []);

  function loadCategories() {
    fetch('/api/categories').then(r => r.json()).then(setCategories);
  }

  function loadRules() {
    fetch('/api/rules').then(r => r.json()).then(setRules);
  }

  async function addRule(e) {
    e.preventDefault();
    if (!newPattern || !newCategoryId) return;
    await fetch('/api/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern: newPattern, category_id: Number(newCategoryId) }),
    });
    setNewPattern('');
    setNewCategoryId('');
    loadRules();
    runCategorization();
  }

  async function deleteRule(id) {
    await fetch(`/api/rules/${id}`, { method: 'DELETE' });
    loadRules();
  }

  async function updateRule(id, field, value) {
    await fetch(`/api/rules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
    loadRules();
    runCategorization();
  }

  function runCategorization() {
    Promise.all([
      fetch('/api/rules/apply', { method: 'POST' }).then(r => r.json()),
      fetch('/api/vouchers/usage/auto-categorize', { method: 'POST' }).then(r => r.json()),
    ]).then(([txnRes, apRes]) => {
      if (txnRes.applied > 0 || apRes.applied > 0) {
        setApplyResult({ transactions: txnRes.applied, amazonPay: apRes.applied });
        setTimeout(() => setApplyResult(null), 5000);
      }
    });
  }

  async function applyAll() {
    const [txnRes, apRes] = await Promise.all([
      fetch('/api/rules/apply', { method: 'POST' }).then(r => r.json()),
      fetch('/api/vouchers/usage/auto-categorize', { method: 'POST' }).then(r => r.json()),
    ]);
    setApplyResult({ transactions: txnRes.applied, amazonPay: apRes.applied });
    setTimeout(() => setApplyResult(null), 5000);
  }

  async function addCategory(e) {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newCategoryName.trim(), color: newCategoryColor }),
    });
    setNewCategoryName('');
    setNewCategoryColor('#6b7280');
    loadCategories();
  }

  async function deleteCategory(id) {
    await fetch(`/api/categories/${id}`, { method: 'DELETE' });
    loadCategories();
    loadRules();
  }

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Categorization Rules
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Auto-categorize transactions based on description patterns
          </p>
        </div>
        <button onClick={applyAll} className="btn-primary" title="Run all rules against uncategorized transactions">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
          </svg>
          Apply to All Uncategorized
        </button>
      </div>

      {/* Success Toast */}
      {applyResult && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg animate-scale-in"
          style={{ background: 'var(--success-soft)', border: '1px solid var(--border)' }}>
          <svg className="w-4 h-4 shrink-0" style={{ color: 'var(--success)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
          <p className="text-sm font-medium" style={{ color: 'var(--success)' }}>
            Categorized: <span style={{ color: 'var(--purple)' }}>{applyResult.transactions} transaction{applyResult.transactions !== 1 ? 's' : ''}</span>
            {' + '}
            <span style={{ color: 'var(--amber)' }}>{applyResult.amazonPay} Amazon Pay</span>
          </p>
        </div>
      )}

      {/* Info */}
      <div className="flex items-start gap-3 px-5 py-4 rounded-lg text-sm leading-relaxed" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <svg className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
        </svg>
        <p style={{ color: 'var(--text-secondary)' }}>
          Rules auto-apply when added or edited. <span style={{ color: 'var(--text-primary)' }} className="font-medium">Rule-based categories will be updated</span> if you change a rule. <span style={{ color: 'var(--text-primary)' }} className="font-medium">Manually assigned categories won't be touched</span> by any rule change.
        </p>
      </div>

      {/* Add Rule Form */}
      <form onSubmit={addRule} className="card p-5">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>
              Pattern
            </label>
            <input
              type="text"
              value={newPattern}
              onChange={e => setNewPattern(e.target.value)}
              placeholder="e.g., swiggy, amazon, zomato"
              className="input-field"
            />
          </div>
          <div className="w-52">
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>
              Category
            </label>
            <select value={newCategoryId} onChange={e => setNewCategoryId(e.target.value)} className="select-field">
              <option value="">Select category...</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <button type="submit" disabled={!newPattern || !newCategoryId} className="btn-primary" title="Create a new rule to auto-categorize matching transactions">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Rule
          </button>
        </div>
      </form>

      {/* Categories Management */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            Categories
          </h2>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {categories.length} total
          </span>
        </div>

        <form onSubmit={addCategory} className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[160px]">
            <input
              type="text"
              value={newCategoryName}
              onChange={e => setNewCategoryName(e.target.value)}
              placeholder="New category name"
              className="input-field"
            />
          </div>
          <div className="w-12">
            <input
              type="color"
              value={newCategoryColor}
              onChange={e => setNewCategoryColor(e.target.value)}
              className="w-full h-[38px] rounded-lg cursor-pointer border p-1"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>
          <button type="submit" disabled={!newCategoryName.trim()} className="btn-primary" title="Create a new expense category">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add
          </button>
        </form>

        <div className="flex flex-wrap gap-2">
          {categories.map(cat => (
            <span
              key={cat.id}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm group"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
              <span style={{ color: 'var(--text-primary)' }}>{cat.name}</span>
              {cat.protected ? (
                <svg className="ml-1 w-3.5 h-3.5 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} title="System category — cannot be deleted">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                </svg>
              ) : (
                <button
                  onClick={() => deleteCategory(cat.id)}
                  className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ color: 'var(--danger)' }}
                  title="Delete category"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </span>
          ))}
        </div>
        <p className="text-xs mt-2" style={{ color: 'var(--text-secondary)' }}>
          Categories with a lock icon are system categories and cannot be deleted.
        </p>
      </div>

      {/* Rules List */}
      <div className="card overflow-hidden">
        {rules.length === 0 ? (
          <div className="flex flex-col items-center py-12">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-3" style={{ background: 'var(--empty-icon-bg)' }}>
              <svg className="w-6 h-6" style={{ color: 'var(--empty-icon-color)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
            </div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>No rules yet</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Add your first rule above to start auto-categorizing</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[1fr_160px_60px] gap-3 px-5 py-3 text-xs font-semibold uppercase tracking-wider"
              style={{ borderBottom: '2px solid var(--header-divider)', color: 'var(--text-muted)', background: 'var(--table-header-bg)' }}>
              <span>Pattern</span>
              <span>Category</span>
              <span />
            </div>
            <div className="transaction-rows overflow-y-auto" style={{ maxHeight: '500px' }}>
              {rules.map((rule, idx) => {
                const rowBg = idx % 2 === 1 ? 'var(--row-stripe)' : 'transparent';
                return (
                  <div
                    key={rule.id}
                    className="grid grid-cols-[1fr_160px_60px] gap-3 px-5 py-3 items-center group transition-colors animate-slide-in"
                    style={{ animationDelay: `${idx * 30}ms`, background: rowBg }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--table-row-hover)'}
                    onMouseLeave={e => e.currentTarget.style.background = rowBg}
                  >
                    <input
                      type="text"
                      defaultValue={rule.pattern}
                      onBlur={e => { if (e.target.value !== rule.pattern) updateRule(rule.id, 'pattern', e.target.value); }}
                      onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
                      className="text-sm font-medium px-2 py-1 rounded-md transition-all focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                      style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', background: 'transparent', border: '1px solid transparent' }}
                      onFocus={e => { e.target.style.background = 'var(--input-bg)'; e.target.style.borderColor = 'var(--border)'; }}
                      onBlurCapture={e => { e.target.style.background = 'transparent'; e.target.style.borderColor = 'transparent'; }}
                    />
                    <select
                      value={rule.category_id}
                      onChange={e => updateRule(rule.id, 'category_id', Number(e.target.value))}
                      className="text-xs rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition-all truncate"
                      style={{
                        background: rule.category_color ? rule.category_color + '18' : 'var(--input-bg)',
                        border: `1px solid ${rule.category_color ? rule.category_color + '40' : 'var(--border)'}`,
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {categories.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <div className="flex justify-end">
                      <button
                        onClick={() => deleteRule(rule.id)}
                        className="btn-danger opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Delete this categorization rule"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="px-5 py-2.5 border-t text-xs" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)', background: 'var(--table-header-bg)' }}>
              {rules.length} rule{rules.length !== 1 ? 's' : ''} configured
            </div>
          </>
        )}
      </div>
    </div>
  );
}
