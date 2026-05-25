import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { readFileSync, existsSync, unlinkSync } from 'fs';
import { execFileSync } from 'child_process';
import { getDb } from '../models/db.js';
import { parsePdf, extractTransactionsFromText, extractSourceFromText } from '../services/pdfParser.js';

const router = Router();
const upload = multer({ dest: '/tmp/uploads/' });

function storeFile(req) {
  const db = getDb();
  const fileBuffer = readFileSync(req.file.path);
  const result = db.prepare(`
    INSERT INTO uploaded_files (original_name, mime_type, size, data)
    VALUES (?, ?, ?, ?)
  `).run(
    req.file.originalname,
    req.file.mimetype || 'application/octet-stream',
    req.file.size,
    fileBuffer
  );
  return result.lastInsertRowid;
}

function importTransactions(rows, source) {
  const db = getDb();
  const rules = db.prepare('SELECT * FROM rules').all();
  const insertStmt = db.prepare(`
    INSERT INTO transactions (date, description, amount, type, category_id, source)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const countStmt = db.prepare(`
    SELECT COUNT(*) as count FROM transactions
    WHERE date = ? AND description = ? AND amount = ? AND type = ?
  `);

  // Group incoming rows by signature to handle genuine same-day duplicates
  const groups = {};
  const normalized = [];
  for (const row of rows) {
    const date = normalizeDate(row.date);
    if (!date || !row.amount) continue;
    const description = row.description || '';
    const type = row.type || 'debit';
    const amount = typeof row.amount === 'number' ? row.amount : parseFloat(String(row.amount).replace(/,/g, '')) || 0;
    if (amount < 0.01) continue;

    const key = `${date}|${description}|${amount}|${type}`;
    if (!groups[key]) groups[key] = 0;
    groups[key]++;
    normalized.push({ date, description, amount, type, key });
  }

  let imported = 0;
  let duplicates = 0;
  const skipped = [];

  // For each unique signature, determine how many to insert
  const insertCounts = {};
  for (const [key, batchCount] of Object.entries(groups)) {
    const [date, description, amountStr, type] = key.split('|');
    const amount = parseFloat(amountStr);
    const existing = countStmt.get(date, description, amount, type);
    const toInsert = Math.max(0, batchCount - existing.count);
    insertCounts[key] = toInsert;
    duplicates += batchCount - toInsert;
  }

  const doInsert = db.transaction(() => {
    const inserted = {};
    for (const row of normalized) {
      if (!inserted[row.key]) inserted[row.key] = 0;
      if (inserted[row.key] >= insertCounts[row.key]) {
        skipped.push({ date: row.date, description: row.description, amount: row.amount, type: row.type });
        continue;
      }

      let categoryId = null;
      const descLower = row.description.toLowerCase();
      for (const rule of rules) {
        if (descLower.includes(rule.pattern)) {
          categoryId = rule.category_id;
          break;
        }
      }

      insertStmt.run(row.date, row.description, row.amount, row.type, categoryId, source || null);
      inserted[row.key]++;
      imported++;
    }
  });

  doInsert();
  return { imported, duplicates, skipped, total: rows.length };
}

function updateFileStatus(fileId, status, transactionsImported, statusMessage, source, skipped) {
  const db = getDb();
  const skippedJson = skipped && skipped.length > 0 ? JSON.stringify(skipped) : null;
  if (source) {
    db.prepare(`
      UPDATE uploaded_files SET status = ?, status_message = ?, transactions_imported = ?, detected_source = ?, skipped_transactions = ? WHERE id = ?
    `).run(status, statusMessage || null, transactionsImported || 0, source, skippedJson, fileId);
  } else {
    db.prepare(`
      UPDATE uploaded_files SET status = ?, status_message = ?, transactions_imported = ?, skipped_transactions = ? WHERE id = ?
    `).run(status, statusMessage || null, transactionsImported || 0, skippedJson, fileId);
  }
}

function storeDecryptedPdf(fileId, filePath, password) {
  const decryptedPath = filePath + '.unlocked.pdf';
  try {
    execFileSync('qpdf', ['--password=' + password, '--decrypt', filePath, decryptedPath]);
  } catch (err) {
    if (existsSync(decryptedPath)) {
      // qpdf succeeded with warnings
    } else {
      return;
    }
  }
  try {
    const decryptedBuffer = readFileSync(decryptedPath);
    const db = getDb();
    db.prepare('UPDATE uploaded_files SET data = ?, size = ? WHERE id = ?')
      .run(decryptedBuffer, decryptedBuffer.length, fileId);
  } finally {
    try { unlinkSync(decryptedPath); } catch {}
  }
}

router.get('/files', (req, res) => {
  const db = getDb();
  // Only expire manually-uploaded pending files, not email-fetched ones
  db.prepare(`
    UPDATE uploaded_files SET status = 'failed', status_message = 'Import not completed'
    WHERE status = 'pending' AND source_type = 'manual' AND uploaded_at < datetime('now', '-30 minutes')
  `).run();

  const { limit, from_date, to_date, status } = req.query;
  const conditions = [];
  const params = [];

  if (from_date) {
    conditions.push('uploaded_at >= ?');
    params.push(from_date);
  }
  if (to_date) {
    conditions.push('uploaded_at < datetime(?, \'+1 day\')');
    params.push(to_date);
  }
  if (status && ['pending', 'imported', 'failed'].includes(status)) {
    conditions.push('status = ?');
    params.push(status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rowLimit = Math.min(Math.max(parseInt(limit) || 100, 1), 500);
  params.push(rowLimit);

  const files = db.prepare(`
    SELECT id, original_name, mime_type, size, status, status_message, transactions_imported, source_type, detected_source, skipped_transactions, uploaded_at
    FROM uploaded_files ${whereClause} ORDER BY uploaded_at DESC LIMIT ?
  `).all(...params);
  res.json(files);
});

router.get('/files/by-source/download', (req, res) => {
  const { source } = req.query;
  if (!source) return res.status(400).json({ error: 'source query param required' });

  const db = getDb();
  const file = db.prepare(
    'SELECT original_name, mime_type, data FROM uploaded_files WHERE detected_source = ? ORDER BY uploaded_at DESC LIMIT 1'
  ).get(source);
  if (!file) return res.status(404).json({ error: 'No file found for this source' });

  res.setHeader('Content-Type', file.mime_type);
  res.setHeader('Content-Disposition', `attachment; filename="${file.original_name}"`);
  res.send(file.data);
});

router.get('/files/:id/transactions', (req, res) => {
  const db = getDb();
  const file = db.prepare('SELECT id, pending_transactions, detected_source, status FROM uploaded_files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'File not found' });
  if (!file.pending_transactions) return res.json({ transactions: [], source: file.detected_source });

  const transactions = JSON.parse(file.pending_transactions);
  res.json({ transactions, source: file.detected_source });
});

router.post('/files/:id/import', (req, res) => {
  const db = getDb();
  const file = db.prepare('SELECT id, pending_transactions, detected_source, status FROM uploaded_files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'File not found' });
  if (file.status === 'imported') return res.status(400).json({ error: 'Already imported' });
  if (!file.pending_transactions) return res.status(400).json({ error: 'No transactions to import' });

  const transactions = JSON.parse(file.pending_transactions);
  const source = req.body?.source || file.detected_source;

  const { imported, duplicates, skipped, total } = importTransactions(transactions, source);

  const msg = duplicates > 0 ? `${duplicates} duplicate(s) skipped` : null;
  const skippedJson = skipped.length > 0 ? JSON.stringify(skipped) : null;
  db.prepare(`
    UPDATE uploaded_files SET status = 'imported', transactions_imported = ?, status_message = ?, detected_source = ?, skipped_transactions = ?, pending_transactions = NULL WHERE id = ?
  `).run(imported, msg, source || null, skippedJson, file.id);

  res.json({ imported, duplicates, skipped, total });
});

router.get('/files/:id/download', (req, res) => {
  const db = getDb();
  const file = db.prepare('SELECT original_name, mime_type, data FROM uploaded_files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'File not found' });

  res.setHeader('Content-Type', file.mime_type);
  res.setHeader('Content-Disposition', `attachment; filename="${file.original_name}"`);
  res.send(file.data);
});

router.get('/files/:id/view', (req, res) => {
  const db = getDb();
  const file = db.prepare('SELECT original_name, mime_type, data FROM uploaded_files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'File not found' });

  res.setHeader('Content-Type', file.mime_type);
  res.setHeader('Content-Disposition', `inline; filename="${file.original_name}"`);
  res.send(file.data);
});


router.delete('/files/:id', (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM uploaded_files WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'File not found' });
  res.json({ success: true });
});

router.patch('/files/:id/status', (req, res) => {
  const { status, status_message } = req.body;
  if (!status || !['pending', 'imported', 'failed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  updateFileStatus(req.params.id, status, 0, status_message || null);
  res.json({ success: true });
});

router.post('/preview', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const fileId = storeFile(req);
  const isPdf = req.file.originalname.toLowerCase().endsWith('.pdf') || req.file.mimetype === 'application/pdf';

  if (isPdf) {
    return handlePdfPreview(req, res, fileId);
  }

  const content = readFileSync(req.file.path, 'utf-8');
  const records = parse(content, { columns: true, skip_empty_lines: true, trim: true });

  if (records.length === 0) return res.status(400).json({ error: 'Empty CSV' });

  const columns = Object.keys(records[0]);
  const preview = records.slice(0, 5);

  res.json({ type: 'csv', columns, preview, total_rows: records.length, file_path: req.file.path, file_id: fileId });
});

async function handlePdfPreview(req, res, fileId) {
  const password = req.body?.password || null;

  try {
    const { text } = await parsePdf(req.file.path, password);
    const detectedSource = extractSourceFromText(text);
    const transactions = extractTransactionsFromText(text, detectedSource);

    if (detectedSource && fileId) {
      const db = getDb();
      db.prepare('UPDATE uploaded_files SET detected_source = ? WHERE id = ?').run(detectedSource, fileId);
    }

    if (transactions.length === 0) {
      return res.json({
        type: 'pdf',
        raw_text: text.substring(0, 3000),
        transactions: [],
        total_rows: 0,
        file_path: req.file.path,
        file_id: fileId,
        detected_source: detectedSource,
        message: 'Could not auto-detect transactions. You may need to review the extracted text.',
      });
    }

    const preview = transactions.slice(0, 10);
    res.json({
      type: 'pdf',
      transactions: preview,
      total_rows: transactions.length,
      file_path: req.file.path,
      file_id: fileId,
      all_transactions: transactions,
      detected_source: detectedSource,
    });
  } catch (err) {
    if (err.message === 'PASSWORD_REQUIRED') {
      return res.status(401).json({ error: 'PASSWORD_REQUIRED', file_path: req.file.path, file_id: fileId });
    }
    if (err.message === 'INVALID_PASSWORD') {
      return res.status(401).json({ error: 'INVALID_PASSWORD', file_path: req.file.path, file_id: fileId });
    }
    res.status(500).json({ error: err.message });
  }
}

router.post('/pdf-unlock', upload.single('file'), async (req, res) => {
  const filePath = req.body?.file_path || req.file?.path;
  const password = req.body?.password;
  const fileId = req.body?.file_id;

  if (!filePath || !password) {
    return res.status(400).json({ error: 'file_path and password are required' });
  }

  try {
    const { text } = await parsePdf(filePath, password);
    const detectedSource = extractSourceFromText(text);
    const transactions = extractTransactionsFromText(text, detectedSource);

    if (fileId) {
      storeDecryptedPdf(fileId, filePath, password);
    }

    if (transactions.length === 0) {
      return res.json({
        type: 'pdf',
        raw_text: text.substring(0, 3000),
        transactions: [],
        total_rows: 0,
        file_path: filePath,
        detected_source: detectedSource,
        message: 'Could not auto-detect transactions from this PDF.',
      });
    }

    const preview = transactions.slice(0, 10);
    res.json({
      type: 'pdf',
      transactions: preview,
      total_rows: transactions.length,
      file_path: filePath,
      all_transactions: transactions,
      detected_source: detectedSource,
    });
  } catch (err) {
    if (err.message === 'INVALID_PASSWORD') {
      return res.status(401).json({ error: 'INVALID_PASSWORD', file_path: filePath });
    }
    res.status(500).json({ error: err.message });
  }
});

router.post('/pdf-import', (req, res) => {
  const { transactions, source, file_id } = req.body;
  if (!transactions || !Array.isArray(transactions)) {
    return res.status(400).json({ error: 'transactions array is required' });
  }

  const { imported, duplicates, skipped, total } = importTransactions(transactions, source);

  if (file_id) {
    const msg = duplicates > 0 ? `${duplicates} duplicate(s) skipped` : null;
    updateFileStatus(file_id, 'imported', imported, msg, source, skipped);
  }

  res.json({ imported, duplicates, skipped, total });
});

router.post('/import', (req, res) => {
  const { file_path, mapping, source, file_id } = req.body;

  const content = readFileSync(file_path, 'utf-8');
  const records = parse(content, { columns: true, skip_empty_lines: true, trim: true });

  // Map CSV columns to normalized transaction rows
  const rows = [];
  for (const row of records) {
    let date = row[mapping.date];
    const description = row[mapping.description] || '';
    let amount, type;

    if (mapping.amount) {
      amount = Math.abs(parseFloat(row[mapping.amount].replace(/,/g, '')) || 0);
      if (mapping.type) {
        const typeVal = row[mapping.type].toLowerCase().trim();
        type = (typeVal === 'cr' || typeVal === 'credit') ? 'credit' : 'debit';
      } else {
        type = parseFloat(row[mapping.amount].replace(/,/g, '')) < 0 ? 'credit' : 'debit';
      }
    } else if (mapping.debit_amount && mapping.credit_amount) {
      const debit = parseFloat((row[mapping.debit_amount] || '0').replace(/,/g, '')) || 0;
      const credit = parseFloat((row[mapping.credit_amount] || '0').replace(/,/g, '')) || 0;
      if (debit > 0) {
        amount = debit;
        type = 'debit';
      } else {
        amount = credit;
        type = 'credit';
      }
    } else {
      continue;
    }

    if (!amount || !date) continue;
    rows.push({ date, description, amount, type });
  }

  const { imported, duplicates, skipped, total } = importTransactions(rows, source);

  if (file_id) {
    const msg = duplicates > 0 ? `${duplicates} duplicate(s) skipped` : null;
    updateFileStatus(file_id, 'imported', imported, msg, source, skipped);
  }

  res.json({ imported, duplicates, skipped, total });
});

function normalizeDate(dateStr) {
  const str = dateStr.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // DD/MM/YYYY or DD-MM-YYYY
  const ddmmyyyy = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // DD/MM/YY
  const ddmmyy = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/);
  if (ddmmyy) {
    const [, day, month, yr] = ddmmyy;
    const year = parseInt(yr) > 50 ? `19${yr}` : `20${yr}`;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // DD Mon YYYY (e.g., "15 Jan 2025")
  const ddMonYyyy = str.match(/^(\d{1,2})\s+(\w{3})\s+(\d{4})$/);
  if (ddMonYyyy) {
    const [, day, mon, year] = ddMonYyyy;
    const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
    const m = months[mon.toLowerCase()];
    if (m) return `${year}-${m}-${day.padStart(2, '0')}`;
  }

  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  }

  return null;
}

export default router;
