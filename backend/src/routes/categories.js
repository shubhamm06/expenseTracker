import { Router } from 'express';
import { getDb } from '../models/db.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.json(categories);
});

router.post('/', (req, res) => {
  const db = getDb();
  const { name, color } = req.body;
  const result = db.prepare('INSERT INTO categories (name, color) VALUES (?, ?)').run(name, color || '#6b7280');
  res.status(201).json({ id: result.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const { name, color } = req.body;
  db.prepare('UPDATE categories SET name = ?, color = ? WHERE id = ?').run(name, color, req.params.id);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE transactions SET category_id = NULL WHERE category_id = ?').run(req.params.id);
  db.prepare('DELETE FROM rules WHERE category_id = ?').run(req.params.id);
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

export default router;
