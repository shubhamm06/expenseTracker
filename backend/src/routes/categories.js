import { Router } from 'express';
import { supabase } from '../models/supabase.js';

const router = Router();
const PROTECTED_CATEGORIES = ['Payments', 'Gift Card'];

const DEFAULT_CATEGORIES = [
  { name: 'Groceries', color: '#22c55e' },
  { name: 'Dining', color: '#f97316' },
  { name: 'Shopping', color: '#8b5cf6' },
  { name: 'Subscriptions', color: '#06b6d4' },
  { name: 'Fuel', color: '#eab308' },
  { name: 'Utilities', color: '#64748b' },
  { name: 'Transport', color: '#ec4899' },
  { name: 'Health', color: '#ef4444' },
  { name: 'Entertainment', color: '#a855f7' },
  { name: 'Travel', color: '#0ea5e9' },
  { name: 'Education', color: '#6366f1' },
  { name: 'Other', color: '#6b7280' },
  { name: 'Payments', color: '#475569' },
  { name: 'Gift Card', color: '#f59e0b' },
];

async function ensureDefaultCategories(userId) {
  const { data: existing } = await supabase
    .from('categories')
    .select('name')
    .eq('user_id', userId);

  const existingNames = new Set((existing || []).map(c => c.name));
  const missing = DEFAULT_CATEGORIES.filter(c => !existingNames.has(c.name));

  if (missing.length > 0) {
    await supabase.from('categories').insert(
      missing.map(c => ({ ...c, user_id: userId }))
    );
  }
}

router.get('/', async (req, res) => {
  await ensureDefaultCategories(req.userId);

  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('user_id', req.userId)
    .order('name');

  if (error) return res.status(500).json({ error: error.message });
  const enriched = data.map(c => ({ ...c, protected: PROTECTED_CATEGORIES.includes(c.name) }));
  res.json(enriched);
});

router.post('/', async (req, res) => {
  const { name, color } = req.body;
  const { data, error } = await supabase
    .from('categories')
    .insert({ name, color: color || '#6b7280', user_id: req.userId })
    .select('id')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ id: data.id });
});

router.put('/:id', async (req, res) => {
  const { name, color } = req.body;
  const { error } = await supabase
    .from('categories')
    .update({ name, color })
    .eq('id', req.params.id)
    .eq('user_id', req.userId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

router.delete('/:id', async (req, res) => {
  const { data: category } = await supabase
    .from('categories')
    .select('name')
    .eq('id', req.params.id)
    .eq('user_id', req.userId)
    .single();

  if (!category) return res.status(404).json({ error: 'Category not found' });
  if (PROTECTED_CATEGORIES.includes(category.name)) {
    return res.status(403).json({ error: `"${category.name}" is a system category and cannot be deleted` });
  }

  await supabase
    .from('transactions')
    .update({ category_id: null })
    .eq('category_id', req.params.id)
    .eq('user_id', req.userId);

  await supabase
    .from('rules')
    .delete()
    .eq('category_id', req.params.id)
    .eq('user_id', req.userId);

  const { error } = await supabase
    .from('categories')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.userId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

export default router;
