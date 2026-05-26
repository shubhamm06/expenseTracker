import { Router } from 'express';
import { supabase } from '../models/supabase.js';

const router = Router();

router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('name');

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
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
  await supabase
    .from('transactions')
    .update({ category_id: null })
    .eq('category_id', req.params.id);

  await supabase
    .from('rules')
    .delete()
    .eq('category_id', req.params.id);

  const { error } = await supabase
    .from('categories')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

export default router;
