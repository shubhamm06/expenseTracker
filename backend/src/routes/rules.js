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

router.patch('/:id', (req, res) => {
  const db = getDb();
  const { pattern, category_id } = req.body;
  const rule = db.prepare('SELECT * FROM rules WHERE id = ?').get(req.params.id);
  if (!rule) return res.status(404).json({ error: 'Not found' });

  if (pattern !== undefined) {
    db.prepare('UPDATE rules SET pattern = ? WHERE id = ?').run(pattern.toLowerCase(), req.params.id);
  }
  if (category_id !== undefined) {
    db.prepare('UPDATE rules SET category_id = ? WHERE id = ?').run(category_id, req.params.id);
  }
  res.json({ success: true });
});

router.post('/apply', (req, res) => {
  const db = getDb();
  const rules = db.prepare('SELECT * FROM rules').all();
  let applied = 0;

  // Find the Payments category (excluded from totals but not marked as not-mine)
  const paymentsCategory = db.prepare("SELECT id FROM categories WHERE name = 'Payments'").get();
  const paymentsCatId = paymentsCategory ? paymentsCategory.id : null;

  const eligible = db.prepare("SELECT * FROM transactions WHERE category_id IS NULL OR category_source = 'rule'").all();
  const updateStmt = db.prepare("UPDATE transactions SET category_id = ?, category_source = 'rule' WHERE id = ?");


  for (const txn of eligible) {
    const desc = txn.description.toLowerCase();
    let matched = false;
    for (const rule of rules) {
      const patterns = rule.pattern.split(',').map(p => p.trim()).filter(Boolean);
      if (patterns.some(p => desc.includes(p))) {
        if (txn.category_id !== rule.category_id) {
          updateStmt.run(rule.category_id, txn.id);
          applied++;
        }

        matched = true;
        break;
      }
    }
    if (!matched && txn.category_id !== null && txn.category_source === 'rule') {
      db.prepare("UPDATE transactions SET category_id = NULL, category_source = NULL WHERE id = ?").run(txn.id);

      applied++;
    }
  }

  res.json({ applied });
});

export default router;
