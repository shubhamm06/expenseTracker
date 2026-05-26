import { Router } from 'express';
import { supabase } from '../models/supabase.js';

const router = Router();

router.get('/', async (req, res) => {
  const { month, year, category, reimbursable } = req.query;

  let query = supabase
    .from('transactions')
    .select('*, categories(name, color)')
    .order('date', { ascending: false });

  if (month && year) {
    const startDate = `${year}-${month.padStart(2, '0')}-01`;
    const endMonth = parseInt(month);
    const endYear = parseInt(year);
    const nextMonth = endMonth === 12 ? 1 : endMonth + 1;
    const nextYear = endMonth === 12 ? endYear + 1 : endYear;
    const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
    query = query.gte('date', startDate).lt('date', endDate);
  }
  if (category) {
    query = query.eq('category_id', category);
  }
  if (reimbursable !== undefined) {
    query = query.eq('is_reimbursable', reimbursable === 'true');
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const transactions = data.map(t => ({
    ...t,
    category_name: t.categories?.name,
    category_color: t.categories?.color,
    categories: undefined,
  }));
  res.json(transactions);
});

router.get('/due-dates', async (req, res) => {
  const { month, year } = req.query;
  if (!month || !year) return res.json({});

  const startDate = `${year}-${month.padStart(2, '0')}-01`;
  const endDate = `${year}-${month.padStart(2, '0')}-31`;

  // Find sources that have transactions in this month
  const { data: sources } = await supabase
    .from('transactions')
    .select('source')
    .gte('date', startDate)
    .lte('date', endDate)
    .not('source', 'is', null);

  const uniqueSources = [...new Set((sources || []).map(s => s.source))];
  if (uniqueSources.length === 0) return res.json({});

  // Get due dates for those sources from uploaded_files
  const { data: rows } = await supabase
    .from('uploaded_files')
    .select('detected_source, due_date')
    .not('due_date', 'is', null)
    .in('detected_source', uniqueSources)
    .order('uploaded_at', { ascending: false });

  const dueDates = {};
  for (const row of rows || []) {
    if (!dueDates[row.detected_source]) {
      dueDates[row.detected_source] = row.due_date;
    }
  }
  res.json(dueDates);
});

router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('transactions')
    .select('*, categories(name, color)')
    .eq('id', req.params.id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Not found' });

  res.json({
    ...data,
    category_name: data.categories?.name,
    category_color: data.categories?.color,
    categories: undefined,
  });
});

router.post('/', async (req, res) => {
  const { date, description, amount, type, category_id, source, is_reimbursable, notes } = req.body;

  const { data, error } = await supabase
    .from('transactions')
    .insert({
      date,
      description,
      amount,
      type,
      category_id: category_id || null,
      source: source || null,
      is_reimbursable: !!is_reimbursable,
      notes: notes || null,
    })
    .select('id')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ id: data.id });
});

router.put('/:id', async (req, res) => {
  const { date, description, amount, type, category_id, source, is_reimbursable, is_voucher_purchase, notes } = req.body;

  const { error } = await supabase
    .from('transactions')
    .update({
      date,
      description,
      amount,
      type,
      category_id: category_id || null,
      source: source || null,
      is_reimbursable: !!is_reimbursable,
      is_voucher_purchase: !!is_voucher_purchase,
      notes: notes || null,
    })
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

router.patch('/rename-source', async (req, res) => {
  const { old_source, new_source } = req.body;
  if (!old_source || !new_source) return res.status(400).json({ error: 'old_source and new_source required' });

  const { data: txnData } = await supabase
    .from('transactions')
    .update({ source: new_source })
    .eq('source', old_source)
    .select('id');

  const { data: fileData } = await supabase
    .from('uploaded_files')
    .update({ detected_source: new_source })
    .eq('detected_source', old_source)
    .select('id');

  res.json({
    success: true,
    transactions_updated: txnData?.length || 0,
    files_updated: fileData?.length || 0,
  });
});

router.delete('/by-source', async (req, res) => {
  const { source } = req.query;
  if (!source) return res.status(400).json({ error: 'source query param required' });

  const { data } = await supabase
    .from('transactions')
    .delete()
    .eq('source', source)
    .select('id');

  res.json({ success: true, deleted: data?.length || 0 });
});

router.delete('/:id', async (req, res) => {
  await supabase.from('transactions').delete().eq('id', req.params.id);
  res.json({ success: true });
});

router.patch('/:id/category', async (req, res) => {
  const { category_id } = req.body;
  await supabase
    .from('transactions')
    .update({ category_id, category_source: 'manual' })
    .eq('id', req.params.id);
  res.json({ success: true });
});

router.patch('/:id/reimbursable', async (req, res) => {
  const { is_reimbursable } = req.body;
  await supabase.from('transactions').update({ is_reimbursable: !!is_reimbursable }).eq('id', req.params.id);
  res.json({ success: true });
});

export default router;
