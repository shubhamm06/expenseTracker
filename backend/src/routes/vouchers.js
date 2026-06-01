import { Router } from 'express';
import { supabase } from '../models/supabase.js';
import { cacheMiddleware, invalidateOnWrite } from '../middleware/cache.js';

const router = Router();

router.get('/', cacheMiddleware('vouchers', 120000), async (req, res) => {
  const { data, error } = await supabase
    .from('vouchers')
    .select('*')
    .eq('user_id', req.userId)
    .order('purchase_date', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/', invalidateOnWrite(), async (req, res) => {
  const { name, initial_amount, purchase_date, source_transaction_id } = req.body;

  const { data, error } = await supabase
    .from('vouchers')
    .insert({
      name,
      initial_amount: 0,
      remaining_amount: 0,
      purchase_date,
      source_transaction_id: source_transaction_id || null,
      user_id: req.userId,
    })
    .select('id')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  if (source_transaction_id) {
    await supabase
      .from('transactions')
      .update({ is_voucher_purchase: true, voucher_id: data.id })
      .eq('id', source_transaction_id)
      .eq('user_id', req.userId);
  }

  res.status(201).json({ id: data.id });
});

router.get('/:id/usage', async (req, res) => {
  const { month, year } = req.query;

  let query = supabase
    .from('voucher_usage')
    .select('*, categories(name, color)')
    .eq('voucher_id', req.params.id)
    .eq('user_id', req.userId)
    .order('date', { ascending: false });

  if (month && year) {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const m = parseInt(month);
    const y = parseInt(year);
    const nextMonth = m === 12 ? 1 : m + 1;
    const nextYear = m === 12 ? y + 1 : y;
    const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
    query = query.gte('date', startDate).lt('date', endDate);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const usage = data.map(u => ({
    ...u,
    category_name: u.categories?.name,
    category_color: u.categories?.color,
    categories: undefined,
  }));
  res.json(usage);
});

router.post('/:id/usage', invalidateOnWrite(), async (req, res) => {
  const { amount, date, description, category_id } = req.body;
  const voucherId = req.params.id;

  const { data: voucher } = await supabase
    .from('vouchers')
    .select('*')
    .eq('id', voucherId)
    .eq('user_id', req.userId)
    .single();

  if (!voucher) return res.status(404).json({ error: 'Voucher not found' });
  if (voucher.remaining_amount < amount) {
    return res.status(400).json({ error: 'Insufficient voucher balance' });
  }

  const { data, error } = await supabase
    .from('voucher_usage')
    .insert({
      voucher_id: voucherId,
      amount,
      date,
      description: description || null,
      category_id: category_id || null,
      user_id: req.userId,
    })
    .select('id')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  await supabase
    .from('vouchers')
    .update({ remaining_amount: voucher.remaining_amount - amount })
    .eq('id', voucherId)
    .eq('user_id', req.userId);

  res.status(201).json({ id: data.id });
});

router.get('/:id/balance-summary', async (req, res) => {
  const { month, year } = req.query;
  const voucherId = req.params.id;

  if (!month || !year) return res.status(400).json({ error: 'month and year required' });

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const m = parseInt(month);
  const y = parseInt(year);
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

  const { data: voucher } = await supabase
    .from('vouchers')
    .select('initial_amount, remaining_amount, purchase_date')
    .eq('id', voucherId)
    .eq('user_id', req.userId)
    .single();

  if (!voucher) return res.status(404).json({ error: 'Voucher not found' });

  // Sum all usage before this month
  const { data: usageBefore } = await supabase
    .from('voucher_usage')
    .select('amount')
    .eq('voucher_id', voucherId)
    .eq('user_id', req.userId)
    .lt('date', startDate);

  // Sum all topups before this month
  const { data: topupsBefore } = await supabase
    .from('voucher_topups')
    .select('amount')
    .eq('voucher_id', voucherId)
    .eq('user_id', req.userId)
    .lt('date', startDate);

  const totalUsageBefore = (usageBefore || []).reduce((s, u) => s + u.amount, 0);
  const totalTopupsBefore = (topupsBefore || []).reduce((s, t) => s + t.amount, 0);

  const carryForward = totalTopupsBefore - totalUsageBefore;

  res.json({ carry_forward: carryForward });
});

router.get('/:id/topups', async (req, res) => {
  const { month, year } = req.query;

  let query = supabase
    .from('voucher_topups')
    .select('*')
    .eq('voucher_id', req.params.id)
    .eq('user_id', req.userId)
    .order('date', { ascending: false });

  if (month && year) {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const m = parseInt(month);
    const y = parseInt(year);
    const nextMonth = m === 12 ? 1 : m + 1;
    const nextYear = m === 12 ? y + 1 : y;
    const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
    query = query.gte('date', startDate).lt('date', endDate);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/:id/topup', invalidateOnWrite(), async (req, res) => {
  const { amount, date, description, source } = req.body;
  const voucherId = req.params.id;

  const { data: voucher } = await supabase
    .from('vouchers')
    .select('*')
    .eq('id', voucherId)
    .eq('user_id', req.userId)
    .single();

  if (!voucher) return res.status(404).json({ error: 'Voucher not found' });
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Amount must be positive' });

  const topupSource = source || 'manual';
  const topupDate = date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  const { data, error } = await supabase
    .from('voucher_topups')
    .insert({
      voucher_id: voucherId,
      amount,
      date: topupDate,
      description: description || null,
      source: topupSource,
      user_id: req.userId,
    })
    .select('id')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  await supabase
    .from('vouchers')
    .update({ remaining_amount: voucher.remaining_amount + amount })
    .eq('id', voucherId)
    .eq('user_id', req.userId);

  res.status(201).json({ id: data.id });
});

router.put('/usage/:id', invalidateOnWrite(), async (req, res) => {
  const { amount, date, description, category_id } = req.body;

  const { data: entry } = await supabase
    .from('voucher_usage')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.userId)
    .single();

  if (!entry) return res.status(404).json({ error: 'Not found' });

  const amountDiff = (amount || entry.amount) - entry.amount;

  await supabase
    .from('voucher_usage')
    .update({
      amount: amount || entry.amount,
      date: date || entry.date,
      description: description !== undefined ? description : entry.description,
      category_id: category_id !== undefined ? (category_id || null) : entry.category_id,
    })
    .eq('id', req.params.id)
    .eq('user_id', req.userId);

  if (amountDiff !== 0) {
    const { data: voucher } = await supabase
      .from('vouchers')
      .select('remaining_amount')
      .eq('id', entry.voucher_id)
      .eq('user_id', req.userId)
      .single();

    await supabase
      .from('vouchers')
      .update({ remaining_amount: voucher.remaining_amount - amountDiff })
      .eq('id', entry.voucher_id)
      .eq('user_id', req.userId);
  }

  res.json({ success: true });
});

router.put('/topup/:id', invalidateOnWrite(), async (req, res) => {
  const { amount, date, description } = req.body;

  const { data: entry } = await supabase
    .from('voucher_topups')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.userId)
    .single();

  if (!entry) return res.status(404).json({ error: 'Not found' });

  const amountDiff = (amount || entry.amount) - entry.amount;

  await supabase
    .from('voucher_topups')
    .update({
      amount: amount || entry.amount,
      date: date || entry.date,
      description: description !== undefined ? description : entry.description,
    })
    .eq('id', req.params.id)
    .eq('user_id', req.userId);

  if (amountDiff !== 0) {
    const { data: voucher } = await supabase
      .from('vouchers')
      .select('remaining_amount')
      .eq('id', entry.voucher_id)
      .eq('user_id', req.userId)
      .single();

    await supabase.from('vouchers').update({ remaining_amount: voucher.remaining_amount + amountDiff }).eq('id', entry.voucher_id).eq('user_id', req.userId);
  }

  res.json({ success: true });
});

router.delete('/usage/:id', invalidateOnWrite(), async (req, res) => {
  const { data: entry } = await supabase
    .from('voucher_usage')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.userId)
    .single();

  if (!entry) return res.status(404).json({ error: 'Not found' });

  const [, { data: voucher }] = await Promise.all([
    supabase.from('voucher_usage').delete().eq('id', req.params.id).eq('user_id', req.userId),
    supabase.from('vouchers').select('remaining_amount').eq('id', entry.voucher_id).eq('user_id', req.userId).single(),
  ]);

  await supabase
    .from('vouchers')
    .update({ remaining_amount: voucher.remaining_amount + entry.amount })
    .eq('id', entry.voucher_id)
    .eq('user_id', req.userId);

  res.json({ success: true });
});

