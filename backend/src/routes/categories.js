import { Router } from 'express';
import { supabase } from '../models/supabase.js';

const router = Router();
const PROTECTED_CATEGORIES = ['Payments', 'Gift Card'];

router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('name');

  if (error) return res.status(500).json({ error: error.message });
  const enriched = data.map(c => ({ ...c, protected: PROTECTED_CATEGORIES.includes(c.name) }));
  res.json(enriched);
});

router.post('/', async (req, res) => {
  const { name, color } = req.body;
  const { data, error } = await supabase
    .from('categories')
    .insert({ name, color: color || '#6b7280' })
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
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

router.delete('/:id', async (req, res) => {
  const { data: category } = await supabase
    .from('categories')
    .select('name')
    .eq('id', req.params.id)
    .single();

  if (!category) return res.status(404).json({ error: 'Category not found' });
  if (PROTECTED_CATEGORIES.includes(category.name)) {
    return res.status(403).json({ error: `"${category.name}" is a system category and cannot be deleted` });
  }

  await Promise.all([
    supabase.from('transactions').update({ category_id: null }).eq('category_id', req.params.id),
    supabase.from('rules').delete().eq('category_id', req.params.id),
  ]);

  const { error } = await supabase
    .from('categories')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

export default router;
