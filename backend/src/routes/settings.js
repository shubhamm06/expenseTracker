import { Router } from 'express';
import { google } from 'googleapis';
import { getDb } from '../models/db.js';
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
    scope: [
      'https://mail.google.com/',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
  });
  res.json({ url });
});

router.get('/oauth/google/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.redirect('http://localhost:5173/settings?error=' + encodeURIComponent(error));
  }

  if (!code) {
    return res.redirect('http://localhost:5173/settings?error=no_code');
  }

  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user email
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();
    const email = data.email;

    const db = getDb();
    const existing = db.prepare('SELECT id FROM email_accounts WHERE email = ?').get(email);

    if (existing) {
      // Update tokens for existing account
      db.prepare(`
        UPDATE email_accounts
        SET password = ?, auth_type = 'oauth', access_token = ?, token_expiry = ?, status = 'connected', error_message = NULL
        WHERE id = ?
      `).run(
        tokens.refresh_token || '',
        tokens.access_token,
        tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
        existing.id
      );
      triggerSync(existing.id, { triggerType: 'auto' });
    } else {
      // Create new account
      const result = db.prepare(`
        INSERT INTO email_accounts (email, imap_host, imap_port, password, auth_type, access_token, token_expiry, display_name)
        VALUES (?, 'imap.gmail.com', 993, ?, 'oauth', ?, ?, ?)
      `).run(
        email,
        tokens.refresh_token || '',
        tokens.access_token,
        tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
        data.name || email
      );
      triggerSync(result.lastInsertRowid, { triggerType: 'auto' });
    }

    res.redirect('http://localhost:5173/settings?success=connected&email=' + encodeURIComponent(email));
  } catch (err) {
    console.error('[OAuth] Token exchange failed:', err.message);
    res.redirect('http://localhost:5173/settings?error=' + encodeURIComponent(err.message));
  }
});

// --- Email Accounts ---

router.get('/email-accounts', (req, res) => {
  const db = getDb();
  const accounts = db.prepare(`
    SELECT id, email, imap_host, imap_port, display_name, auth_type, amazon_pay_sync, status, last_sync_at, error_message, created_at
    FROM email_accounts ORDER BY created_at DESC
  `).all();

  const enriched = accounts.map(a => ({
    ...a,
    sync_running: isSyncRunning(a.id),
    amazon_pay_sync_running: isAmazonPaySyncRunning(a.id),
  }));

  res.json(enriched);
});