router.post('/usage/auto-categorize', invalidateOnWrite(), async (req, res) => {
  const [{ data: rules }, { data: uncategorized }] = await Promise.all([
    supabase.from('rules').select('*').eq('user_id', req.userId),
    supabase.from('voucher_usage').select('*').eq('user_id', req.userId).or('category_id.is.null,category_source.eq.rule'),
  ]);

  const updatesByCategory = {};

  for (const entry of uncategorized || []) {
    const desc = (entry.description || '').toLowerCase();
    for (const rule of rules || []) {
      const patterns = rule.pattern.split(',').map(p => p.trim()).filter(Boolean);
      if (patterns.some(p => desc.includes(p))) {
        if (!updatesByCategory[rule.category_id]) updatesByCategory[rule.category_id] = [];
        updatesByCategory[rule.category_id].push(entry.id);
        break;
      }
    }
  }

  await Promise.all(
    Object.entries(updatesByCategory).map(([catId, ids]) =>
      supabase.from('voucher_usage').update({ category_id: catId, category_source: 'rule' }).in('id', ids)
    )
  );

  const applied = Object.values(updatesByCategory).reduce((s, ids) => s + ids.length, 0);
  res.json({ applied });
});

router.patch('/usage/:id/category', invalidateOnWrite(), async (req, res) => {
  const { category_id } = req.body;

  const { data: entry } = await supabase
    .from('voucher_usage')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.userId)
    .single();

  if (!entry) return res.status(404).json({ error: 'Not found' });

  await supabase
    .from('voucher_usage')
    .update({ category_id: category_id || null, category_source: 'manual' })
    .eq('id', req.params.id)
    .eq('user_id', req.userId);

  res.json({ success: true });
});

