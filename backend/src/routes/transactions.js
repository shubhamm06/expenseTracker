import { Router } from 'express';
import { getDb } from '../models/db.js';

const router = Router();

router.get('/', (req, res) => {
  const { month, year, category, reimbursable } = req.query;
  const db = getDb();

  let query = `
    SELECT t.*, c.name as category_name, c.color as category_color
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE 1=1
  `;
  const params = [];

  if (month && year) {
    query += ` AND strftime('%m', t.date) = ? AND strftime('%Y', t.date) = ?`;
    params.push(month.padStart(2, '0'), year);
  }
  if (category) {
    query += ` AND t.category_id = ?`;
    params.push(category);
  }
  if (reimbursable !== undefined) {
    query += ` AND t.is_reimbursable = ?`;
    params.push(reimbursable === 'true' ? 1 : 0);
  }

  query += ` ORDER BY t.date DESC`;

  const transactions = db.prepare(query).all(...params);
  res.json(transactions);
});

router.get('/due-dates', (req, res) => {
  const { month, year } = req.query;
  if (!month || !year) return res.json({});

  const db = getDb();
  const rows = db.prepare(`
    SELECT detected_source, due_date
    FROM uploaded_files
    WHERE due_date IS NOT NULL
      AND detected_source IS NOT NULL
      AND strftime('%m', due_date) = ?
      AND strftime('%Y', due_date) = ?
    ORDER BY uploaded_at DESC
  `).all(month.padStart(2, '0'), year);

  const dueDates = {};
  for (const row of rows) {
    if (!dueDates[row.detected_source]) {
      dueDates[row.detected_source] = row.due_date;
    }
  }
  res.json(dueDates);
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const transaction = db.prepare(`
    SELECT t.*, c.name as category_name, c.color as category_color
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE t.id = ?
  `).get(req.params.id);

  if (!transaction) return res.status(404).json({ error: 'Not found' });
  res.json(transaction);
});

router.post('/', (req, res) => {
  const db = getDb();
  const { date, description, amount, type, category_id, source, is_reimbursable, notes } = req.body;

  const result = db.prepare(`
    INSERT INTO transactions (date, description, amount, type, category_id, source, is_reimbursable, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(date, description, amount, type, category_id || null, source || null, is_reimbursable ? 1 : 0, notes || null);

  res.status(201).json({ id: result.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const { date, description, amount, type, category_id, source, is_reimbursable, is_voucher_purchase, notes } = req.body;

  db.prepare(`
    UPDATE transactions
    SET date = ?, description = ?, amount = ?, type = ?, category_id = ?, source = ?, is_reimbursable = ?, is_voucher_purchase = ?, notes = ?
    WHERE id = ?
  `).run(date, description, amount, type, category_id || null, source || null, is_reimbursable ? 1 : 0, is_voucher_purchase ? 1 : 0, notes || null, req.params.id);

  res.json({ success: true });
});

router.patch('/rename-source', (req, res) => {
  const { old_source, new_source } = req.body;
  if (!old_source || !new_source) return res.status(400).json({ error: 'old_source and new_source required' });

  const db = getDb();
  const txnResult = db.prepare('UPDATE transactions SET source = ? WHERE source = ?').run(new_source, old_source);
  const fileResult = db.prepare('UPDATE uploaded_files SET detected_source = ? WHERE detected_source = ?').run(new_source, old_source);

  res.json({ success: true, transactions_updated: txnResult.changes, files_updated: fileResult.changes });
});

router.delete('/by-source', (req, res) => {
  const { source } = req.query;
  if (!source) return res.status(400).json({ error: 'source query param required' });

  const db = getDb();
  const result = db.prepare('DELETE FROM transactions WHERE source = ?').run(source);
  res.json({ success: true, deleted: result.changes });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM transactions WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.patch('/:id/category', (req, res) => {
  const db = getDb();
  const { category_id } = req.body;
  db.prepare('UPDATE transactions SET category_id = ? WHERE id = ?').run(category_id, req.params.id);
  res.json({ success: true });
});

router.patch('/:id/reimbursable', (req, res) => {
  const db = getDb();
  const { is_reimbursable } = req.body;
  db.prepare('UPDATE transactions SET is_reimbursable = ? WHERE id = ?').run(is_reimbursable ? 1 : 0, req.params.id);
  res.json({ success: true });
});

export default router;
