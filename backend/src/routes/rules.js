import { Router } from 'express';
import { supabase } from '../models/supabase.js';

const router = Router();

router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('rules')
    .select('*, categories(name, color)')
    .order('pattern');

  if (error) return res.status(500).json({ error: error.message });

  const rules = data.map(r => ({
    id: r.id,
    pattern: r.pattern,
    category_id: r.category_id,
    category_name: r.categories?.name,
    category_color: r.categories?.color,
  }));
  res.json(rules);
});

router.post('/', async (req, res) => {
  const { pattern, category_id } = req.body;
  const { data, error } = await supabase
    .from('rules')
    .insert({ pattern: pattern.toLowerCase(), category_id })
    .select('id')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ id: data.id });
});

router.patch('/:id', async (req, res) => {
  const { pattern, category_id } = req.body;

  const { data: rule } = await supabase
    .from('rules')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (!rule) return res.status(404).json({ error: 'Not found' });

  const updates = {};
  if (pattern !== undefined) updates.pattern = pattern.toLowerCase();
  if (category_id !== undefined) updates.category_id = category_id;

  await supabase.from('rules').update(updates).eq('id', req.params.id);
  res.json({ success: true });
});

router.delete('/:id', async (req, res) => {
  const { error } = await supabase
    .from('rules')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

router.post('/apply', async (req, res) => {
  const [{ data: rules }, { data: eligible }] = await Promise.all([
    supabase.from('rules').select('*'),
    supabase.from('transactions').select('*').or('category_id.is.null,category_source.eq.rule'),
  ]);

  const updatesByCategory = {};
  const clearIds = [];

  for (const txn of eligible || []) {
    const desc = txn.description.toLowerCase();
    let matched = false;
    for (const rule of rules || []) {
      const patterns = rule.pattern.split(',').map(p => p.trim()).filter(Boolean);
      if (patterns.some(p => desc.includes(p))) {
        if (txn.category_id !== rule.category_id) {
          if (!updatesByCategory[rule.category_id]) updatesByCategory[rule.category_id] = [];
          updatesByCategory[rule.category_id].push(txn.id);
        }
        matched = true;
        break;
      }
    }
    if (!matched && txn.category_id !== null && txn.category_source === 'rule') {
      clearIds.push(txn.id);
    }
  }

  const ops = Object.entries(updatesByCategory).map(([catId, ids]) =>
    supabase.from('transactions').update({ category_id: catId, category_source: 'rule' }).in('id', ids)
  );
  if (clearIds.length > 0) {
    ops.push(supabase.from('transactions').update({ category_id: null, category_source: null }).in('id', clearIds));
  }
  await Promise.all(ops);

  const applied = Object.values(updatesByCategory).reduce((s, ids) => s + ids.length, 0) + clearIds.length;
  res.json({ applied });
});

export default router;
