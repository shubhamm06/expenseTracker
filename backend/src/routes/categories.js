import { Router } from 'express';
import { supabase } from '../models/supabase.js';
import { cacheMiddleware, invalidateOnWrite } from '../middleware/cache.js';

const router = Router();
const PROTECTED_CATEGORIES = ['Payments', 'Gift Card'];

router.get('/', cacheMiddleware('categories', 300000), async (req, res) => {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('user_id', req.userId)
    .order('name');

  if (error) return res.status(500).json({ error: error.message });
  const enriched = data.map(c => ({ ...c, protected: PROTECTED_CATEGORIES.includes(c.name) }));
  res.json(enriched);
});

router.post('/', invalidateOnWrite(), async (req, res) => {
  const { name, color } = req.body;
  const { data, error } = await supabase
    .from('categories')
    .insert({ name, color: color || '#6b7280', user_id: req.userId })
    .select('id')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ id: data.id });
});

router.put('/:id', invalidateOnWrite(), async (req, res) => {
  const { name, color } = req.body;
  const { error } = await supabase
    .from('categories')
    .update({ name, color })
    .eq('id', req.params.id)
    .eq('user_id', req.userId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

router.delete('/:id', invalidateOnWrite(), async (req, res) => {
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
