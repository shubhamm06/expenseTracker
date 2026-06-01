import { Router } from 'express';
import { supabase } from '../models/supabase.js';
import { cacheMiddleware } from '../middleware/cache.js';

const router = Router();

router.get('/summary', cacheMiddleware(req => `dashboard:summary:${req.query.month || ''}:${req.query.year || ''}`), async (req, res) => {
  const { month, year } = req.query;
  const m = (month || String(new Date().getMonth() + 1)).padStart(2, '0');
  const y = year || String(new Date().getFullYear());

  const { data, error } = await supabase.rpc('get_dashboard_summary', {
    p_month: m,
    p_year: y,
    p_user_id: req.userId,
  });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/monthly-comparison', cacheMiddleware('dashboard:monthly'), async (req, res) => {
  const { months = 6 } = req.query;

  const { data, error } = await supabase.rpc('get_monthly_comparison', {
    p_months: Number(months),
    p_user_id: req.userId,
  });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/top-merchants', cacheMiddleware(req => `dashboard:merchants:${req.query.month || ''}:${req.query.year || ''}`), async (req, res) => {
  const { month, year, limit = 8 } = req.query;
  const m = (month || String(new Date().getMonth() + 1)).padStart(2, '0');
  const y = year || String(new Date().getFullYear());

  const startDate = `${y}-${m}-01`;
  const mInt = parseInt(m);
  const yInt = parseInt(y);
  const nextMonth = mInt === 12 ? 1 : mInt + 1;
  const nextYear = mInt === 12 ? yInt + 1 : yInt;
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

  const [{ data, error }, { data: excludedCats }] = await Promise.all([
    supabase
      .from('transactions')
      .select('description, amount, category_id')
      .eq('user_id', req.userId)
      .eq('type', 'debit')
      .eq('is_reimbursable', false)
      .eq('is_voucher_purchase', false)
      .gte('date', startDate)
      .lt('date', endDate),
    supabase
      .from('categories')
      .select('id')
      .eq('user_id', req.userId)
      .in('name', ['Payments', 'Gift Card']),
  ]);

  if (error) return res.status(500).json({ error: error.message });
  const excludedIds = new Set((excludedCats || []).map(c => c.id));

  const grouped = {};
  for (const t of data || []) {
    if (excludedIds.has(t.category_id)) continue;
    if (!grouped[t.description]) grouped[t.description] = { total: 0, count: 0 };
    grouped[t.description].total += t.amount;
    grouped[t.description].count++;
  }

  const merchants = Object.entries(grouped)
    .map(([description, { total, count }]) => ({ description, total, count }))
    .sort((a, b) => b.total - a.total)
    .slice(0, Number(limit));

  res.json(merchants);
});

router.get('/source-breakdown', cacheMiddleware(req => `dashboard:sources:${req.query.month || ''}:${req.query.year || ''}`), async (req, res) => {
  const { month, year } = req.query;
  const m = (month || String(new Date().getMonth() + 1)).padStart(2, '0');
  const y = year || String(new Date().getFullYear());

  const startDate = `${y}-${m}-01`;
  const mInt = parseInt(m);
  const yInt = parseInt(y);
  const nextMonth = mInt === 12 ? 1 : mInt + 1;
  const nextYear = mInt === 12 ? yInt + 1 : yInt;
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

  const [{ data, error }, { data: excludedCats }] = await Promise.all([
    supabase
      .from('transactions')
      .select('source, type, amount, is_reimbursable, category_id')
      .eq('user_id', req.userId)
      .gte('date', startDate)
      .lt('date', endDate),
    supabase
      .from('categories')
      .select('id')
      .eq('user_id', req.userId)
      .in('name', ['Payments', 'Gift Card']),
  ]);

  if (error) return res.status(500).json({ error: error.message });
  const excludedIds = new Set((excludedCats || []).map(c => c.id));

  const grouped = {};
  for (const t of data || []) {
    const src = t.source || null;
    if (!grouped[src]) grouped[src] = { source: src, debit: 0, credit: 0, count: 0 };
    grouped[src].count++;
    if (t.type === 'debit' && !t.is_reimbursable && !excludedIds.has(t.category_id)) grouped[src].debit += t.amount;
    if (t.type === 'credit' && !t.is_reimbursable && !excludedIds.has(t.category_id)) grouped[src].credit += t.amount;
  }

  const sources = Object.values(grouped).sort((a, b) => b.debit - a.debit);
  res.json(sources);
});

export default router;
