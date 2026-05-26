import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { readFileSync, existsSync, unlinkSync } from 'fs';
import { execFileSync } from 'child_process';
import { supabase } from '../models/supabase.js';
import { parsePdf, extractTransactionsFromText, extractSourceFromText } from '../services/pdfParser.js';

const router = Router();

async function applyRulesAfterImport(userId) {
  const { data: rules } = await supabase.from('rules').select('*').eq('user_id', userId);
  if (!rules || rules.length === 0) return;

  const { data: uncategorized } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .or('category_id.is.null,category_source.eq.rule');

  if (!uncategorized || uncategorized.length === 0) return;

  const updatesByCategory = {};
  for (const txn of uncategorized) {
    const desc = txn.description.toLowerCase();
    for (const rule of rules) {
      const patterns = rule.pattern.split(',').map(p => p.trim()).filter(Boolean);
      if (patterns.some(p => desc.includes(p))) {
        if (!updatesByCategory[rule.category_id]) updatesByCategory[rule.category_id] = [];
        updatesByCategory[rule.category_id].push(txn.id);
        break;
      }
    }
  }

  await Promise.all(
    Object.entries(updatesByCategory).map(([categoryId, ids]) =>
      supabase
        .from('transactions')
        .update({ category_id: categoryId, category_source: 'rule' })
        .in('id', ids)
    )
  );
}

const upload = multer({ dest: '/tmp/uploads/' });

async function storeFile(req) {
  const fileBuffer = readFileSync(req.file.path);
  const storagePath = `uploads/${Date.now()}-${req.file.originalname}`;

  await supabase.storage
    .from('uploads')
    .upload(storagePath, fileBuffer, {
      contentType: req.file.mimetype || 'application/octet-stream',
    });

  const { data, error } = await supabase
    .from('uploaded_files')
    .insert({
      original_name: req.file.originalname,
      mime_type: req.file.mimetype || 'application/octet-stream',
      size: req.file.size,
      storage_path: storagePath,
      user_id: req.userId,
    })
    .select('id')
    .single();

  if (error) throw new Error(error.message);
  return data.id;
}

async function importTransactions(rows, source, userId) {
  const { data: rules } = await supabase.from('rules').select('*').eq('user_id', userId);

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

  const insertCounts = {};
  const groupEntries = Object.entries(groups);
  const countResults = await Promise.all(
    groupEntries.map(([key]) => {
      const [date, description, amountStr, type] = key.split('|');
      const amount = parseFloat(amountStr);
      return supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('date', date)
        .eq('description', description)
        .eq('amount', amount)
        .eq('type', type);
    })
  );
  for (let i = 0; i < groupEntries.length; i++) {
    const [key, batchCount] = groupEntries[i];
    const toInsert = Math.max(0, batchCount - (countResults[i].count || 0));
    insertCounts[key] = toInsert;
    duplicates += batchCount - toInsert;
  }

  const inserted = {};
  const toInsertRows = [];

  for (const row of normalized) {
    if (!inserted[row.key]) inserted[row.key] = 0;
    if (inserted[row.key] >= insertCounts[row.key]) {
      skipped.push({ date: row.date, description: row.description, amount: row.amount, type: row.type });
      continue;
    }

    let categoryId = null;
    const descLower = row.description.toLowerCase();
    for (const rule of rules || []) {
      if (descLower.includes(rule.pattern)) {
        categoryId = rule.category_id;
        break;
      }
    }

    toInsertRows.push({
      date: row.date,
      description: row.description,
      amount: row.amount,
      type: row.type,
      category_id: categoryId,
      source: source || null,
      user_id: userId,
    });
    inserted[row.key]++;
    imported++;
  }

  if (toInsertRows.length > 0) {
    await supabase.from('transactions').insert(toInsertRows);
  }

  return { imported, duplicates, skipped, total: rows.length };
}

async function updateFileStatus(fileId, status, transactionsImported, statusMessage, source, skipped) {
  const skippedJson = skipped && skipped.length > 0 ? JSON.stringify(skipped) : null;
  const updates = {
    status,
    status_message: statusMessage || null,
    transactions_imported: transactionsImported || 0,
    skipped_transactions: skippedJson,
  };
  if (source) {
    updates.detected_source = source;
  }

  await supabase.from('uploaded_files').update(updates).eq('id', fileId);
}