router.delete('/topup/:id', invalidateOnWrite(), async (req, res) => {
  const { data: entry } = await supabase
    .from('voucher_topups')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.userId)
    .single();

  if (!entry) return res.status(404).json({ error: 'Not found' });

  await supabase.from('voucher_topups').delete().eq('id', req.params.id).eq('user_id', req.userId);

  const { data: voucher } = await supabase
    .from('vouchers')
    .select('remaining_amount')
    .eq('id', entry.voucher_id)
    .eq('user_id', req.userId)
    .single();

  await supabase.from('vouchers').update({ remaining_amount: voucher.remaining_amount - entry.amount }).eq('id', entry.voucher_id).eq('user_id', req.userId);
  res.json({ success: true });
});

router.delete('/:id/clear-month', invalidateOnWrite(), async (req, res) => {
  const { month, year } = req.query;
  if (!month || !year) return res.status(400).json({ error: 'month and year are required' });

  const voucherId = req.params.id;
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const m = parseInt(month);
  const y = parseInt(year);
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

  const { data: usageRows } = await supabase
    .from('voucher_usage')
    .select('*')
    .eq('voucher_id', voucherId)
    .eq('user_id', req.userId)
    .gte('date', startDate)
    .lt('date', endDate);

  const { data: topupRows } = await supabase
    .from('voucher_topups')
    .select('*')
    .eq('voucher_id', voucherId)
    .eq('user_id', req.userId)
    .gte('date', startDate)
    .lt('date', endDate);

  const totalUsage = (usageRows || []).reduce((s, r) => s + r.amount, 0);
  const totalTopups = (topupRows || []).reduce((s, r) => s + r.amount, 0);

  await supabase
    .from('voucher_usage')
    .delete()
    .eq('voucher_id', voucherId)
    .eq('user_id', req.userId)
    .gte('date', startDate)
    .lt('date', endDate);

  await supabase
    .from('voucher_topups')
    .delete()
    .eq('voucher_id', voucherId)
    .eq('user_id', req.userId)
    .gte('date', startDate)
    .lt('date', endDate);

  const { data: voucher } = await supabase
    .from('vouchers')
    .select('remaining_amount')
    .eq('id', voucherId)
    .eq('user_id', req.userId)
    .single();

  await supabase
    .from('vouchers')
    .update({ remaining_amount: voucher.remaining_amount + totalUsage - totalTopups })
    .eq('id', voucherId)
    .eq('user_id', req.userId);

  res.json({ success: true, deletedUsage: (usageRows || []).length, deletedTopups: (topupRows || []).length });
});

router.delete('/:id', invalidateOnWrite(), async (req, res) => {
  const { data: voucher } = await supabase
    .from('vouchers')
    .select('name, is_protected')
    .eq('id', req.params.id)
    .eq('user_id', req.userId)
    .single();

  if (!voucher) return res.status(404).json({ error: 'Voucher not found' });
  if (voucher.is_protected) {
    return res.status(403).json({ error: `"${voucher.name}" is a system voucher and cannot be deleted` });
  }

  await supabase.from('voucher_usage').delete().eq('voucher_id', req.params.id).eq('user_id', req.userId);
  await supabase.from('voucher_topups').delete().eq('voucher_id', req.params.id).eq('user_id', req.userId);
  await supabase
    .from('transactions')
    .update({ is_voucher_purchase: false, voucher_id: null })
    .eq('voucher_id', req.params.id)
    .eq('user_id', req.userId);
  await supabase.from('vouchers').delete().eq('id', req.params.id).eq('user_id', req.userId);
  res.json({ success: true });
});

export default router;
