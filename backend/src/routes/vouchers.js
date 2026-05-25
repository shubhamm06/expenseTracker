import { Router } from 'express';
import { getDb } from '../models/db.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const vouchers = db.prepare('SELECT * FROM vouchers ORDER BY purchase_date DESC').all();
  res.json(vouchers);
});

router.post('/', (req, res) => {
  const db = getDb();
  const { name, initial_amount, purchase_date, source_transaction_id } = req.body;

  const result = db.prepare(`
    INSERT INTO vouchers (name, initial_amount, remaining_amount, purchase_date, source_transaction_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, initial_amount, initial_amount, purchase_date, source_transaction_id || null);

  if (source_transaction_id) {
    db.prepare('UPDATE transactions SET is_voucher_purchase = 1, voucher_id = ? WHERE id = ?')
      .run(result.lastInsertRowid, source_transaction_id);
  }

  res.status(201).json({ id: result.lastInsertRowid });
});

router.get('/:id/usage', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;
  let sql = `
    SELECT vu.*, c.name as category_name
    FROM voucher_usage vu
    LEFT JOIN categories c ON vu.category_id = c.id
    WHERE vu.voucher_id = ?
  `;
  const params = [req.params.id];
  if (month && year) {
    sql += ` AND CAST(strftime('%m', vu.date) AS INTEGER) = ? AND CAST(strftime('%Y', vu.date) AS INTEGER) = ?`;
    params.push(Number(month), Number(year));
  }
  sql += ' ORDER BY vu.date DESC';
  res.json(db.prepare(sql).all(...params));
});

router.post('/:id/usage', (req, res) => {
  const db = getDb();
  const { amount, date, description, category_id } = req.body;
  const voucherId = req.params.id;

  const voucher = db.prepare('SELECT * FROM vouchers WHERE id = ?').get(voucherId);
  if (!voucher) return res.status(404).json({ error: 'Voucher not found' });
  if (voucher.remaining_amount < amount) {
    return res.status(400).json({ error: 'Insufficient voucher balance' });
  }

  const result = db.prepare(`
    INSERT INTO voucher_usage (voucher_id, amount, date, description, category_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(voucherId, amount, date, description || null, category_id || null);

  db.prepare('UPDATE vouchers SET remaining_amount = remaining_amount - ? WHERE id = ?')
    .run(amount, voucherId);

  res.status(201).json({ id: result.lastInsertRowid });
});

router.get('/:id/topups', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;
  let sql = 'SELECT * FROM voucher_topups WHERE voucher_id = ?';
  const params = [req.params.id];
  if (month && year) {
    sql += ` AND CAST(strftime('%m', date) AS INTEGER) = ? AND CAST(strftime('%Y', date) AS INTEGER) = ?`;
    params.push(Number(month), Number(year));
  }
  sql += ' ORDER BY date DESC';
  res.json(db.prepare(sql).all(...params));
});

router.post('/:id/topup', (req, res) => {
  const db = getDb();
  const { amount, date, description, source } = req.body;
  const voucherId = req.params.id;

  const voucher = db.prepare('SELECT * FROM vouchers WHERE id = ?').get(voucherId);
  if (!voucher) return res.status(404).json({ error: 'Voucher not found' });
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Amount must be positive' });

  const topupSource = source || 'manual';
  const result = db.prepare(`
    INSERT INTO voucher_topups (voucher_id, amount, date, description, source)
    VALUES (?, ?, ?, ?, ?)
  `).run(voucherId, amount, date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }), description || null, topupSource);

  if (topupSource === 'manual') {
    db.prepare('UPDATE vouchers SET remaining_amount = remaining_amount + ?, initial_amount = initial_amount + ? WHERE id = ?')
      .run(amount, amount, voucherId);
  } else {
    db.prepare('UPDATE vouchers SET remaining_amount = remaining_amount + ? WHERE id = ?')
      .run(amount, voucherId);
  }

  res.status(201).json({ id: result.lastInsertRowid });
});

router.delete('/usage/:id', (req, res) => {
  const db = getDb();
  const entry = db.prepare('SELECT * FROM voucher_usage WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Not found' });

  db.prepare('DELETE FROM voucher_usage WHERE id = ?').run(req.params.id);
  db.prepare('UPDATE vouchers SET remaining_amount = remaining_amount + ? WHERE id = ?')
    .run(entry.amount, entry.voucher_id);
  res.json({ success: true });
});

router.delete('/topup/:id', (req, res) => {
  const db = getDb();
  const entry = db.prepare('SELECT * FROM voucher_topups WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Not found' });

  db.prepare('DELETE FROM voucher_topups WHERE id = ?').run(req.params.id);
  db.prepare('UPDATE vouchers SET remaining_amount = remaining_amount - ? WHERE id = ?')
    .run(entry.amount, entry.voucher_id);
  if (entry.source === 'manual') {
    db.prepare('UPDATE vouchers SET initial_amount = initial_amount - ? WHERE id = ?')
      .run(entry.amount, entry.voucher_id);
  }
  res.json({ success: true });
});

router.delete('/:id/clear-month', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;
  if (!month || !year) return res.status(400).json({ error: 'month and year are required' });

  const voucherId = req.params.id;
  const m = Number(month);
  const y = Number(year);

  const usageRows = db.prepare(`
    SELECT * FROM voucher_usage WHERE voucher_id = ?
    AND CAST(strftime('%m', date) AS INTEGER) = ? AND CAST(strftime('%Y', date) AS INTEGER) = ?
  `).all(voucherId, m, y);

  const topupRows = db.prepare(`
    SELECT * FROM voucher_topups WHERE voucher_id = ?
    AND CAST(strftime('%m', date) AS INTEGER) = ? AND CAST(strftime('%Y', date) AS INTEGER) = ?
  `).all(voucherId, m, y);

  const totalUsage = usageRows.reduce((s, r) => s + r.amount, 0);
  const totalTopups = topupRows.reduce((s, r) => s + r.amount, 0);
  const manualTopups = topupRows.filter(r => r.source === 'manual').reduce((s, r) => s + r.amount, 0);

  const deleteAll = db.transaction(() => {
    db.prepare(`
      DELETE FROM voucher_usage WHERE voucher_id = ?
      AND CAST(strftime('%m', date) AS INTEGER) = ? AND CAST(strftime('%Y', date) AS INTEGER) = ?
    `).run(voucherId, m, y);
    db.prepare(`
      DELETE FROM voucher_topups WHERE voucher_id = ?
      AND CAST(strftime('%m', date) AS INTEGER) = ? AND CAST(strftime('%Y', date) AS INTEGER) = ?
    `).run(voucherId, m, y);
    db.prepare('UPDATE vouchers SET remaining_amount = remaining_amount + ? - ?, initial_amount = initial_amount - ? WHERE id = ?')
      .run(totalUsage, totalTopups, manualTopups, voucherId);
  });
  deleteAll();

  res.json({ success: true, deletedUsage: usageRows.length, deletedTopups: topupRows.length });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM voucher_usage WHERE voucher_id = ?').run(req.params.id);
  db.prepare('DELETE FROM voucher_topups WHERE voucher_id = ?').run(req.params.id);
  db.prepare('UPDATE transactions SET is_voucher_purchase = 0, voucher_id = NULL WHERE voucher_id = ?').run(req.params.id);
  db.prepare('DELETE FROM vouchers WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

export default router;