function storeDecryptedPdf(fileId, filePath, password) {
  const decryptedPath = filePath + '.unlocked.pdf';
  try {
    execFileSync('qpdf', ['--password=' + password, '--decrypt', filePath, decryptedPath]);
  } catch (err) {
    if (!existsSync(decryptedPath)) return;
  }
  try {
    const decryptedBuffer = readFileSync(decryptedPath);
    // Re-upload decrypted version to storage
    supabase
      .from('uploaded_files')
      .select('storage_path')
      .eq('id', fileId)
      .single()
      .then(({ data }) => {
        if (data?.storage_path) {
          supabase.storage.from('uploads').update(data.storage_path, decryptedBuffer, {
            contentType: 'application/pdf',
          });
          supabase.from('uploaded_files').update({ size: decryptedBuffer.length }).eq('id', fileId);
        }
      });
  } finally {
    try { unlinkSync(decryptedPath); } catch {}
  }
}

router.get('/files', async (req, res) => {
  // Expire old pending manual uploads
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  await supabase
    .from('uploaded_files')
    .update({ status: 'failed', status_message: 'Import not completed' })
    .eq('user_id', req.userId)
    .eq('status', 'pending')
    .eq('source_type', 'manual')
    .lt('uploaded_at', thirtyMinAgo);

  const { limit: qLimit, from_date, to_date, status } = req.query;

  let query = supabase
    .from('uploaded_files')
    .select('id, original_name, mime_type, size, status, status_message, transactions_imported, source_type, detected_source, skipped_transactions, uploaded_at')
    .eq('user_id', req.userId)
    .order('uploaded_at', { ascending: false })
    .limit(Math.min(Math.max(parseInt(qLimit) || 100, 1), 500));

  if (from_date) query = query.gte('uploaded_at', from_date);
  if (to_date) query = query.lt('uploaded_at', to_date + 'T23:59:59');
  if (status && ['pending', 'imported', 'failed'].includes(status)) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/files/by-source/download', async (req, res) => {
  const { source } = req.query;
  if (!source) return res.status(400).json({ error: 'source query param required' });

  const { data: file } = await supabase
    .from('uploaded_files')
    .select('original_name, mime_type, storage_path')
    .eq('detected_source', source)
    .eq('user_id', req.userId)
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .single();

  if (!file) return res.status(404).json({ error: 'No file found for this source' });

  const { data: fileData } = await supabase.storage
    .from('uploads')
    .download(file.storage_path);

  if (!fileData) return res.status(404).json({ error: 'File data not found in storage' });

  const buffer = Buffer.from(await fileData.arrayBuffer());
  res.setHeader('Content-Type', file.mime_type);
  res.setHeader('Content-Disposition', `attachment; filename="${file.original_name}"`);
  res.send(buffer);
});

router.get('/files/:id/transactions', async (req, res) => {
  const { data: file } = await supabase
    .from('uploaded_files')
    .select('id, pending_transactions, detected_source, status')
    .eq('id', req.params.id)
    .eq('user_id', req.userId)
    .single();

  if (!file) return res.status(404).json({ error: 'File not found' });
  if (!file.pending_transactions) return res.json({ transactions: [], source: file.detected_source });

  const transactions = JSON.parse(file.pending_transactions);
  res.json({ transactions, source: file.detected_source });
});

router.post('/files/:id/import', async (req, res) => {
  const { data: file } = await supabase
    .from('uploaded_files')
    .select('id, pending_transactions, detected_source, status')
    .eq('id', req.params.id)
    .eq('user_id', req.userId)
    .single();

  if (!file) return res.status(404).json({ error: 'File not found' });
  if (file.status === 'imported') return res.status(400).json({ error: 'Already imported' });
  if (!file.pending_transactions) return res.status(400).json({ error: 'No transactions to import' });

  const transactions = JSON.parse(file.pending_transactions);
  const source = req.body?.source || file.detected_source;

  const { imported, duplicates, skipped, total } = await importTransactions(transactions, source, req.userId);

  const msg = duplicates > 0 ? `${duplicates} duplicate(s) skipped` : null;
  const skippedJson = skipped.length > 0 ? JSON.stringify(skipped) : null;
  await supabase
    .from('uploaded_files')
    .update({
      status: 'imported',
      transactions_imported: imported,
      status_message: msg,
      detected_source: source || null,
      skipped_transactions: skippedJson,
      pending_transactions: null,
    })
    .eq('id', file.id);

  res.json({ imported, duplicates, skipped, total });
});

