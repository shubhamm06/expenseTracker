import { Router } from 'express';
import { google } from 'googleapis';
import { supabase } from '../models/supabase.js';
import { triggerSync, triggerAmazonPaySync, isSyncRunning, isAmazonPaySyncRunning } from '../services/syncScheduler.js';

const router = Router();

const IMAP_PROVIDERS = {
  'gmail.com': { host: 'imap.gmail.com', port: 993 },
  'googlemail.com': { host: 'imap.gmail.com', port: 993 },
  'outlook.com': { host: 'outlook.office365.com', port: 993 },
  'hotmail.com': { host: 'outlook.office365.com', port: 993 },
  'yahoo.com': { host: 'imap.mail.yahoo.com', port: 993 },
  'icloud.com': { host: 'imap.mail.me.com', port: 993 },
  'zoho.com': { host: 'imap.zoho.com', port: 993 },
};

function detectImapSettings(email) {
  const domain = email.split('@')[1]?.toLowerCase();
  return IMAP_PROVIDERS[domain] || null;
}

async function hasCards(userId) {
  const { data } = await supabase.from('cards').select('id').eq('user_id', userId).limit(1);
  return data && data.length > 0;
}


const SYNC_THROTTLE_LIMITS = { '1m': 3, '2m': 2 };

async function getSyncUsageToday(syncType, userId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data } = await supabase
    .from('email_sync_jobs')
    .select('sync_period')
    .eq('sync_type', syncType)
    .eq('user_id', userId)
    .gte('started_at', today.toISOString())
    .in('sync_period', ['1m', '2m']);

  const usage = { '1m': 0, '2m': 0 };
  for (const job of data || []) {
    if (job.sync_period && usage[job.sync_period] !== undefined) {
      usage[job.sync_period]++;
    }
  }
  return usage;
}

function getRemainingAttempts(usage) {
  return {
    '1m': Math.max(0, SYNC_THROTTLE_LIMITS['1m'] - (usage['1m'] || 0)),
    '2m': Math.max(0, SYNC_THROTTLE_LIMITS['2m'] - (usage['2m'] || 0)),
  };
}

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// --- Google OAuth ---

router.get('/oauth/google/url', (req, res) => {
  const oauth2Client = getOAuth2Client();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    state: req.userId,
    scope: [
      'https://mail.google.com/',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
  });
  res.json({ url });
});

router.get('/oauth/google/callback', async (req, res) => {
  const { code, error, state } = req.query;
  const userId = state || req.userId;

  if (error) {
    return res.redirect('http://localhost:5173/settings?error=' + encodeURIComponent(error));
  }

  if (!code || !userId) {
    return res.redirect('http://localhost:5173/settings?error=no_code');
  }

  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();
    const email = data.email;

    const { data: existing } = await supabase
      .from('email_accounts')
      .select('id')
      .eq('email', email)
      .eq('user_id', userId)
      .single();

    if (existing) {
      await supabase
        .from('email_accounts')
        .update({
          password: tokens.refresh_token || '',
          auth_type: 'oauth',
          access_token: tokens.access_token,
          token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
          status: 'connected',
          error_message: null,
        })
        .eq('id', existing.id);
      if (await hasCards(userId)) {
        triggerSync(existing.id, { triggerType: 'auto' });
      }
    } else {
      const { data: newAccount } = await supabase
        .from('email_accounts')
        .insert({
          email,
          imap_host: 'imap.gmail.com',
          imap_port: 993,
          password: tokens.refresh_token || '',
          auth_type: 'oauth',
          access_token: tokens.access_token,
          token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
          display_name: data.name || email,
          user_id: userId,
        })
        .select('id')
        .single();
      if (await hasCards(userId)) {
        triggerSync(newAccount.id, { triggerType: 'auto' });
      }
    }

    res.redirect('http://localhost:5173/settings?success=connected&email=' + encodeURIComponent(email));
  } catch (err) {
    console.error('[OAuth] Token exchange failed:', err.message);
    res.redirect('http://localhost:5173/settings?error=' + encodeURIComponent(err.message));
  }
});

// --- Email Accounts ---