router.post('/email-accounts', (req, res) => {
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

  const db = getDb();
  try {
    const result = db.prepare(`
      INSERT INTO email_accounts (email, imap_host, imap_port, password, auth_type, display_name)
      VALUES (?, ?, ?, ?, 'password', ?)
    `).run(email, host, port, password, display_name || null);

    const accountId = result.lastInsertRowid;
    triggerSync(accountId, { triggerType: 'auto' });

    res.json({
      id: accountId,
      email,
      imap_host: host,
      imap_port: port,
      status: 'connected',
      sync_started: true,
    });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'This email is already connected' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.delete('/email-accounts/:id', (req, res) => {
  const db = getDb();
  const account = db.prepare('SELECT id FROM email_accounts WHERE id = ?').get(req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  const jobIds = db.prepare('SELECT id FROM email_sync_jobs WHERE email_account_id = ?').all(req.params.id).map(j => j.id);
  if (jobIds.length > 0) {
    const placeholders = jobIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM email_sync_results WHERE sync_job_id IN (${placeholders})`).run(...jobIds);
  }
  db.prepare('DELETE FROM email_sync_jobs WHERE email_account_id = ?').run(req.params.id);
  db.prepare('DELETE FROM email_accounts WHERE id = ?').run(req.params.id);

  res.json({ success: true });
});

router.post('/email-accounts/:id/sync', (req, res) => {
  const accountId = parseInt(req.params.id);
  const db = getDb();
  const account = db.prepare('SELECT id FROM email_accounts WHERE id = ?').get(accountId);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  const periodMap = { '1w': 7, '1m': 30, '2m': 60, '6m': 180, '12m': 365 };
  const period = req.body?.period || null;
  const sinceDays = periodMap[period] || undefined;

  const result = triggerSync(accountId, { sinceDays, syncPeriod: period });
  if (result.alreadyRunning) {
    return res.json({ message: 'Sync already in progress' });
  }
  res.json({ message: 'Sync started' });
});

// --- PDF Passwords ---

router.get('/passwords', (req, res) => {
  const db = getDb();
  const passwords = db.prepare(`
    SELECT id, label, password, source_match, created_at FROM pdf_passwords ORDER BY created_at DESC
  `).all();
  res.json(passwords);
});

router.post('/passwords', (req, res) => {
  const { label, password, source_match } = req.body;
  if (!label || !password) {
    return res.status(400).json({ error: 'label and password are required' });
  }

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO pdf_passwords (label, password, source_match) VALUES (?, ?, ?)
  `).run(label, password, source_match || null);

  res.json({ id: result.lastInsertRowid, label, password, source_match });
});

router.patch('/passwords/:id', (req, res) => {
  const { label, password, source_match } = req.body;
  const db = getDb();
  const existing = db.prepare('SELECT id FROM pdf_passwords WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Password not found' });

  if (label !== undefined) db.prepare('UPDATE pdf_passwords SET label = ? WHERE id = ?').run(label, req.params.id);
  if (password !== undefined) db.prepare('UPDATE pdf_passwords SET password = ? WHERE id = ?').run(password, req.params.id);
  if (source_match !== undefined) db.prepare('UPDATE pdf_passwords SET source_match = ? WHERE id = ?').run(source_match || null, req.params.id);

  const updated = db.prepare('SELECT id, label, password, source_match, created_at FROM pdf_passwords WHERE id = ?').get(req.params.id);
  res.json(updated);
});

router.delete('/passwords/:id', (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM pdf_passwords WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Password not found' });
  res.json({ success: true });
});

// --- Sync Jobs ---

router.get('/sync-jobs', (req, res) => {
  const db = getDb();

  db.prepare(`
    UPDATE email_sync_jobs
    SET status = 'failed',
        error_message = 'Timed out — stuck in progress for over 30 minutes',
        completed_at = datetime('now', '+5 hours', '+30 minutes')
    WHERE status IN ('running', 'pending')
      AND started_at IS NOT NULL
      AND datetime(started_at) < datetime('now', '+5 hours', '+30 minutes', '-30 minutes')
  `).run();

  const jobs = db.prepare(`
    SELECT j.*, e.email
    FROM email_sync_jobs j
    JOIN email_accounts e ON e.id = j.email_account_id
    ORDER BY j.started_at DESC
    LIMIT 50
  `).all();
  res.json(jobs);
});

router.get('/sync-schedule', (req, res) => {
  const now = new Date();

  // Credit card sync: daily at 6 AM IST
  const nextStatement = new Date(now);
  nextStatement.setHours(6, 0, 0, 0);
  if (now >= nextStatement) {
    nextStatement.setDate(nextStatement.getDate() + 1);
  }

  // Amazon Pay sync: every 6 hours (0, 6, 12, 18)
  const nextAmazon = new Date(now);
  const currentHour = now.getHours();
  const nextSlot = Math.ceil((currentHour + 1) / 6) * 6;
  if (nextSlot >= 24) {
    nextAmazon.setDate(nextAmazon.getDate() + 1);
    nextAmazon.setHours(0, 0, 0, 0);
  } else {
    nextAmazon.setHours(nextSlot, 0, 0, 0);
  }

  const db = getDb();
  const hasAmazonPay = db.prepare("SELECT COUNT(*) as count FROM email_accounts WHERE amazon_pay_sync = 1 AND status != 'disconnected'").get().count > 0;
  const hasAccounts = db.prepare("SELECT COUNT(*) as count FROM email_accounts WHERE status != 'disconnected'").get().count > 0;

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

router.get('/sync-jobs/:id/results', (req, res) => {
  const db = getDb();
  const results = db.prepare(`
    SELECT * FROM email_sync_results WHERE sync_job_id = ? ORDER BY created_at
  `).all(req.params.id);
  res.json(results);
});

router.delete('/sync-results/:id', (req, res) => {
  const db = getDb();
  const result = db.prepare('SELECT * FROM email_sync_results WHERE id = ?').get(req.params.id);
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
        const topup = db.prepare(
          'SELECT id, voucher_id FROM voucher_topups WHERE date = ? AND amount = ? AND source = ?'
        ).get(date, amount, 'email');
        if (topup) {
          db.prepare('DELETE FROM voucher_topups WHERE id = ?').run(topup.id);
          db.prepare('UPDATE vouchers SET remaining_amount = remaining_amount - ? WHERE id = ?')
            .run(amount, topup.voucher_id);
        }
      } else {
        const usage = db.prepare(
          'SELECT id, voucher_id FROM voucher_usage WHERE date = ? AND amount = ?'
        ).get(date, amount);
        if (usage) {
          db.prepare('DELETE FROM voucher_usage WHERE id = ?').run(usage.id);
          db.prepare('UPDATE vouchers SET remaining_amount = remaining_amount + ? WHERE id = ?')
            .run(amount, usage.voucher_id);
        }
      }
    }
  }

  db.prepare('DELETE FROM email_sync_results WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// --- Amazon Pay Sync ---

router.patch('/email-accounts/:id/amazon-pay-sync', (req, res) => {
  const db = getDb();
  const { enabled } = req.body;
  const accountId = parseInt(req.params.id);
  const account = db.prepare('SELECT id FROM email_accounts WHERE id = ?').get(accountId);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  db.prepare('UPDATE email_accounts SET amazon_pay_sync = ? WHERE id = ?')
    .run(enabled ? 1 : 0, accountId);

  if (enabled) {
    triggerAmazonPaySync(accountId, { triggerType: 'auto' });
  }

  res.json({ success: true, amazon_pay_sync: enabled ? 1 : 0 });
});

router.post('/email-accounts/:id/sync-amazon-pay', (req, res) => {
  const accountId = parseInt(req.params.id);
  const db = getDb();
  const account = db.prepare('SELECT id, amazon_pay_sync FROM email_accounts WHERE id = ?').get(accountId);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  if (!account.amazon_pay_sync) return res.status(400).json({ error: 'Amazon Pay sync not enabled for this account' });

  const periodMap = { '1w': 7, '1m': 30, '2m': 60, '6m': 180, '12m': 365 };
  const period = req.body?.period || null;
  const sinceDays = periodMap[period] || undefined;

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
