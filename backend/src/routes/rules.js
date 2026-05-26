import { Router } from 'express';
import { supabase } from '../models/supabase.js';

const router = Router();

const DEFAULT_RULES = [
  { pattern: 'payment received, cc payment, payment received. thank you, payment - thank you', category: 'Payments' },
  { pattern: 'gift card, gift voucher, amazon gift card, amazon mumbai', category: 'Gift Card' },
];

async function ensureDefaultRules(userId) {
  const { data: existing } = await supabase
    .from('rules')
    .select('pattern')
    .eq('user_id', userId);

  if (existing && existing.length > 0) return;

  const { data: categories } = await supabase
    .from('categories')
    .select('id, name')
    .eq('user_id', userId);

  if (!categories || categories.length === 0) return;

  const catMap = Object.fromEntries(categories.map(c => [c.name, c.id]));
  const toInsert = DEFAULT_RULES
    .filter(r => catMap[r.category])
    .map(r => ({ pattern: r.pattern, category_id: catMap[r.category], user_id: userId }));

  if (toInsert.length > 0) {
    await supabase.from('rules').insert(toInsert);
  }
}

router.get('/', async (req, res) => {
  await ensureDefaultRules(req.userId);

  const { data, error } = await supabase
    .from('rules')
    .select('*, categories(name, color)')
    .eq('user_id', req.userId)
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
    .insert({ pattern: pattern.toLowerCase(), category_id, user_id: req.userId })
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
    .eq('user_id', req.userId)
    .single();

  if (!rule) return res.status(404).json({ error: 'Not found' });

  const updates = {};
  if (pattern !== undefined) updates.pattern = pattern.toLowerCase();
  if (category_id !== undefined) updates.category_id = category_id;

  await supabase.from('rules').update(updates).eq('id', req.params.id).eq('user_id', req.userId);
  res.json({ success: true });
});

router.delete('/:id', async (req, res) => {
  const { error } = await supabase
    .from('rules')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.userId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

router.post('/apply', async (req, res) => {
  const [{ data: rules }, { data: eligible }] = await Promise.all([
    supabase.from('rules').select('*').eq('user_id', req.userId),
    supabase.from('transactions').select('*').eq('user_id', req.userId).or('category_id.is.null,category_source.eq.rule'),
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
