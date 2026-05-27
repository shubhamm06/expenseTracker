import confetti from "canvas-confetti";
import { useState, useRef, useEffect } from 'react';
import Modal from '../components/Modal';

export default function Upload() {
  const [step, setStep] = useState('upload');
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({ date: '', description: '', amount: '', type: '', debit_amount: '', credit_amount: '' });
  const [source, setSource] = useState('');
  const [result, setResult] = useState(null);
  const [useSeparateAmountCols, setUseSeparateAmountCols] = useState(false);
  const [pdfFilePath, setPdfFilePath] = useState('');
  const [fileId, setFileId] = useState(null);
  const [publicId, setPublicId] = useState(null);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [pdfTransactions, setPdfTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [showPassword, setShowPassword] = useState(false);
  const [reviewFile, setReviewFile] = useState(null);
  const [reviewTransactions, setReviewTransactions] = useState([]);
  const [reviewSource, setReviewSource] = useState('');
  const [reviewLoading, setReviewLoading] = useState(false);
  const [historyFilter, setHistoryFilter] = useState({ limit: '100', fromDate: '', toDate: '', status: '' });
  const [showFilters, setShowFilters] = useState(false);
  const [pdfSelected, setPdfSelected] = useState(new Set());
  const [reviewSelected, setReviewSelected] = useState(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [errorModal, setErrorModal] = useState(null);
  const [expandedSkipped, setExpandedSkipped] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => { fetchUploadedFiles(); }, []);

  useEffect(() => {
    return () => {
      setStep('upload');
      setResult(null);
      setReviewFile(null);
    };
  }, []);

  useEffect(() => {
    function handleEsc(e) {
      if (e.key !== 'Escape') return;
      if (deleteConfirm) setDeleteConfirm(null);
      else if (reviewFile) { setReviewFile(null); setReviewTransactions([]); }
      else if (step === 'done') reset();
      else if (step === 'password') dismissModal('Password not provided');
      else if (step === 'pdf-preview') dismissModal('Import cancelled');
      else if (step === 'mapping') dismissModal('Import cancelled');
    }
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  });

  async function fetchUploadedFiles(filters) {
    const f = filters || historyFilter;
    const params = new URLSearchParams();
    if (f.limit) params.set('limit', f.limit);
    if (f.fromDate) params.set('from_date', f.fromDate);
    if (f.toDate) params.set('to_date', f.toDate);
    if (f.status) params.set('status', f.status);
    const res = await fetch(`/api/upload/files?${params.toString()}`);
    if (res.ok) setUploadedFiles(await res.json());
  }

  function applyFilters() {
    fetchUploadedFiles(historyFilter);
  }

  function clearFilters() {
    const cleared = { limit: '100', fromDate: '', toDate: '', status: '' };
    setHistoryFilter(cleared);
    fetchUploadedFiles(cleared);
  }

  function deleteFile(id) {
    setDeleteConfirm(id);
  }

  async function confirmDelete() {
    const id = deleteConfirm;
    setDeleteConfirm(null);
    const res = await fetch(`/api/upload/files/${id}`, { method: 'DELETE' });
    if (res.ok) setUploadedFiles(files => files.filter(f => f.id !== id));
  }

  async function openReview(file) {
    setReviewFile(file);
    setReviewLoading(true);
    try {
      const res = await fetch(`/api/upload/files/${file.id}/transactions`);
      const data = await res.json();
      const txns = data.transactions || [];
      setReviewTransactions(txns);
      setReviewSelected(new Set(txns.map((_, i) => i)));
      setReviewSource(data.source || '');
    } finally {
      setReviewLoading(false);
    }
  }

  async function handleReviewImport() {
    setReviewLoading(true);
    try {
      const selected = reviewTransactions.filter((_, i) => reviewSelected.has(i));
      const res = await fetch('/api/upload/pdf-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: selected, source: reviewSource, file_id: reviewFile.id }),
      });
      const data = await res.json();
      setResult(data);
      setReviewFile(null);
      setReviewTransactions([]);
      setStep('done'); confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } });
      fetchUploadedFiles();
    } finally {
      setReviewLoading(false);
    }
  }

  async function handleUpload(file) {
    if (!file) return;
    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/upload/preview', { method: 'POST', body: formData });
      const data = await res.json();

      if (res.status === 401 && data.error === 'PASSWORD_REQUIRED') {
        setPdfFilePath(data.file_path);
        setFileId(data.file_id);
        setPublicId(data.public_id);
        setStep('password');
        setLoading(false);
        return;
      }

      if (!res.ok) {
        setErrorModal(data.error || 'Upload failed');
        if (data.file_id) {
          fetch(`/api/upload/files/${data.file_id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'failed', status_message: data.error || 'Upload failed' }),
          });
          fetchUploadedFiles();
        }
        setLoading(false);
        return;
      }

      setFileId(data.file_id);
      setPublicId(data.public_id);
      if (data.type === 'pdf') {
        handlePdfResponse(data);
      } else {
        setPreview(data);
        setStep('mapping');
        autoDetectMapping(data.columns);
      }
      setLoading(false);
    } catch (err) {
      setErrorModal('Upload failed: ' + (err.message || 'Network error'));
      setLoading(false);
    }
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setPasswordError('');

    try {
      const res = await fetch('/api/upload/pdf-unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: pdfFilePath, password, file_id: fileId }),
      });
      const data = await res.json();

      if (res.status === 401) {
        setPasswordError(data.error === 'INVALID_PASSWORD' ? 'Incorrect password. Please try again.' : 'Authentication failed.');
        return;
      }

      if (!res.ok) {
        setPasswordError(data.error || 'Failed to process PDF');
        return;
      }

      handlePdfResponse(data);
    } finally {
      setLoading(false);
    }
  }

  function handlePdfResponse(data) {
    if (data.transactions.length === 0) {
      const msg = data.message || 'Could not extract transactions from this PDF. Try CSV instead.';
      setErrorModal(msg);
      if (fileId) {
        fetch(`/api/upload/files/${fileId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'failed', status_message: msg }),
        }).then(() => fetchUploadedFiles());
      }
      setStep('upload');
      return;
    }
    const txns = data.all_transactions || data.transactions;
    setPdfTransactions(txns);
    setPdfSelected(new Set(txns.map((_, i) => i)));
    if (data.detected_source && !source) {
      setSource(data.detected_source);
    }
    setStep('pdf-preview');
  }

  async function handlePdfImport() {
    setLoading(true);
    try {
      const selected = pdfTransactions.filter((_, i) => pdfSelected.has(i));
      const res = await fetch('/api/upload/pdf-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: selected, source, file_id: fileId }),
      });
      const data = await res.json();
      setResult(data);
      setStep('done'); confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } });
      fetchUploadedFiles();
    } finally {
      setLoading(false);
    }
  }

  function autoDetectMapping(columns) {
    const cols = columns.map(c => c.toLowerCase());
    setMapping({
      date: columns[cols.findIndex(c => c.includes('date') || c.includes('txn'))] || '',
      description: columns[cols.findIndex(c => c.includes('narration') || c.includes('description') || c.includes('particular'))] || '',
      amount: columns[cols.findIndex(c => c === 'amount' || c.includes('transaction amount'))] || '',
      type: columns[cols.findIndex(c => c.includes('dr') || c.includes('type') || c.includes('cr'))] || '',
      debit_amount: columns[cols.findIndex(c => c.includes('debit') || c.includes('withdrawal'))] || '',
      credit_amount: columns[cols.findIndex(c => c.includes('credit') || c.includes('deposit'))] || '',
    });
  }

  async function handleCsvImport() {
    setLoading(true);
    try {
      const importMapping = { date: mapping.date, description: mapping.description };
      if (useSeparateAmountCols) {
        importMapping.debit_amount = mapping.debit_amount;
        importMapping.credit_amount = mapping.credit_amount;
      } else {
        importMapping.amount = mapping.amount;
        if (mapping.type) importMapping.type = mapping.type;
      }

      const res = await fetch('/api/upload/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: preview.file_path, mapping: importMapping, source, file_id: fileId }),
      });
      const data = await res.json();
      setResult(data);
      setStep('done'); confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } });
      fetchUploadedFiles();
    } finally {
      setLoading(false);
    }
  }

  async function dismissModal(message) {
    if (fileId) {
      try {
        await fetch(`/api/upload/files/${fileId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'failed', status_message: message || 'Cancelled by user' }),
        });
        fetchUploadedFiles();
      } catch {}
    }
    reset();
  }

  function reset() {
    setStep('upload');
    setPreview(null);
    setResult(null);
    setPdfTransactions([]);
    setPdfFilePath('');
    setFileId(null);
    setPassword('');
    setPasswordError('');
    setShowPassword(false);
    setSource('');
    setLoading(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  // Modal: Done
  const doneModal = (
    <Modal open={step === 'done' && !!result} onClose={reset}>
      {result && (<>
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--success-soft)' }}>
            <svg className="w-7 h-7" style={{ color: 'var(--success)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Import Complete</h2>
          <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
            Imported <strong>{result.imported}</strong> of {result.total} transactions
          </p>
          {result.duplicates > 0 && (
            <div className="mt-3 text-left">
              <p className="text-xs px-3 py-1.5 rounded-lg" style={{ background: 'var(--amber-soft)', color: 'var(--amber)', border: '1px solid var(--border)' }}>
                {result.duplicates} duplicate{result.duplicates > 1 ? 's' : ''} skipped (already in your records)
              </p>
              {result.skipped && result.skipped.length > 0 && (
                <div className="mt-2 rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ background: 'var(--surface)', color: 'var(--text-muted)' }}>
                    Skipped Transactions
                  </div>
                  <div className="max-h-40 overflow-y-auto divide-y" style={{ borderColor: 'var(--border)' }}>
                    {result.skipped.map((t, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-1.5 text-xs" style={{ background: i % 2 === 1 ? 'var(--row-stripe)' : 'transparent' }}>
                        <div className="flex items-center gap-4 min-w-0">
                          <span className="tabular-nums shrink-0" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{t.date}</span>
                          <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{t.description}</span>
                        </div>
                        <span className="shrink-0 font-semibold tabular-nums ml-2" style={{ fontFamily: 'var(--font-mono)', color: t.type === 'credit' ? 'var(--success)' : 'var(--danger)' }}>
                          {t.type === 'credit' ? '+' : '-'}{formatCurrency(t.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>Categorization rules applied automatically</p>
          <button onClick={reset} className="btn-primary mt-5 w-full" title="Close and return to upload page">Done</button>
        </div>
      </>)}
    </Modal>
  );

  // Modal: Password
  const passwordModal = (
    <Modal open={step === 'password'} onClose={() => dismissModal('Password not provided')}>
      <div className="text-center">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--amber-soft)' }}>
          <svg className="w-7 h-7" style={{ color: 'var(--amber)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
          </svg>
        </div>
        <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>PDF is Password Protected</h2>
        <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
          Usually DOB (DDMMYYYY) or PAN for Indian bank statements
        </p>
      </div>
      <form onSubmit={handlePasswordSubmit} className="mt-5 text-left">
        {passwordError && (
          <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-lg" style={{ background: 'var(--danger-soft)', border: '1px solid var(--border)' }}>
            <svg className="w-4 h-4 shrink-0" style={{ color: 'var(--danger)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            <span className="text-xs" style={{ color: 'var(--danger)' }}>{passwordError}</span>
          </div>
        )}
        <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Password</label>
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Enter PDF password"
            required
            autoFocus
            className="input-field pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword(v => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-[var(--surface)] transition-colors"
            tabIndex={-1}
            title={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? (
              <svg className="w-4 h-4" style={{ color: 'var(--text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
              </svg>
            ) : (
              <svg className="w-4 h-4" style={{ color: 'var(--text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
            )}
          </button>
        </div>
        <div className="flex gap-2 mt-4">
          <button type="button" onClick={() => dismissModal('Password not provided')} className="btn-secondary flex-1" title="Cancel and skip this file">Cancel</button>
          <button type="submit" disabled={loading} className="btn-primary flex-1 justify-center" title="Decrypt the PDF with this password">
            {loading ? 'Unlocking...' : 'Unlock'}
          </button>
        </div>
      </form>
    </Modal>
  );

  // Modal: PDF Preview
  const pdfPreviewModal = (
    <Modal open={step === 'pdf-preview'} onClose={() => dismissModal('Import cancelled')} size="lg">
      <button onClick={() => dismissModal('Import cancelled')} className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-[var(--surface)] transition-colors z-10" title="Close">
        <svg className="w-5 h-5" style={{ color: 'var(--text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
        <h2 className="text-lg font-bold pr-8" style={{ color: 'var(--text-primary)' }}>Review Extracted Transactions</h2>
        <div className="flex items-center gap-3 mt-1 mb-4">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {pdfSelected.size} of {pdfTransactions.length} transactions selected
          </p>
          {publicId && (
            <a
              href={`/api/upload/files/${publicId}/view`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors"
              style={{ background: 'var(--surface)', color: 'var(--accent)', border: '1px solid var(--border)' }}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
              </svg>
              View PDF
            </a>
          )}
        </div>

        <div className="mb-4">
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Source Label</label>
          <input
            type="text"
            value={source}
            onChange={e => setSource(e.target.value)}
            placeholder="e.g., HDFC Credit Card May 2026"
            className="input-field max-w-sm"
          />
        </div>

        <div className="card overflow-hidden mb-4">
          <div className="grid grid-cols-[32px_80px_1fr_100px_64px] gap-2 px-4 py-3 border-b text-xs font-semibold uppercase tracking-wider"
            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)', background: 'var(--surface)' }}>
            <span className="flex items-center">
              <input type="checkbox" checked={pdfSelected.size === pdfTransactions.length} onChange={e => {
                setPdfSelected(e.target.checked ? new Set(pdfTransactions.map((_, i) => i)) : new Set());
              }} className="w-3.5 h-3.5 rounded" style={{ borderColor: 'var(--checkbox-border)' }} />
            </span>
            <span>Date</span>
            <span>Description</span>
            <span className="text-right">Amount</span>
            <span className="text-center">Type</span>
          </div>
          <div className="divide-y max-h-64 overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
            {pdfTransactions.map((t, i) => (
              <div key={i} className="grid grid-cols-[32px_80px_1fr_100px_64px] gap-2 px-4 py-2.5 items-center"
                style={{ opacity: pdfSelected.has(i) ? 1 : 0.5 }}>
                <span className="flex items-center">
                  <input type="checkbox" checked={pdfSelected.has(i)} onChange={() => {
                    setPdfSelected(prev => { const next = new Set(prev); next.has(i) ? next.delete(i) : next.add(i); return next; });
                  }} className="w-3.5 h-3.5 rounded" style={{ borderColor: 'var(--checkbox-border)' }} />
                </span>
                <span className="text-xs tabular-nums" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{t.date}</span>
                <span className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{t.description}</span>
                <span className="text-sm text-right font-semibold tabular-nums"
                  style={{ fontFamily: 'var(--font-mono)', color: t.type === 'credit' ? 'var(--success)' : 'var(--text-primary)' }}>
                  {formatCurrency(t.amount)}
                </span>
                <span className="flex justify-center">
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                    style={{
                      background: t.type === 'credit' ? 'var(--success-soft)' : 'var(--danger-soft)',
                      color: t.type === 'credit' ? 'var(--success)' : 'var(--danger)',
                    }}>
                    {t.type.toUpperCase()}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={() => dismissModal('Import cancelled')} className="btn-secondary">Cancel</button>
          <button onClick={handlePdfImport} disabled={loading || pdfSelected.size === 0} className="btn-primary">
            {loading ? 'Importing...' : `Import ${pdfSelected.size} Transactions`}
          </button>
        </div>
    </Modal>
  );

  // Modal: CSV Mapping
  const csvMappingModal = (
    <Modal open={step === 'mapping' && !!preview} onClose={() => dismissModal('Import cancelled')} size="lg">
      {preview && (<>
        <button onClick={() => dismissModal('Import cancelled')} className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-[var(--surface)] transition-colors z-10" title="Close">
          <svg className="w-5 h-5" style={{ color: 'var(--text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
        <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Map Columns</h2>
        <p className="text-sm mt-0.5 mb-4" style={{ color: 'var(--text-muted)' }}>
          {preview.total_rows} rows found. Map your CSV columns to the expected fields.
        </p>

        <div className="space-y-4 mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Date Column *</label>
              <select value={mapping.date} onChange={e => setMapping(m => ({ ...m, date: e.target.value }))} className="select-field">
                <option value="">Select...</option>
                {preview.columns.map(col => <option key={col} value={col}>{col}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Description Column *</label>
              <select value={mapping.description} onChange={e => setMapping(m => ({ ...m, description: e.target.value }))} className="select-field">
                <option value="">Select...</option>
                {preview.columns.map(col => <option key={col} value={col}>{col}</option>)}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" checked={useSeparateAmountCols} onChange={e => setUseSeparateAmountCols(e.target.checked)} id="sep"
              className="w-4 h-4 rounded" style={{ borderColor: 'var(--checkbox-border)' }} />
            <label htmlFor="sep" className="text-sm" style={{ color: 'var(--text-secondary)' }}>Separate debit/credit columns</label>
          </div>

          {useSeparateAmountCols ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Debit Amount</label>
                <select value={mapping.debit_amount} onChange={e => setMapping(m => ({ ...m, debit_amount: e.target.value }))} className="select-field">
                  <option value="">Select...</option>
                  {preview.columns.map(col => <option key={col} value={col}>{col}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Credit Amount</label>
                <select value={mapping.credit_amount} onChange={e => setMapping(m => ({ ...m, credit_amount: e.target.value }))} className="select-field">
                  <option value="">Select...</option>
                  {preview.columns.map(col => <option key={col} value={col}>{col}</option>)}
                </select>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Amount Column *</label>
                <select value={mapping.amount} onChange={e => setMapping(m => ({ ...m, amount: e.target.value }))} className="select-field">
                  <option value="">Select...</option>
                  {preview.columns.map(col => <option key={col} value={col}>{col}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Type Column (Dr/Cr)</label>
                <select value={mapping.type} onChange={e => setMapping(m => ({ ...m, type: e.target.value }))} className="select-field">
                  <option value="">None</option>
                  {preview.columns.map(col => <option key={col} value={col}>{col}</option>)}
                </select>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Source Label</label>
            <input
              type="text"
              value={source}
              onChange={e => setSource(e.target.value)}
              placeholder="e.g., HDFC Credit Card, ICICI Savings"
              className="input-field max-w-sm"
            />
          </div>
        </div>

        <div className="card overflow-hidden mb-4">
          <div className="px-4 py-2.5 border-b text-xs font-semibold uppercase tracking-wider" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)', background: 'var(--surface)' }}>
            Preview (first 5 rows)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                  {preview.columns.map(col => (
                    <th key={col} className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-muted)' }}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.preview.map((row, i) => (
                  <tr key={i} className="border-b" style={{ borderColor: 'var(--border)' }}>
                    {preview.columns.map(col => (
                      <td key={col} className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>{row[col]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={() => dismissModal('Import cancelled')} className="btn-secondary" title="Cancel import and discard this file">Cancel</button>
          <button
            onClick={handleCsvImport}
            disabled={!mapping.date || !mapping.description || loading}
            className="btn-primary"
            title="Import transactions using the selected column mapping"
          >
            {loading ? 'Importing...' : `Import ${preview.total_rows} Transactions`}
          </button>
        </div>
      </>)}
    </Modal>
  );

  const deleteModal = (
    <Modal open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)}>
      <div className="text-center">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--danger-soft)' }}>
          <svg className="w-7 h-7" style={{ color: 'var(--danger)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
          </svg>
        </div>
        <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Delete File</h2>
        <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
          Are you sure you want to delete this file? This action cannot be undone.
        </p>
        <div className="flex gap-3 mt-5">
          <button onClick={() => setDeleteConfirm(null)} className="btn-secondary flex-1">Cancel</button>
          <button onClick={confirmDelete} className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            style={{ background: 'var(--danger)', color: 'white' }}>
            Delete
          </button>
        </div>
      </div>
    </Modal>
  );

  // Upload (initial) — modals overlay on top
  const errorModalEl = errorModal && (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="card p-6 max-w-sm w-full text-center animate-scale-in relative">
        <button onClick={() => setErrorModal(null)} className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-[var(--surface)] transition-colors" title="Close">
          <svg className="w-5 h-5" style={{ color: 'var(--text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--danger-soft)' }}>
          <svg className="w-7 h-7" style={{ color: 'var(--danger)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
        </div>
        <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Import Failed</h2>
        <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>{errorModal}</p>
        <button onClick={() => setErrorModal(null)} className="btn-primary mt-5 w-full" title="Dismiss error">OK</button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in-up">
      {passwordModal}
      {pdfPreviewModal}
      {csvMappingModal}
      {doneModal}
      {deleteModal}
      {errorModalEl}
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>Upload Statement</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Import bank or credit card statements</p>
      </div>

      <div
        className="card p-12 text-center transition-all duration-200 cursor-pointer"
        style={{
          borderStyle: 'dashed',
          borderWidth: '2px',
          borderColor: dragOver ? 'var(--accent)' : 'var(--border)',
          background: dragOver ? 'var(--accent-soft)' : 'var(--card)',
        }}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleUpload(e.dataTransfer.files[0]); }}
        onClick={() => { if (!loading) fileRef.current?.click(); }}
      >
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--empty-icon-bg)' }}>
          {loading ? (
            <div className="w-7 h-7 border-3 rounded-full animate-spin" style={{ borderColor: 'var(--empty-icon-color)', borderTopColor: 'transparent' }} />
          ) : (
            <svg className="w-7 h-7" style={{ color: 'var(--empty-icon-color)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
            </svg>
          )}
        </div>
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {loading ? 'Processing...' : 'Drop your statement here, or click to browse'}
        </p>
        <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
          CSV and PDF formats supported. Password-protected PDFs will prompt for password.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.pdf"
          className="hidden"
          onChange={e => handleUpload(e.target.files[0])}
        />
      </div>

      {uploadedFiles.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Upload History</h2>
            <button
              onClick={() => setShowFilters(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{ background: showFilters ? 'var(--accent-soft)' : 'var(--surface)', color: showFilters ? 'var(--accent)' : 'var(--text-secondary)', border: '1px solid var(--border)' }}
              title="Filter upload history by date, status, or count"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 0 1-.659 1.591l-5.432 5.432a2.25 2.25 0 0 0-.659 1.591v2.927a2.25 2.25 0 0 1-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 0 0-.659-1.591L3.659 7.409A2.25 2.25 0 0 1 3 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0 1 12 3Z" />
              </svg>
              Filters
            </button>
          </div>

          {showFilters && (
            <div className="card p-4 mb-3 animate-fade-in-up">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Show Last</label>
                  <select
                    value={historyFilter.limit}
                    onChange={e => setHistoryFilter(f => ({ ...f, limit: e.target.value }))}
                    className="select-field text-sm"
                  >
                    <option value="25">25 records</option>
                    <option value="50">50 records</option>
                    <option value="100">100 records</option>
                    <option value="200">200 records</option>
                    <option value="500">All (500 max)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>From Date</label>
                  <input
                    type="date"
                    value={historyFilter.fromDate}
                    onChange={e => setHistoryFilter(f => ({ ...f, fromDate: e.target.value }))}
                    className="input-field text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>To Date</label>
                  <input
                    type="date"
                    value={historyFilter.toDate}
                    onChange={e => setHistoryFilter(f => ({ ...f, toDate: e.target.value }))}
                    className="input-field text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Status</label>
                  <select
                    value={historyFilter.status}
                    onChange={e => setHistoryFilter(f => ({ ...f, status: e.target.value }))}
                    className="select-field text-sm"
                  >
                    <option value="">All Statuses</option>
                    <option value="imported">Imported</option>
                    <option value="pending">Pending</option>
                    <option value="failed">Failed</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={applyFilters} className="btn-primary text-xs px-4 py-1.5" title="Apply the selected filters to upload history">Apply Filters</button>
                <button onClick={clearFilters} className="btn-secondary text-xs px-4 py-1.5" title="Reset all filters to default">Clear</button>
              </div>
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
            <div className="grid grid-cols-[90px_1fr_80px_80px_80px_100px] gap-2 px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-center min-w-[560px]"
              style={{ borderBottom: '2px solid var(--header-divider)', color: 'var(--text-secondary)', background: 'var(--table-header-bg)', letterSpacing: '0.08em' }}>
              <span>Date</span>
              <span>File</span>
              <span>Source</span>
              <span>Status</span>
              <span>Imported</span>
              <span>Actions</span>
            </div>
            <div className="transaction-rows overflow-y-auto min-w-[560px]" style={{ maxHeight: '400px' }}>
              {uploadedFiles.map((f, idx) => {
                const isEmailPending = f.source_type === 'email' && f.status === 'pending';
                return (<div key={f.id}>
                  <div
                    className={`grid grid-cols-[90px_1fr_80px_80px_80px_100px] gap-2 px-4 py-3 items-center transition-colors ${isEmailPending ? 'cursor-pointer' : ''}`}
                    style={{
                      background: isEmailPending ? 'var(--accent-soft)' : (idx % 2 === 1 ? 'var(--row-stripe)' : 'transparent'),
                      borderLeft: isEmailPending ? '3px solid var(--accent)' : '3px solid transparent',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = isEmailPending ? 'var(--accent-soft)' : 'var(--table-row-hover)'}
                    onMouseLeave={e => e.currentTarget.style.background = isEmailPending ? 'var(--accent-soft)' : (idx % 2 === 1 ? 'var(--row-stripe)' : 'transparent')}
                    onClick={() => isEmailPending && openReview(f)}
                  >
                    <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {new Date(f.uploaded_at.replace(' ', 'T')).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })}
                    </span>
                    <div className="min-w-0">
                      {f.detected_source && (
                        <p className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>{f.detected_source}</p>
                      )}
                      <p className={`text-sm truncate ${isEmailPending ? 'font-bold' : 'font-medium'}`} style={{ color: isEmailPending ? 'var(--accent)' : 'var(--text-secondary)' }}>
                        {f.original_name}
                      </p>
                    </div>
                    <div className="flex justify-center">
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                        style={{
                          background: f.source_type === 'email' ? 'var(--accent-soft)' : 'var(--surface)',
                          color: f.source_type === 'email' ? 'var(--accent)' : 'var(--text-muted)',
                        }}>
                        {f.source_type === 'email' ? 'EMAIL' : 'MANUAL'}
                      </span>
                    </div>
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                        style={{
                          background: f.status === 'imported' ? 'var(--success-soft)' : f.status === 'failed' ? 'var(--danger-soft)' : 'var(--amber-soft)',
                          color: f.status === 'imported' ? 'var(--success)' : f.status === 'failed' ? 'var(--danger)' : 'var(--amber)',
                        }}>
                        {isEmailPending ? 'REVIEW' : f.status.toUpperCase()}
                      </span>
                      {f.status_message && (
                        <button
                          className="text-[9px] text-center leading-tight cursor-pointer hover:opacity-70"
                          style={{ color: f.skipped_transactions ? 'var(--amber)' : 'var(--text-muted)' }}
                          onClick={e => { e.stopPropagation(); setExpandedSkipped(expandedSkipped === f.id ? null : f.id); }}
                          title={f.skipped_transactions ? 'Click to view skipped transactions' : undefined}
                        >
                          {f.status_message}
                        </button>
                      )}
                    </div>
                    <span className="text-xs text-center tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                      {f.transactions_imported}
                    </span>
                    <div className="flex justify-center gap-1" onClick={e => e.stopPropagation()}>
                      {isEmailPending && (
                        <button
                          onClick={() => openReview(f)}
                          className="p-1.5 rounded-lg hover:bg-[var(--surface)] transition-colors"
                          title="Review & Import"
                        >
                          <svg className="w-4 h-4" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                          </svg>
                        </button>
                      )}
                      <a
                        href={`/api/upload/files/${f.public_id}/view`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 rounded-lg hover:bg-[var(--surface)] transition-colors"
                        title="View file in browser"
                      >
                        <svg className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                        </svg>
                      </a>
                      <a
                        href={`/api/upload/files/${f.public_id}/download`}
                        className="p-1.5 rounded-lg hover:bg-[var(--surface)] transition-colors"
                        title="Download file"
                      >
                        <svg className="w-4 h-4" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                        </svg>
                      </a>
                      <button
                        onClick={() => deleteFile(f.id)}
                        className="p-1.5 rounded-lg hover:bg-[var(--surface)] transition-colors"
                        title="Delete file"
                      >
                        <svg className="w-4 h-4" style={{ color: 'var(--danger)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  {expandedSkipped === f.id && f.skipped_transactions && (() => {
                    const skippedList = JSON.parse(f.skipped_transactions);
                    return (
                      <div className="px-4 py-3" style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--amber)' }}>
                            Skipped Transactions ({skippedList.length})
                          </span>
                          <button
                            onClick={() => setExpandedSkipped(null)}
                            className="text-[10px] px-2 py-0.5 rounded hover:bg-[var(--card)]"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            Close
                          </button>
                        </div>
                        <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                          <div className="max-h-48 overflow-y-auto divide-y" style={{ borderColor: 'var(--border)' }}>
                            {skippedList.map((t, i) => (
                              <div key={i} className="flex items-center justify-between px-3 py-1.5 text-xs"
                                style={{ background: i % 2 === 1 ? 'var(--row-stripe)' : 'var(--card)' }}>
                                <div className="flex items-center gap-4 min-w-0">
                                  <span className="tabular-nums shrink-0" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{t.date}</span>
                                  <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{t.description}</span>
                                </div>
                                <span className="shrink-0 font-semibold tabular-nums ml-2" style={{ fontFamily: 'var(--font-mono)', color: t.type === 'credit' ? 'var(--success)' : 'var(--danger)' }}>
                                  {t.type === 'credit' ? '+' : '-'}{formatCurrency(t.amount)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>);
              })}
            </div>
            </div>
          </div>
        </div>
      )}

      {/* Review Email Statement Modal */}
      <Modal open={!!reviewFile} onClose={() => { setReviewFile(null); setReviewTransactions([]); }} size="lg">
        {reviewFile && (<>
          <button onClick={() => { setReviewFile(null); setReviewTransactions([]); }} className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-[var(--surface)] transition-colors z-10" title="Close">
            <svg className="w-5 h-5" style={{ color: 'var(--text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>

          <div className="flex items-center gap-2 mb-1 pr-8">
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
              EMAIL
            </span>
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Review Statement</h2>
          </div>
          <div className="flex items-center gap-3 mb-4">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {reviewFile.original_name}
              {reviewFile.detected_source && ` · Detected: ${reviewFile.detected_source}`}
            </p>
            <a
              href={`/api/upload/files/${reviewFile.public_id}/view`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors shrink-0"
              style={{ background: 'var(--surface)', color: 'var(--accent)', border: '1px solid var(--border)' }}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
              </svg>
              View PDF
            </a>
          </div>

          {reviewLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-3 rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
            </div>
          ) : reviewTransactions.length === 0 ? (
            <p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>No transactions found in this statement.</p>
          ) : (
            <>
              <div className="mb-4">
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Source Label</label>
                <input
                  type="text"
                  value={reviewSource}
                  onChange={e => setReviewSource(e.target.value)}
                  placeholder="e.g., HDFC Credit Card May 2026"
                  className="input-field max-w-sm"
                />
              </div>

              <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                {reviewSelected.size} of {reviewTransactions.length} transactions selected
              </p>

              <div className="card overflow-hidden mb-4">
                <div className="grid grid-cols-[32px_80px_1fr_100px_64px] gap-2 px-4 py-3 border-b text-xs font-semibold uppercase tracking-wider"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-muted)', background: 'var(--surface)' }}>
                  <span className="flex items-center">
                    <input type="checkbox" checked={reviewSelected.size === reviewTransactions.length} onChange={e => {
                      setReviewSelected(e.target.checked ? new Set(reviewTransactions.map((_, i) => i)) : new Set());
                    }} className="w-3.5 h-3.5 rounded" style={{ borderColor: 'var(--checkbox-border)' }} />
                  </span>
                  <span>Date</span>
                  <span>Description</span>
                  <span className="text-right">Amount</span>
                  <span className="text-center">Type</span>
                </div>
                <div className="divide-y max-h-64 overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
                  {reviewTransactions.map((t, i) => (
                    <div key={i} className="grid grid-cols-[32px_80px_1fr_100px_64px] gap-2 px-4 py-2.5 items-center"
                      style={{ opacity: reviewSelected.has(i) ? 1 : 0.5 }}>
                      <span className="flex items-center">
                        <input type="checkbox" checked={reviewSelected.has(i)} onChange={() => {
                          setReviewSelected(prev => { const next = new Set(prev); next.has(i) ? next.delete(i) : next.add(i); return next; });
                        }} className="w-3.5 h-3.5 rounded" style={{ borderColor: 'var(--checkbox-border)' }} />
                      </span>
                      <span className="text-xs tabular-nums" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{t.date}</span>
                      <span className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{t.description}</span>
                      <span className="text-sm text-right font-semibold tabular-nums"
                        style={{ fontFamily: 'var(--font-mono)', color: t.type === 'credit' ? 'var(--success)' : 'var(--text-primary)' }}>
                        {formatCurrency(t.amount)}
                      </span>
                      <span className="flex justify-center">
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                          style={{
                            background: t.type === 'credit' ? 'var(--success-soft)' : 'var(--danger-soft)',
                            color: t.type === 'credit' ? 'var(--success)' : 'var(--danger)',
                          }}>
                          {t.type.toUpperCase()}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-3">
                <button onClick={() => { setReviewFile(null); setReviewTransactions([]); }} className="btn-secondary">Cancel</button>
                <button onClick={handleReviewImport} disabled={reviewLoading || reviewSelected.size === 0} className="btn-primary">
                  {reviewLoading ? 'Importing...' : `Import ${reviewSelected.size} Transactions`}
                </button>
              </div>
            </>
          )}
        </>)}
      </Modal>
    </div>
  );
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