router.get('/email-accounts', async (req, res) => {
  const { data: accounts, error } = await supabase
    .from('email_accounts')
    .select('id, email, imap_host, imap_port, display_name, auth_type, amazon_pay_sync, status, last_sync_at, error_message, created_at')
    .eq('user_id', req.userId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const enriched = accounts.map(a => ({
    ...a,
    sync_running: isSyncRunning(a.id),
    amazon_pay_sync_running: isAmazonPaySyncRunning(a.id),
  }));

  res.json(enriched);
});

router.post('/email-accounts', async (req, res) => {
  const { email, password, imap_host, imap_port, display_name } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const detected = detectImapSettings(email);
  const host = imap_host || detected?.host;
  const port = imap_port || detected?.port || 993;

  if (!host) {
    return res.status(400).json({
      error: 'Could not detect IMAP settings. Please provide imap_host manually.',
      needs_imap: true,
    });
  }

  const { data, error } = await supabase
    .from('email_accounts')
    .insert({
      email,
      imap_host: host,
      imap_port: port,
      password,
      auth_type: 'password',
      display_name: display_name || null,
      user_id: req.userId,
    })
    .select('id')
    .single();

  if (error) {
    if (error.message.includes('unique') || error.message.includes('duplicate')) {
      return res.status(409).json({ error: 'This email is already connected' });
    }
    return res.status(500).json({ error: error.message });
  }

  const shouldSync = await hasCards(req.userId);
  if (shouldSync) {
    triggerSync(data.id, { triggerType: 'auto' });
  }

  res.json({
    id: data.id,
    email,
    imap_host: host,
    imap_port: port,
    status: 'connected',
    sync_started: shouldSync,
  });
});

router.delete('/email-accounts/:id', async (req, res) => {
  const { data: account } = await supabase
    .from('email_accounts')
    .select('id')
    .eq('id', req.params.id)
    .eq('user_id', req.userId)
    .single();

  if (!account) return res.status(404).json({ error: 'Account not found' });

  const { data: jobs } = await supabase
    .from('email_sync_jobs')
    .select('id')
    .eq('email_account_id', req.params.id);

  if (jobs && jobs.length > 0) {
    const jobIds = jobs.map(j => j.id);
    await supabase.from('email_sync_results').delete().in('sync_job_id', jobIds);
  }

  await Promise.all([
    supabase.from('email_sync_jobs').delete().eq('email_account_id', req.params.id),
    supabase.from('email_accounts').delete().eq('id', req.params.id),
  ]);

  res.json({ success: true });
});

router.post('/email-accounts/:id/sync', async (req, res) => {
  const accountId = parseInt(req.params.id);
  const { data: account } = await supabase
    .from('email_accounts')
    .select('id')
    .eq('id', accountId)
    .eq('user_id', req.userId)
    .single();

  if (!account) return res.status(404).json({ error: 'Account not found' });

  const periodMap = { '1w': 7, '1m': 30, '2m': 60 };
  const period = req.body?.period || null;
  const sinceDays = periodMap[period] || undefined;

  if (!(await hasCards(req.userId))) {
    return res.status(400).json({ error: 'Please add at least one card before syncing statements.' });
  }

  if (period && SYNC_THROTTLE_LIMITS[period]) {
    const usage = await getSyncUsageToday('statement', req.userId);
    if (usage[period] >= SYNC_THROTTLE_LIMITS[period]) {
      return res.status(429).json({ error: `Daily limit reached for "${period}" sync. Try again tomorrow.` });
    }
  }

  const result = triggerSync(accountId, { sinceDays, syncPeriod: period });
  if (result.alreadyRunning) {
    return res.json({ message: 'Sync already in progress' });
  }
  res.json({ message: 'Sync started' });
});

router.get('/sync-throttle', async (req, res) => {
  const [stmtUsage, amzUsage] = await Promise.all([
    getSyncUsageToday('statement', req.userId),
    getSyncUsageToday('amazon_pay', req.userId),
  ]);
  res.json({
    statement: getRemainingAttempts(stmtUsage),
    amazon_pay: getRemainingAttempts(amzUsage),
  });
});

// --- Cards ---

router.get('/cards', async (req, res) => {
  const { data, error } = await supabase
    .from('cards')
    .select('*')
    .eq('user_id', req.userId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/cards', async (req, res) => {
  const { bank, card_number } = req.body;
  if (!bank || !card_number) {
    return res.status(400).json({ error: 'bank and card_number are required' });
  }
  if (card_number.replace(/\s/g, '').length !== 16) {
    return res.status(400).json({ error: 'Card number must be 16 digits' });
  }

  const { data, error } = await supabase
    .from('cards')
    .insert({ bank, card_number: card_number.replace(/\s/g, ''), user_id: req.userId })
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.patch('/cards/:id', async (req, res) => {
  const { bank, card_number } = req.body;

  const updates = {};
  if (bank !== undefined) updates.bank = bank;
  if (card_number !== undefined) updates.card_number = card_number.replace(/\s/g, '');

  const { error } = await supabase.from('cards').update(updates).eq('id', req.params.id).eq('user_id', req.userId);
  if (error) return res.status(500).json({ error: error.message });

  const { data } = await supabase.from('cards').select('*').eq('id', req.params.id).eq('user_id', req.userId).single();
  res.json(data);
});

router.delete('/cards/:id', async (req, res) => {
  const { data } = await supabase
    .from('cards')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.userId)
    .select('id');

  if (!data || data.length === 0) return res.status(404).json({ error: 'Card not found' });
  res.json({ success: true });
});

// --- User Profile ---

router.get('/profile', async (req, res) => {
  const { data, error } = await supabase
    .from('user_profile')
    .select('*')
    .eq('user_id', req.userId)
    .single();

  if (error && error.code !== 'PGRST116') return res.status(500).json({ error: error.message });
  res.json(data || { name: '', dob: '', pan: '' });
});

router.put('/profile', async (req, res) => {
  const { name, dob, pan } = req.body;

  const { data: existing } = await supabase
    .from('user_profile')
    .select('id')
    .eq('user_id', req.userId)
    .single();

  let result;
  if (existing) {
    const { data, error } = await supabase
      .from('user_profile')
      .update({ name: name || '', dob: dob || '', pan: pan || '' })
      .eq('id', existing.id)
      .eq('user_id', req.userId)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    result = data;
  } else {
    const { data, error } = await supabase
      .from('user_profile')
      .insert({ name: name || '', dob: dob || '', pan: pan || '', user_id: req.userId })
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    result = data;
  }

  res.json(result);
});

// --- Sync Jobs ---

router.get('/sync-jobs', async (req, res) => {
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  await supabase
    .from('email_sync_jobs')
    .update({
      status: 'failed',
      error_message: 'Timed out — stuck in progress for over 30 minutes',
      completed_at: new Date().toISOString(),
    })
    .eq('user_id', req.userId)
    .in('status', ['running', 'pending'])
    .not('started_at', 'is', null)
    .lt('started_at', thirtyMinAgo);

  const { data, error } = await supabase
    .from('email_sync_jobs')
    .select('*, email_accounts(email)')
    .eq('user_id', req.userId)
    .order('started_at', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });

  const jobs = data.map(j => ({
    ...j,
    email: j.email_accounts?.email,
    email_accounts: undefined,
  }));
  res.json(jobs);
});

router.get('/sync-schedule', async (req, res) => {
  const now = new Date();

  const nextStatement = new Date(now);
  nextStatement.setHours(6, 0, 0, 0);
  if (now >= nextStatement) {
    nextStatement.setDate(nextStatement.getDate() + 1);
  }

  const nextAmazon = new Date(now);
  const currentHour = now.getHours();
  const nextSlot = Math.ceil((currentHour + 1) / 6) * 6;
  if (nextSlot >= 24) {
    nextAmazon.setDate(nextAmazon.getDate() + 1);
    nextAmazon.setHours(0, 0, 0, 0);
  } else {
    nextAmazon.setHours(nextSlot, 0, 0, 0);
  }

  const { count: amazonCount } = await supabase
    .from('email_accounts')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', req.userId)
    .eq('amazon_pay_sync', true)
    .neq('status', 'disconnected');

  const { count: accountCount } = await supabase
    .from('email_accounts')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', req.userId)
    .neq('status', 'disconnected');

  const hasAmazonPay = (amazonCount || 0) > 0;
  const hasAccounts = (accountCount || 0) > 0;

  res.json({
    statement_sync: {
      enabled: hasAccounts,
      schedule: 'Daily at 6:00 AM',
      next_at: hasAccounts ? nextStatement.toISOString() : null,
    },
    amazon_pay_sync: {
      enabled: hasAmazonPay,
      schedule: 'Every 6 hours',
      next_at: hasAmazonPay ? nextAmazon.toISOString() : null,
    },
  });
});

router.get('/sync-jobs/:id/results', async (req, res) => {
  const { data, error } = await supabase
    .from('email_sync_results')
    .select('*')
    .eq('sync_job_id', req.params.id)
    .eq('user_id', req.userId)
    .order('created_at');

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/sync-results/:id', async (req, res) => {
  const { data: result } = await supabase
    .from('email_sync_results')
    .select('*, email_sync_jobs!inner(email_account_id, email_accounts!inner(user_id))')
    .eq('id', req.params.id)
    .eq('email_sync_jobs.email_accounts.user_id', req.userId)
    .single();

  if (!result) return res.status(404).json({ error: 'Not found' });

  const filenameMatch = result.filename.match(/^\[(\d{4}-\d{2}-\d{2})\]\s*(.+)$/);

  if (result.status === 'success' && filenameMatch) {
    const date = filenameMatch[1];
    const label = filenameMatch[2];

    const amountMatch = label.match(/₹([\d,]+(?:\.\d+)?)/);
    const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : null;

    if (amount) {
      const isRefund = /refund|gift\s*card/i.test(label);

      if (isRefund) {
        const { data: topup } = await supabase
          .from('voucher_topups')
          .select('id, voucher_id, vouchers!inner(user_id)')
          .eq('date', date)
          .eq('amount', amount)
          .eq('source', 'email')
          .eq('vouchers.user_id', req.userId)
          .limit(1)
          .single();

        if (topup) {
          await supabase.from('voucher_topups').delete().eq('id', topup.id);
          const { data: v } = await supabase
            .from('vouchers')
            .select('remaining_amount')
            .eq('id', topup.voucher_id)
            .single();
          await supabase
            .from('vouchers')
            .update({ remaining_amount: v.remaining_amount - amount })
            .eq('id', topup.voucher_id);
        }
      } else {
        const { data: usage } = await supabase
          .from('voucher_usage')
          .select('id, voucher_id, vouchers!inner(user_id)')
          .eq('date', date)
          .eq('amount', amount)
          .eq('vouchers.user_id', req.userId)
          .limit(1)
          .single();

        if (usage) {
          await supabase.from('voucher_usage').delete().eq('id', usage.id);
          const { data: v } = await supabase
            .from('vouchers')
            .select('remaining_amount')
            .eq('id', usage.voucher_id)
            .single();
          await supabase
            .from('vouchers')
            .update({ remaining_amount: v.remaining_amount + amount })
            .eq('id', usage.voucher_id);
        }
      }
    }
  }

  await supabase.from('email_sync_results').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// --- Amazon Pay Sync ---

router.patch('/email-accounts/:id/amazon-pay-sync', async (req, res) => {
  const { enabled } = req.body;
  const accountId = parseInt(req.params.id);

  const { data: account } = await supabase
    .from('email_accounts')
    .select('id')
    .eq('id', accountId)
    .eq('user_id', req.userId)
    .single();

  if (!account) return res.status(404).json({ error: 'Account not found' });

  await supabase
    .from('email_accounts')
    .update({ amazon_pay_sync: !!enabled })
    .eq('id', accountId)
    .eq('user_id', req.userId);

  if (enabled) {
    triggerAmazonPaySync(accountId, { triggerType: 'auto' });
  }

  res.json({ success: true, amazon_pay_sync: !!enabled });
});

router.post('/email-accounts/:id/sync-amazon-pay', async (req, res) => {
  const accountId = parseInt(req.params.id);

  const { data: account } = await supabase
    .from('email_accounts')
    .select('id, amazon_pay_sync')
    .eq('id', accountId)
    .eq('user_id', req.userId)
    .single();

  if (!account) return res.status(404).json({ error: 'Account not found' });
  if (!account.amazon_pay_sync) return res.status(400).json({ error: 'Amazon Pay sync not enabled for this account' });

  const periodMap = { '1w': 7, '1m': 30, '2m': 60 };
  const period = req.body?.period || null;
  const sinceDays = periodMap[period] || undefined;

  if (period && SYNC_THROTTLE_LIMITS[period]) {
    const usage = await getSyncUsageToday('amazon_pay', req.userId);
    if (usage[period] >= SYNC_THROTTLE_LIMITS[period]) {
      return res.status(429).json({ error: `Daily limit reached for "${period}" sync. Try again tomorrow.` });
    }
  }

  const result = triggerAmazonPaySync(accountId, { sinceDays, syncPeriod: period });
  if (result.alreadyRunning) {
    return res.json({ message: 'Amazon Pay sync already in progress' });
  }
  res.json({ message: 'Amazon Pay sync started' });
});

// --- IMAP Detection ---

router.post('/detect-imap', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });

  const settings = detectImapSettings(email);
  if (settings) {
    res.json({ detected: true, ...settings });
  } else {
    res.json({ detected: false });
  }
});

export default router;
