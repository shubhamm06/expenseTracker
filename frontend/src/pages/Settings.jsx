import { useState, useEffect, useRef } from 'react';
import Modal from '../components/Modal';

export default function Settings() {
  const [accounts, setAccounts] = useState([]);
  const [cards, setCards] = useState([]);
  const [profile, setProfile] = useState({ name: '', dob: '', pan: '' });
  const [syncJobs, setSyncJobs] = useState([]);
  const [showAddEmail, setShowAddEmail] = useState(false);
  const [showAddCard, setShowAddCard] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirmModal, setConfirmModal] = useState(null);
  const [pendingReviewCount, setPendingReviewCount] = useState(0);
  const [syncThrottle, setSyncThrottle] = useState({ statement: { '1m': 3, '2m': 2 }, amazon_pay: { '1m': 3, '2m': 2 } });
  
  const [syncSchedule, setSyncSchedule] = useState(null);

  const [oauthMessage, setOauthMessage] = useState(null);

  useEffect(() => {
    // Handle OAuth redirect result
    const params = new URLSearchParams(window.location.search);
    if (params.get('success') === 'connected') {
      setOauthMessage({ type: 'success', text: `Connected ${params.get('email') || 'account'} successfully! Sync started.` });
      window.history.replaceState({}, '', '/settings');
    } else if (params.get('error')) {
      setOauthMessage({ type: 'error', text: `OAuth failed: ${params.get('error')}` });
      window.history.replaceState({}, '', '/settings');
    }

    Promise.all([fetchAccounts(), fetchCards(), fetchProfile(), fetchSyncJobs(), fetchSyncSchedule(), fetchPendingReviewCount(), fetchSyncThrottle()])
      .finally(() => setLoading(false));
  }, []);

  // Poll sync status every 5 seconds while any sync is running
  useEffect(() => {
    const anySyncing = accounts.some(a => a.sync_running);
    if (!anySyncing) return;

    const interval = setInterval(() => {
      fetchSyncJobs();
      fetchAccounts();
      fetchPendingReviewCount();
      fetchSyncThrottle();
    }, 5000);

    return () => clearInterval(interval);
  }, [accounts]);

  async function fetchAccounts() {
    const res = await fetch('/api/settings/email-accounts');
    if (res.ok) setAccounts(await res.json());
  }

  async function fetchCards() {
    const res = await fetch('/api/settings/cards');
    if (res.ok) setCards(await res.json());
  }

  async function fetchProfile() {
    const res = await fetch('/api/settings/profile');
    if (res.ok) setProfile(await res.json());
  }

  async function saveProfile(updated) {
    const res = await fetch('/api/settings/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
    if (res.ok) setProfile(await res.json());
  }

  async function fetchSyncJobs() {
    const res = await fetch('/api/settings/sync-jobs');
    if (res.ok) setSyncJobs(await res.json());
  }

  async function fetchPendingReviewCount() {
    const res = await fetch('/api/upload/files?status=pending');
    if (res.ok) {
      const files = await res.json();
      setPendingReviewCount(files.filter(f => f.source_type === 'email').length);
    }
  }

  async function fetchSyncThrottle() {
    const res = await fetch('/api/settings/sync-throttle');
    if (res.ok) setSyncThrottle(await res.json());
  }

  async function fetchSyncSchedule() {
    const res = await fetch('/api/settings/sync-schedule');
    if (res.ok) setSyncSchedule(await res.json());
  }

  function deleteAccount(id) {
    const account = accounts.find(a => a.id === id);
    setConfirmModal({
      title: 'Disconnect Email Account',
      message: `Are you sure you want to disconnect ${account?.email || 'this account'}? All sync history for this account will be removed.`,
      confirmLabel: 'Disconnect',
      danger: true,
      onConfirm: async () => {
        const res = await fetch(`/api/settings/email-accounts/${id}`, { method: 'DELETE' });
        if (res.ok) {
          setAccounts(a => a.filter(x => x.id !== id));
          fetchSyncJobs();
        }
        setConfirmModal(null);
      },
    });
  }

  async function triggerSync(id, period) {
    if (cards.length === 0) {
      setConfirmModal({
        title: 'Card Details Required',
        message: 'Please add at least one card before syncing statements. Card details are used to generate passwords for unlocking encrypted PDF statements.',
        confirmLabel: 'Add Card',
        onConfirm: () => { setConfirmModal(null); setShowAddCard(true); },
      });
      return;
    }
    const res = await fetch(`/api/settings/email-accounts/${id}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(period ? { period } : {}),
    });
    if (res.status === 429) {
      const data = await res.json();
      setConfirmModal({ title: 'Limit Reached', message: data.error, confirmLabel: 'OK', onConfirm: () => setConfirmModal(null) });
      return;
    }
    fetchAccounts();
    fetchSyncJobs();
    fetchSyncThrottle();
    // Re-fetch after a short delay to catch the running state
    setTimeout(() => { fetchAccounts(); fetchSyncJobs(); }, 1000);
  }

  function deleteCard(id) {
    const card = cards.find(c => c.id === id);
    setConfirmModal({
      title: 'Remove Card',
      message: `Remove ${card?.bank || ''} card ending in ${card?.card_number?.slice(-4) || '****'}?`,
      confirmLabel: 'Remove',
      danger: true,
      onConfirm: async () => {
        const res = await fetch(`/api/settings/cards/${id}`, { method: 'DELETE' });
        if (res.ok) setCards(c => c.filter(x => x.id !== id));
        setConfirmModal(null);
      },
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-3 rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in-up">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>Settings</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Connect email accounts, cards, and profile for auto-unlock</p>
      </div>

      {oauthMessage && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg" style={{
          background: oauthMessage.type === 'success' ? 'var(--success-soft)' : 'var(--danger-soft)',
          border: '1px solid var(--border)',
        }}>
          <span className="text-sm" style={{ color: oauthMessage.type === 'success' ? 'var(--success)' : 'var(--danger)' }}>
            {oauthMessage.text}
          </span>
          <button onClick={() => setOauthMessage(null)} className="ml-auto p-1 rounded hover:bg-[var(--surface)]" title="Dismiss this notification">
            <svg className="w-4 h-4" style={{ color: 'var(--text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Sync Schedule Info */}
      {syncSchedule && (syncSchedule.statement_sync.enabled || syncSchedule.amazon_pay_sync.enabled) && (
        <div className="flex items-center gap-4 flex-wrap px-4 py-3 rounded-xl" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
          <svg className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          <div className="flex items-center gap-4 flex-wrap text-xs">
            {syncSchedule.statement_sync.enabled && (
              <span style={{ color: 'var(--text-secondary)' }}>
                <span style={{ color: 'var(--purple)' }} className="font-semibold">Statement sync</span>{' — '}
                {syncSchedule.statement_sync.schedule}, next at{' '}
                <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {new Date(syncSchedule.statement_sync.next_at).toLocaleString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, day: 'numeric', month: 'short' })}
                </span>
              </span>
            )}
            {syncSchedule.amazon_pay_sync.enabled && (
              <span style={{ color: 'var(--text-secondary)' }}>
                <span style={{ color: 'var(--amber)' }} className="font-semibold">Amazon Pay sync</span>{' — '}
                {syncSchedule.amazon_pay_sync.schedule}, next at{' '}
                <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {new Date(syncSchedule.amazon_pay_sync.next_at).toLocaleString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, day: 'numeric', month: 'short' })}
                </span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Email Accounts Section */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Email Accounts</h2>
          <div className="flex items-center gap-2">
            <GoogleSignInButton />
            <button onClick={() => setShowAddEmail(true)} className="btn-secondary text-sm" title="Connect an email account using manual IMAP settings">
              Manual IMAP
            </button>
          </div>
        </div>

        {accounts.length === 0 ? (
          <div className="card p-8 text-center">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--empty-icon-bg)' }}>
              <svg className="w-7 h-7" style={{ color: 'var(--empty-icon-color)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
              </svg>
            </div>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No email accounts connected yet</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Connect your email to auto-fetch bank statements</p>
          </div>
        ) : (
          <div className="card">
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {accounts.map(a => (
                <div key={a.id} className="px-4 py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{a.email}</p>
                      <StatusBadge status={a.status} />
                      {a.sync_running && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                          SYNCING
                        </span>
                      )}
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {a.auth_type === 'oauth' ? 'Google OAuth' : `${a.imap_host}:${a.imap_port}`}
                      {a.last_sync_at && ` · Last synced ${formatRelative(a.last_sync_at)}`}
                    </p>
                    {a.error_message && (
                      <p className="text-xs mt-0.5" style={{ color: 'var(--danger)' }}>{a.error_message}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <AmazonPaySyncButton account={a} onRefresh={() => { fetchAccounts(); fetchSyncJobs(); fetchSyncThrottle(); }} throttle={syncThrottle.amazon_pay} />
                    <SyncButton accountId={a.id} disabled={a.sync_running} onSync={triggerSync} throttle={syncThrottle.statement} />
                    <button onClick={() => deleteAccount(a.id)}
                      className="p-1.5 rounded-lg hover:bg-[var(--surface)] transition-colors" title="Disconnect and remove this email account">
                      <svg className="w-4 h-4" style={{ color: 'var(--danger)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* User Profile Section */}
      <section>
        <div className="mb-3">
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Your Profile</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Used to generate passwords for unlocking encrypted statements
          </p>
        </div>
        <ProfileSection profile={profile} onSave={saveProfile} />
      </section>

      {/* Cards Section */}
      <section>
        {cards.length === 0 && accounts.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-3 mb-3 rounded-lg" style={{ background: 'var(--amber-soft)', border: '1px solid var(--border)' }}>
            <svg className="w-4 h-4 shrink-0" style={{ color: 'var(--amber)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            <p className="text-sm italic" style={{ color: 'var(--amber)' }}>
              Add at least one card to enable statement sync. Card details are needed to unlock encrypted PDF statements.
            </p>
          </div>
        )}
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Cards</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Add your credit/debit cards to auto-unlock PDF statements
            </p>
          </div>
          <button onClick={() => setShowAddCard(true)} className="btn-primary text-sm">
            + Add Card
          </button>
        </div>

        {cards.length === 0 ? (
          <div className="card p-8 text-center">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--empty-icon-bg)' }}>
              <svg className="w-7 h-7" style={{ color: 'var(--empty-icon-color)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
              </svg>
            </div>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No cards added yet</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Add your card details to auto-unlock statement PDFs</p>
          </div>
        ) : (
          <div className="card">
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {cards.map(c => (
                <div key={c.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{c.bank}</span>
                    <span className="text-sm ml-3" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      •••• •••• •••• {c.card_number.slice(-4)}
                    </span>
                  </div>
                  <button onClick={() => deleteCard(c.id)}
                    className="p-1.5 rounded-lg hover:bg-[var(--surface)] transition-colors" title="Remove card">
                    <svg className="w-4 h-4" style={{ color: 'var(--danger)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Sync History */}
      {pendingReviewCount > 0 && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg" style={{ background: 'var(--amber-soft)', border: '1px solid var(--border)' }}>
          <svg className="w-4 h-4 shrink-0" style={{ color: 'var(--amber)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
          <p className="text-sm italic" style={{ color: 'var(--amber)' }}>
            {pendingReviewCount} file{pendingReviewCount > 1 ? 's' : ''} pending review — please review and import or skip them in the <a href="/upload" className="underline font-medium">Upload</a> section.
          </p>
        </div>
      )}
      {syncJobs.length > 0 && (
        <SyncHistorySection syncJobs={syncJobs} />
      )}

      {/* Add Email Modal */}
      {showAddEmail && (
        <AddEmailModal
          onClose={() => setShowAddEmail(false)}
          onAdded={() => { fetchAccounts(); setShowAddEmail(false); setTimeout(fetchSyncJobs, 3000); }}
        />
      )}

      {/* Add Card Modal */}
      {showAddCard && (
        <AddCardModal
          onClose={() => setShowAddCard(false)}
          onAdded={() => { fetchCards(); setShowAddCard(false); }}
        />
      )}

      {/* Confirm Modal */}
      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          danger={confirmModal.danger}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}
    </div>
  );
}

function ConfirmModal({ title, message, confirmLabel, danger, onConfirm, onCancel }) {
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    await onConfirm();
    setLoading(false);
  }

  return (
    <Modal open={true} onClose={onCancel}>
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
        style={{ background: danger ? 'var(--danger-soft)' : 'var(--amber-soft)' }}>
        <svg className="w-7 h-7" style={{ color: danger ? 'var(--danger)' : 'var(--amber)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
        </svg>
      </div>
      <h2 className="text-lg font-bold text-center" style={{ color: 'var(--text-primary)' }}>{title}</h2>
      <p className="text-sm mt-2 text-center" style={{ color: 'var(--text-secondary)' }}>{message}</p>
      <div className="flex gap-2 mt-6">
        <button onClick={onCancel} className="btn-secondary flex-1">Cancel</button>
        <button
          onClick={handleConfirm}
          disabled={loading}
          className="flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{
            background: danger ? 'var(--danger)' : 'var(--accent)',
            color: 'white',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? 'Please wait...' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

function SyncHistorySection({ syncJobs }) {
  const [selectedJob, setSelectedJob] = useState(null);
  const [jobResults, setJobResults] = useState([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const [showColPicker, setShowColPicker] = useState(false);

  const allColumns = [
    { key: 'account', label: 'Account', width: '1fr', required: true },
    { key: 'type', label: 'Type', width: '90px' },
    { key: 'trigger', label: 'Trigger', width: '70px' },
    { key: 'period', label: 'Period', width: '80px' },
    { key: 'status', label: 'Status', width: '90px' },
    { key: 'found', label: 'Found', width: '60px' },
    { key: 'imported', label: 'Imported', width: '80px' },
    { key: 'skipped', label: 'Skipped', width: '60px' },
    { key: 'date', label: 'Date', width: '140px', required: true },
  ];

  const [visibleCols, setVisibleCols] = useState(() => {
    try {
      const saved = localStorage.getItem('syncHistoryCols');
      if (saved) return JSON.parse(saved);
    } catch {}
    return allColumns.map(c => c.key);
  });

  function toggleColumn(key) {
    const col = allColumns.find(c => c.key === key);
    if (col?.required) return;
    const next = visibleCols.includes(key)
      ? visibleCols.filter(k => k !== key)
      : [...visibleCols, key];
    setVisibleCols(next);
    localStorage.setItem('syncHistoryCols', JSON.stringify(next));
  }

  const cols = allColumns.filter(c => visibleCols.includes(c.key));
  const gridTemplate = cols.map(c => c.width).join('_');

  function closeDetail() { setSelectedJob(null); setJobResults([]); }

  async function openJobDetail(job) {
    setSelectedJob(job);
    setLoadingResults(true);
    try {
      const res = await fetch(`/api/settings/sync-jobs/${job.id}/results`);
      if (res.ok) setJobResults(await res.json());
    } finally {
      setLoadingResults(false);
    }
  }

  function renderCell(col, j) {
    switch (col.key) {
      case 'account':
        return <span className="text-sm truncate font-medium" style={{ color: 'var(--text-secondary)' }}>{j.email}</span>;
      case 'type':
        return (
          <div className="flex justify-center">
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{
              background: j.sync_type === 'amazon_pay' ? 'var(--amber-soft)' : 'var(--purple-soft)',
              color: j.sync_type === 'amazon_pay' ? 'var(--amber)' : 'var(--purple)',
            }}>
              {j.sync_type === 'amazon_pay' ? 'AMAZON PAY' : 'STATEMENT'}
            </span>
          </div>
        );
      case 'trigger':
        return (
          <div className="flex justify-center">
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{
              background: j.trigger_type === 'manual' ? 'var(--accent-soft)' : 'var(--surface)',
              color: j.trigger_type === 'manual' ? 'var(--accent)' : 'var(--text-muted)',
              border: '1px solid var(--border)',
            }}>
              {j.trigger_type === 'manual' ? 'MANUAL' : 'AUTO'}
            </span>
          </div>
        );
      case 'period':
        return <span className="text-xs text-center" style={{ color: 'var(--text-secondary)' }}>{formatSyncPeriod(j.sync_period)}</span>;
      case 'status':
        return <div className="flex justify-center"><StatusBadge status={j.status} /></div>;
      case 'found':
        return <span className="text-xs text-center tabular-nums" style={{ color: 'var(--text-secondary)' }}>{j.total_attachments}</span>;
      case 'imported':
        return <span className="text-xs text-center tabular-nums" style={{ color: 'var(--success)' }}>{j.imported_transactions || 0}</span>;
      case 'skipped':
        return <span className="text-xs text-center tabular-nums" style={{ color: j.failed_attachments > 0 ? 'var(--amber)' : 'var(--text-muted)' }}>{j.failed_attachments || 0}</span>;
      case 'date':
        return (
          <span className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
            {j.completed_at
              ? new Date(j.completed_at.replace(' ', 'T')).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
              : j.started_at ? 'In progress' : 'Pending'}
          </span>
        );
      default: return null;
    }
  }

  const gridStyle = { gridTemplateColumns: cols.map(c => c.width).join(' ') };

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Sync History</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Double-click a row to see file details</p>
        </div>
        <div className="relative">
          <button
            onClick={() => setShowColPicker(v => !v)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ background: 'var(--surface)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
            title="Show/hide columns"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
            Columns
          </button>
          {showColPicker && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowColPicker(false)} />
              <div className="absolute right-0 top-full mt-1 z-50 w-40 rounded-lg shadow-lg py-1"
                style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
                {allColumns.map(col => (
                  <label key={col.key} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-[var(--surface)] transition-colors">
                    <input
                      type="checkbox"
                      checked={visibleCols.includes(col.key)}
                      disabled={col.required}
                      onChange={() => toggleColumn(col.key)}
                      className="w-3.5 h-3.5 rounded accent-[var(--accent)]"
                    />
                    <span className="text-xs" style={{ color: col.required ? 'var(--text-muted)' : 'var(--text-primary)' }}>{col.label}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="card overflow-hidden">
        <div className="grid gap-2 px-4 py-3 border-b text-[11px] font-bold uppercase tracking-widest text-center"
          style={{ ...gridStyle, borderColor: 'var(--border)', color: 'var(--text-secondary)', background: 'var(--surface)', letterSpacing: '0.08em' }}>
          {cols.map(c => <span key={c.key}>{c.label}</span>)}
        </div>
        <div className="transaction-rows overflow-y-auto" style={{ maxHeight: '400px' }}>
          {syncJobs.map((j, idx) => {
            const rowBg = idx % 2 === 1 ? 'var(--row-stripe)' : 'transparent';
            return (
            <div key={j.id}
              className="grid gap-2 px-4 py-3 items-center cursor-pointer transition-colors"
              style={{ ...gridStyle, background: rowBg }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--table-row-hover)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = rowBg; }}
              onDoubleClick={() => openJobDetail(j)}
            >
              {cols.map(c => <div key={c.key}>{renderCell(c, j)}</div>)}
            </div>
            );
          })}
        </div>
      </div>

      {/* Sync Job Detail Modal */}
      <Modal open={!!selectedJob} onClose={closeDetail}>
        {selectedJob && (<>
          <button onClick={closeDetail} className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-[var(--surface)] transition-colors" title="Close">
            <svg className="w-5 h-5" style={{ color: 'var(--text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>

          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            {selectedJob.sync_type === 'amazon_pay' ? 'Amazon Pay Sync' : 'Statement Sync'} Details
          </h2>
          <p className="text-xs mt-0.5 mb-4" style={{ color: 'var(--text-muted)' }}>
            {selectedJob.email} · {selectedJob.trigger_type === 'cron' ? 'Auto' : 'Manual'} · {selectedJob.completed_at ? formatRelative(selectedJob.completed_at) : 'In progress'}
          </p>

          {loadingResults ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
            </div>
          ) : jobResults.length === 0 ? (
            <p className="text-sm py-6 text-center" style={{ color: 'var(--text-muted)' }}>
              {selectedJob.sync_type === 'amazon_pay' ? 'No transactions found in this sync.' : 'No files processed in this sync.'}
            </p>
          ) : selectedJob.sync_type === 'amazon_pay' ? (
            <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
              {jobResults.map(r => (
                <div key={r.id} className="flex items-center gap-3 px-3 py-2 rounded-lg group" style={{ background: 'var(--surface)' }}>
                  <div className="shrink-0">
                    {r.status === 'success' ? (
                      <svg className="w-4 h-4" style={{ color: 'var(--success)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                    ) : r.status === 'skipped' ? (
                      <svg className="w-4 h-4" style={{ color: 'var(--amber)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" style={{ color: 'var(--danger)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{r.filename}</p>
                  </div>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0"
                    style={{
                      background: r.status === 'success' ? 'var(--success-soft)' : r.status === 'skipped' ? 'var(--amber-soft)' : 'var(--surface)',
                      color: r.status === 'success' ? 'var(--success)' : r.status === 'skipped' ? 'var(--amber)' : 'var(--text-muted)',
                      border: r.status === 'success' ? undefined : '1px solid var(--border)',
                    }}>
                    {r.status === 'success' ? 'IMPORTED' : r.status === 'skipped' ? 'DUPLICATE' : r.status.toUpperCase()}
                  </span>
                  <button
                    onClick={async () => {
                      if (!confirm(`Delete this transaction?\n\n${r.filename}\n\nThis will also remove it from your voucher balance.`)) return;
                      await fetch(`/api/settings/sync-results/${r.id}`, { method: 'DELETE' });
                      setJobResults(prev => prev.filter(x => x.id !== r.id));
                    }}
                    className="p-1.5 rounded-lg transition-colors shrink-0"
                    style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
                    title="Delete this transaction and revert voucher balance"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {jobResults.map(r => (
                <div key={r.id} className="flex items-start gap-3 px-3 py-2.5 rounded-lg" style={{ background: 'var(--surface)' }}>
                  <div className="mt-0.5">
                    {r.status === 'success' ? (
                      <svg className="w-4 h-4" style={{ color: 'var(--success)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" style={{ color: 'var(--danger)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{r.filename}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                        style={{
                          background: r.status === 'success' ? 'var(--success-soft)' : 'var(--danger-soft)',
                          color: r.status === 'success' ? 'var(--success)' : 'var(--danger)',
                        }}>
                        {r.status === 'success' ? 'SUCCESS' : r.status === 'password_failed' ? 'PASSWORD FAILED' : 'PARSE FAILED'}
                      </span>
                      {r.status === 'success' && (
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.transactions_imported} transactions</span>
                      )}
                    </div>
                    {r.error_message && (
                      <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>{r.error_message}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
            <button onClick={closeDetail} className="btn-secondary w-full" title="Close sync details">Close</button>
          </div>
        </>)}
      </Modal>
    </section>
  );
}

function AddEmailModal({ onClose, onAdded }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState('993');
  const [showImapFields, setShowImapFields] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const body = { email, password };
      if (showImapFields && imapHost) {
        body.imap_host = imapHost;
        body.imap_port = parseInt(imapPort) || 993;
      }

      const res = await fetch('/api/settings/email-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.needs_imap) {
          setShowImapFields(true);
          setError('Could not detect IMAP settings. Please enter them manually.');
        } else {
          setError(data.error);
        }
        return;
      }

      onAdded();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={true} onClose={onClose}>
      <button onClick={onClose} className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-[var(--surface)] transition-colors" title="Close">
        <svg className="w-5 h-5" style={{ color: 'var(--text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>

      <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Connect Email Account</h2>
      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
        For Gmail, use an App Password (not your regular password).
        Enable IMAP in your email settings first.
      </p>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        {error && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'var(--danger-soft)', border: '1px solid var(--border)' }}>
            <svg className="w-4 h-4 shrink-0" style={{ color: 'var(--danger)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            <span className="text-xs" style={{ color: 'var(--danger)' }}>{error}</span>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Email Address</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@gmail.com"
            required
            autoFocus
            className="input-field"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Password / App Password</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="App password for Gmail"
              required
              className="input-field pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(v => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-[var(--surface)] transition-colors"
              tabIndex={-1}
            >
              <svg className="w-4 h-4" style={{ color: 'var(--text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                {showPassword ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                ) : (
                  <>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                  </>
                )}
              </svg>
            </button>
          </div>
        </div>

        {showImapFields && (
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>IMAP Host</label>
              <input
                type="text"
                value={imapHost}
                onChange={e => setImapHost(e.target.value)}
                placeholder="imap.example.com"
                required
                className="input-field"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Port</label>
              <input
                type="number"
                value={imapPort}
                onChange={e => setImapPort(e.target.value)}
                className="input-field"
              />
            </div>
          </div>
        )}

        {!showImapFields && (
          <button type="button" onClick={() => setShowImapFields(true)} className="text-xs underline" style={{ color: 'var(--accent)' }} title="Show IMAP host and port fields for manual configuration">
            Configure IMAP manually
          </button>
        )}

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1" title="Cancel without adding account">Cancel</button>
          <button type="submit" disabled={loading} className="btn-primary flex-1 justify-center" title="Connect this email account and start fetching statements">
            {loading ? 'Connecting...' : 'Connect & Sync'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AddCardModal({ onClose, onAdded }) {
  const [bank, setBank] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function formatCardInput(value) {
    const digits = value.replace(/\D/g, '').slice(0, 16);
    return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const digits = cardNumber.replace(/\s/g, '');
    if (digits.length !== 16) {
      setError('Card number must be 16 digits');
      return;
    }
    setLoading(true);

    try {
      const res = await fetch('/api/settings/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bank, card_number: digits }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error);
        return;
      }

      onAdded();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={true} onClose={onClose}>
      <button onClick={onClose} className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-[var(--surface)] transition-colors" title="Close">
        <svg className="w-5 h-5" style={{ color: 'var(--text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>

      <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Add Card</h2>
      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
        Card details are used to generate passwords for unlocking PDF statements.
      </p>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        {error && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'var(--danger-soft)', border: '1px solid var(--border)' }}>
            <span className="text-xs" style={{ color: 'var(--danger)' }}>{error}</span>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Bank Name</label>
          <input
            type="text"
            value={bank}
            onChange={e => setBank(e.target.value)}
            placeholder="e.g., HDFC, ICICI, SBI, Axis"
            required
            autoFocus
            className="input-field"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Card Number (16 digits)</label>
          <input
            type="text"
            value={cardNumber}
            onChange={e => setCardNumber(formatCardInput(e.target.value))}
            placeholder="1234 5678 9012 3456"
            required
            className="input-field"
            style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}
            maxLength={19}
          />
        </div>

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button type="submit" disabled={loading} className="btn-primary flex-1 justify-center">
            {loading ? 'Saving...' : 'Add Card'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ProfileSection({ profile, onSave }) {
  const [name, setName] = useState(profile.name || '');
  const [dob, setDob] = useState(profile.dob || '');
  const [pan, setPan] = useState(profile.pan || '');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setName(profile.name || '');
    setDob(profile.dob || '');
    setPan(profile.pan || '');
  }, [profile]);

  function handleSave() {
    onSave({ name, dob, pan });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const hasChanges = name !== (profile.name || '') || dob !== (profile.dob || '') || pan !== (profile.pan || '');

  return (
    <div className="card p-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Your full name"
            className="input-field"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Date of Birth</label>
          <input
            type="date"
            value={dob}
            onChange={e => setDob(e.target.value)}
            className="input-field"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>PAN Number</label>
          <input
            type="text"
            value={pan}
            onChange={e => setPan(e.target.value.toUpperCase())}
            placeholder="ABCDE1234F"
            maxLength={10}
            className="input-field"
            style={{ fontFamily: 'var(--font-mono)' }}
          />
        </div>
      </div>
      {hasChanges && (
        <div className="flex justify-end mt-4">
          <button onClick={handleSave} className="btn-primary text-sm">
            Save Profile
          </button>
        </div>
      )}
      {saved && (
        <p className="text-xs mt-2 text-right" style={{ color: 'var(--success)' }}>Profile saved</p>
      )}
    </div>
  );
}

function AmazonPaySyncButton({ account, onRefresh, throttle }) {
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  async function handleToggle() {
    setLoading(true);
    try {
      await fetch(`/api/settings/email-accounts/${account.id}/amazon-pay-sync`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !account.amazon_pay_sync }),
      });
      onRefresh();
    } finally {
      setLoading(false);
    }
  }

  async function handleSync(period) {
    setOpen(false);
    await fetch(`/api/settings/email-accounts/${account.id}/sync-amazon-pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(period ? { period } : {}),
    });
    onRefresh();
  }

  const periods = [
    { key: null, label: 'Since last sync' },
    { key: '1w', label: 'Last 1 week' },
    { key: '1m', label: 'Last 1 month', limit: true },
    { key: '2m', label: 'Last 2 months', limit: true },
  ];

  if (!account.amazon_pay_sync) {
    return (
      <button
        onClick={handleToggle}
        disabled={loading}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors"
        style={{ background: 'var(--surface)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
        title="Enable Amazon Pay transaction sync from this email"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
        </svg>
        Amazon Pay
      </button>
    );
  }

  return (
    <div className="relative flex items-center gap-1">
      <div className="relative">
        <button
          onClick={() => setOpen(v => !v)}
          disabled={account.amazon_pay_sync_running}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--border)' }}
          title="Sync Amazon Pay transactions"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          Amazon Pay
          {account.amazon_pay_sync_running && (
            <span className="text-[9px] font-semibold px-1 py-0.5 rounded" style={{ background: 'var(--amber-soft)', color: 'var(--amber)' }}>
              SYNCING
            </span>
          )}
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-lg shadow-lg"
              style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
              {periods.map(p => {
                const remaining = p.limit && throttle ? throttle[p.key] : null;
                const exhausted = remaining !== null && remaining <= 0;
                return (
                  <button
                    key={p.key || 'default'}
                    onClick={() => !exhausted && handleSync(p.key)}
                    disabled={exhausted}
                    className="w-full text-left px-3 py-2 text-sm transition-colors hover:bg-[var(--surface)] flex items-center justify-between"
                    style={{ color: exhausted ? 'var(--text-muted)' : 'var(--text-primary)', opacity: exhausted ? 0.5 : 1 }}
                  >
                    <span>{p.label}</span>
                    {remaining !== null && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{
                        background: remaining > 0 ? 'var(--accent-soft)' : 'var(--danger-soft)',
                        color: remaining > 0 ? 'var(--accent)' : 'var(--danger)',
                      }}>{remaining} left</span>
                    )}
                  </button>
                );
              })}
              <div className="border-t" style={{ borderColor: 'var(--border)' }}>
                <button
                  onClick={handleToggle}
                  className="w-full text-left px-3 py-2 text-sm transition-colors hover:bg-[var(--surface)]"
                  style={{ color: 'var(--danger)' }}
                >
                  Disable Amazon Pay sync
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SyncButton({ accountId, disabled, onSync, throttle }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const periods = [
    { key: null, label: 'Since last sync' },
    { key: '1w', label: 'Last 1 week' },
    { key: '1m', label: 'Last 1 month', limit: true },
    { key: '2m', label: 'Last 2 months', limit: true },
  ];

  function handleSelect(period) {
    setOpen(false);
    onSync(accountId, period);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        disabled={disabled}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors"
        style={{ background: 'var(--purple-soft)', color: 'var(--purple)', border: '1px solid var(--border)' }}
        title="Sync credit card statements"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
        </svg>
        Statements
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-lg shadow-lg"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
          {periods.map(p => {
            const remaining = p.limit && throttle ? throttle[p.key] : null;
            const exhausted = remaining !== null && remaining <= 0;
            return (
              <button
                key={p.key || 'default'}
                onClick={() => !exhausted && handleSelect(p.key)}
                disabled={exhausted}
                className="w-full text-left px-3 py-2 text-sm transition-colors hover:bg-[var(--surface)] flex items-center justify-between"
                style={{ color: exhausted ? 'var(--text-muted)' : 'var(--text-primary)', opacity: exhausted ? 0.5 : 1 }}
              >
                <span>{p.label}</span>
                {remaining !== null && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{
                    background: remaining > 0 ? 'var(--accent-soft)' : 'var(--danger-soft)',
                    color: remaining > 0 ? 'var(--accent)' : 'var(--danger)',
                  }}>{remaining} left</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GoogleSignInButton() {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const res = await fetch('/api/settings/oauth/google/url');
      const { url } = await res.json();
      window.location.href = url;
    } catch {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all border"
      style={{
        background: 'var(--card)',
        borderColor: 'var(--border)',
        color: 'var(--text-primary)',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'}
      onMouseLeave={e => e.currentTarget.style.background = 'var(--card)'}
      title="Connect your Google account via OAuth to auto-fetch statements"
    >
      <svg className="w-4 h-4" viewBox="0 0 24 24">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
      </svg>
      {loading ? 'Redirecting...' : 'Sign in with Google'}
    </button>
  );
}

function StatusBadge({ status }) {
  const styles = {
    connected: { bg: 'var(--success-soft)', color: 'var(--success)' },
    completed: { bg: 'var(--success-soft)', color: 'var(--success)' },
    disconnected: { bg: 'var(--surface)', color: 'var(--text-muted)' },
    error: { bg: 'var(--danger-soft)', color: 'var(--danger)' },
    failed: { bg: 'var(--danger-soft)', color: 'var(--danger)' },
    running: { bg: 'var(--accent-soft)', color: 'var(--accent)' },
    pending: { bg: 'var(--amber-soft)', color: 'var(--amber)' },
  };
  const s = styles[status] || styles.disconnected;
  return (
    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: s.bg, color: s.color }}>
      {status.toUpperCase()}
    </span>
  );
}

function formatSyncPeriod(period) {
  if (!period) return 'Since last';
  const labels = { '1w': '1 week', '1m': '1 month', '2m': '2 months' };
  return labels[period] || period;
}

function formatRelative(dateStr) {
  const d = new Date(dateStr.replace(' ', 'T'));
  const now = new Date();
  const diff = now - d;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
}
