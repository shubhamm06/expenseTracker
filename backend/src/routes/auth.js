import { Router } from 'express';
import { supabase } from '../models/supabase.js';

const router = Router();

const DEFAULT_CATEGORIES = [
  ['Groceries', '#22c55e'],
  ['Dining', '#f97316'],
  ['Shopping', '#8b5cf6'],
  ['Subscriptions', '#06b6d4'],
  ['Fuel', '#eab308'],
  ['Utilities', '#64748b'],
  ['Transport', '#ec4899'],
  ['Health', '#ef4444'],
  ['Entertainment', '#a855f7'],
  ['Other', '#6b7280'],
  ['Payments', '#475569'],
  ['Gift Card', '#f59e0b'],
];

router.get('/me', async (req, res) => {
  const { data: profile } = await supabase
    .from('user_profile')
    .select('*')
    .eq('user_id', req.userId)
    .single();

  res.json({
    user: { id: req.user.id, email: req.user.email },
    profile,
    needs_setup: !profile,
  });
});

router.post('/setup', async (req, res) => {
  const { name, dob, pan } = req.body;
  const userId = req.userId;

  const { data: existing } = await supabase
    .from('user_profile')
    .select('id')
    .eq('user_id', userId)
    .single();

  if (existing) {
    return res.status(400).json({ error: 'Profile already exists' });
  }

  await supabase.from('user_profile').insert({
    user_id: userId,
    name: name || '',
    dob: dob || '',
    pan: pan || '',
  });

  await supabase.from('categories').insert(
    DEFAULT_CATEGORIES.map(([name, color]) => ({ name, color, user_id: userId }))
  );

  const { data: paymentsCat } = await supabase
    .from('categories')
    .select('id')
    .eq('name', 'Payments')
    .eq('user_id', userId)
    .single();

  if (paymentsCat) {
    await supabase.from('rules').insert({
      pattern: 'payment received,cc payment,bbps pmt',
      category_id: paymentsCat.id,
      user_id: userId,
    });
  }

  const { data: giftCardCat } = await supabase
    .from('categories')
    .select('id')
    .eq('name', 'Gift Card')
    .eq('user_id', userId)
    .single();

  if (giftCardCat) {
    await supabase.from('rules').insert({
      pattern: 'amazon pay gift card,gift card',
      category_id: giftCardCat.id,
      user_id: userId,
    });
  }

  await supabase.from('vouchers').insert({
    name: 'Amazon Pay Balance',
    initial_amount: 0,
    remaining_amount: 0,
    purchase_date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
    user_id: userId,
    is_protected: true,
  });

  res.json({ success: true });
});

export default router;