router.get('/files/:id/download', async (req, res) => {
  const { data: file } = await supabase
    .from('uploaded_files')
    .select('original_name, mime_type, storage_path')
    .eq('id', req.params.id)
    .eq('user_id', req.userId)
    .single();

  if (!file) return res.status(404).json({ error: 'File not found' });

  const { data: fileData } = await supabase.storage
    .from('uploads')
    .download(file.storage_path);

  if (!fileData) return res.status(404).json({ error: 'File data not found in storage' });

  const buffer = Buffer.from(await fileData.arrayBuffer());
  res.setHeader('Content-Type', file.mime_type);
  res.setHeader('Content-Disposition', `attachment; filename="${file.original_name}"`);
  res.send(buffer);
});

router.get('/files/:id/view', async (req, res) => {
  const { data: file } = await supabase
    .from('uploaded_files')
    .select('original_name, mime_type, storage_path')
    .eq('id', req.params.id)
    .eq('user_id', req.userId)
    .single();

  if (!file) return res.status(404).json({ error: 'File not found' });

  const { data: fileData } = await supabase.storage
    .from('uploads')
    .download(file.storage_path);

  if (!fileData) return res.status(404).json({ error: 'File data not found in storage' });

  const buffer = Buffer.from(await fileData.arrayBuffer());
  res.setHeader('Content-Type', file.mime_type);
  res.setHeader('Content-Disposition', `inline; filename="${file.original_name}"`);
  res.send(buffer);
});

router.delete('/files/:id', async (req, res) => {
  const { data: file } = await supabase
    .from('uploaded_files')
    .select('storage_path')
    .eq('id', req.params.id)
    .eq('user_id', req.userId)
    .single();

  if (!file) return res.status(404).json({ error: 'File not found' });

  if (file.storage_path) {
    await supabase.storage.from('uploads').remove([file.storage_path]);
  }

  await supabase.from('uploaded_files').delete().eq('id', req.params.id).eq('user_id', req.userId);
  res.json({ success: true });
});

router.patch('/files/:id/status', async (req, res) => {
  const { status, status_message } = req.body;
  if (!status || !['pending', 'imported', 'failed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const { data: file } = await supabase.from('uploaded_files').select('id').eq('id', req.params.id).eq('user_id', req.userId).single();
  if (!file) return res.status(404).json({ error: 'File not found' });
  await updateFileStatus(req.params.id, status, 0, status_message || null);
  res.json({ success: true });
});

router.post('/preview', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const fileId = await storeFile(req);
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
      await supabase
        .from('uploaded_files')
        .update({ detected_source: detectedSource })
        .eq('id', fileId);
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

router.post('/pdf-import', async (req, res) => {
  const { transactions, source, file_id } = req.body;
  if (!transactions || !Array.isArray(transactions)) {
    return res.status(400).json({ error: 'transactions array is required' });
  }

  const { imported, duplicates, skipped, total } = await importTransactions(transactions, source, req.userId);

  if (file_id) {
    const { data: ownedFile } = await supabase.from('uploaded_files').select('id').eq('id', file_id).eq('user_id', req.userId).single();
    if (ownedFile) {
      const msg = duplicates > 0 ? `${duplicates} duplicate(s) skipped` : null;
      await updateFileStatus(file_id, 'imported', imported, msg, source, skipped);
    }
  }

  await applyRulesAfterImport(req.userId);
  res.json({ imported, duplicates, skipped, total });
});

router.post('/import', async (req, res) => {
  const { file_path, mapping, source, file_id } = req.body;

  const content = readFileSync(file_path, 'utf-8');
  const records = parse(content, { columns: true, skip_empty_lines: true, trim: true });

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

  const { imported, duplicates, skipped, total } = await importTransactions(rows, source, req.userId);

  if (file_id) {
    const { data: ownedFile } = await supabase.from('uploaded_files').select('id').eq('id', file_id).eq('user_id', req.userId).single();
    if (ownedFile) {
      const msg = duplicates > 0 ? `${duplicates} duplicate(s) skipped` : null;
      await updateFileStatus(file_id, 'imported', imported, msg, source, skipped);
    }
  }

  await applyRulesAfterImport(req.userId);
  res.json({ imported, duplicates, skipped, total });
});

function normalizeDate(dateStr) {
  const str = dateStr.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  const ddmmyyyy = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const ddmmyy = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/);
  if (ddmmyy) {
    const [, day, month, yr] = ddmmyy;
    const year = parseInt(yr) > 50 ? `19${yr}` : `20${yr}`;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

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
