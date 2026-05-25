import { Router } from 'express';
import { getDb } from '../models/db.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const rules = db.prepare(`
    SELECT r.*, c.name as category_name, c.color as category_color
    FROM rules r
    JOIN categories c ON r.category_id = c.id
    ORDER BY r.pattern
  `).all();
  res.json(rules);
});

router.post('/', (req, res) => {
  const db = getDb();
  const { pattern, category_id } = req.body;
  const result = db.prepare('INSERT INTO rules (pattern, category_id) VALUES (?, ?)').run(pattern.toLowerCase(), category_id);
  res.status(201).json({ id: result.lastInsertRowid });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM rules WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.post('/apply', (req, res) => {
  const db = getDb();
  const rules = db.prepare('SELECT * FROM rules').all();
  let applied = 0;

  const uncategorized = db.prepare('SELECT * FROM transactions WHERE category_id IS NULL').all();
  const updateStmt = db.prepare('UPDATE transactions SET category_id = ? WHERE id = ?');

  for (const txn of uncategorized) {
    const desc = txn.description.toLowerCase();
    for (const rule of rules) {
      const patterns = rule.pattern.split(',').map(p => p.trim()).filter(Boolean);
      if (patterns.some(p => desc.includes(p))) {
        updateStmt.run(rule.category_id, txn.id);
        applied++;
        break;
      }
    }
  }

  res.json({ applied });
});

export default router;
