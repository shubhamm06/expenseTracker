import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { getDb } from '../models/db.js';

const AMAZON_PAY_PATTERNS = {
  payment: /Your payment of ₹\s*([\d,]+(?:\.\d+)?)\s*to\s+(.+?)\s+was successful/i,
  refund: /(?:Amazon has added a Refund Gift Card|Refund of ₹\s*([\d,]+(?:\.\d+)?))/i,
  refundAmount: /₹\s*([\d,]+(?:\.\d+)?)/,
};

const AMAZON_SENDERS = [
  'amazon.in',
  'amazon.com',
  'amazonpay',
  'pay.amazon',
];

const RELEVANT_SUBJECT_KEYWORDS = [
  'payment',
  'refund',
  'gift card',
  'pay balance',
  'amazon pay',
  'was successful',
  'added a refund',
];

function isAmazonPayEmail(from, subject) {
  const fromLower = (from || '').toLowerCase();
  if (!AMAZON_SENDERS.some(s => fromLower.includes(s))) return false;

  const subjectLower = (subject || '').toLowerCase();
  return RELEVANT_SUBJECT_KEYWORDS.some(kw => subjectLower.includes(kw));
}

export async function runAmazonPaySync(accountId, { sinceDays, triggerType = 'manual', syncPeriod } = {}) {
  const db = getDb();
  const account = db.prepare('SELECT * FROM email_accounts WHERE id = ?').get(accountId);
  if (!account || !account.amazon_pay_sync) return { synced: 0 };

  const job = db.prepare(`
    INSERT INTO email_sync_jobs (email_account_id, sync_type, trigger_type, status, started_at, sync_period)
    VALUES (?, 'amazon_pay', ?, 'running', datetime('now', '+5 hours', '+30 minutes'), ?)
  `).run(accountId, triggerType, syncPeriod || null);
  const jobId = job.lastInsertRowid;

  try {
    const auth = await getImapAuth(account);
    const client = new ImapFlow({
      host: account.imap_host,
      port: account.imap_port,
      secure: true,
      auth,
      logger: false,
    });

    let sinceDate;
    if (sinceDays) {
      sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - sinceDays);
    } else {
      const lastSuccess = db.prepare(`
        SELECT completed_at FROM email_sync_jobs
        WHERE email_account_id = ? AND sync_type = 'amazon_pay' AND status = 'completed'
        ORDER BY completed_at DESC LIMIT 1
      `).get(accountId);
      if (lastSuccess && lastSuccess.completed_at) {
        sinceDate = new Date(lastSuccess.completed_at);
        sinceDate.setDate(sinceDate.getDate() - 1);
      } else {
        sinceDate = new Date();
        sinceDate.setMonth(sinceDate.getMonth() - 2);
      }
    }

    const voucher = getOrCreateAmazonPayVoucher(db);
    const existingUsage = db.prepare('SELECT date, amount, description FROM voucher_usage WHERE voucher_id = ?').all(voucher.id);
    const existingTopups = db.prepare('SELECT date, amount, description FROM voucher_topups WHERE voucher_id = ?').all(voucher.id);

    let totalFound = 0;
    let processed = 0;
    let newCount = 0;
    let skipped = 0;

    const CONCURRENCY = 8;

    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');

      try {
        const messages = client.fetch(
          { since: sinceDate },
          { source: true }
        );

        let batch = [];

        for await (const msg of messages) {
          batch.push(msg.source);

          if (batch.length >= CONCURRENCY) {
            const results = await processBatch(batch);
            for (const txn of results) {
              if (txn === null || txn === 'no_match') continue;
              totalFound++;
              const result = processTransaction(txn, voucher, existingUsage, existingTopups, jobId, db);
              if (result === 'new') newCount++;
              else if (result === 'skipped') skipped++;
              processed++;
            }
            db.prepare('UPDATE email_sync_jobs SET total_attachments = ?, processed_attachments = ?, imported_transactions = ?, failed_attachments = ? WHERE id = ?')
              .run(totalFound, processed, newCount, skipped, jobId);
            batch = [];
          }
        }

        if (batch.length > 0) {
          const results = await processBatch(batch);
          for (const txn of results) {
            if (txn === null || txn === 'no_match') continue;
            totalFound++;
            const result = processTransaction(txn, voucher, existingUsage, existingTopups, jobId, db);
            if (result === 'new') newCount++;
            else if (result === 'skipped') skipped++;
            processed++;
          }
          db.prepare('UPDATE email_sync_jobs SET total_attachments = ?, processed_attachments = ?, imported_transactions = ?, failed_attachments = ? WHERE id = ?')
            .run(totalFound, processed, newCount, skipped, jobId);
        }
      } finally {
        lock.release();
      }

      await client.logout();
    } catch (err) {
      try { await client.logout(); } catch {}
      throw new Error(`Amazon Pay sync failed: ${err.message}`);
    }

    db.prepare(`
      UPDATE email_sync_jobs SET status = 'completed', imported_transactions = ?, failed_attachments = ?, completed_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?
    `).run(newCount, skipped, jobId);

    return { jobId, synced: newCount, total: totalFound };
  } catch (err) {
    db.prepare(`
      UPDATE email_sync_jobs SET status = 'failed', error_message = ?, completed_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?
    `).run(err.message, jobId);
    throw err;
  }
}

function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<(?:td|th)[^>]*>/gi, '    ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#8377;/gi, '₹')
    .replace(/&#x20B9;/gi, '₹')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n /g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function processBatch(sources) {
  const results = await Promise.all(sources.map(async (source) => {
    const parsed = await simpleParser(source);
    const from = parsed.from?.text || '';
    const subject = parsed.subject || '';
    if (!isAmazonPayEmail(from, subject)) return null;

    const plainBody = parsed.text || '';
    const htmlBody = htmlToText(parsed.html);
    const combined = `${subject} ${plainBody}`;
    const displayBody = htmlBody.length > plainBody.length ? htmlBody : plainBody;

    const emailMetadata = JSON.stringify({
      subject,
      from,
      emailDate: parsed.date?.toISOString() || null,
      bodyFull: displayBody.substring(0, 6000).trim(),
    });

    const txn = parseTransaction(combined, parsed, subject, emailMetadata);
    return txn || 'no_match';
  }));

  return results;
}

function parseTransaction(combined, parsed, subject, emailMetadata) {
  const paymentMatch = combined.match(AMAZON_PAY_PATTERNS.payment);
  if (paymentMatch) {
    return {
      type: 'payment',
      amount: parseFloat(paymentMatch[1].replace(/,/g, '')),
      description: paymentMatch[2].trim(),
      date: parsed.date,
      subject,
      emailMetadata,
    };
  }

  const refundMatch = combined.match(AMAZON_PAY_PATTERNS.refund);
  if (refundMatch) {
    let amount = refundMatch[1] ? parseFloat(refundMatch[1].replace(/,/g, '')) : null;
    if (!amount) {
      const amtMatch = combined.match(AMAZON_PAY_PATTERNS.refundAmount);
      if (amtMatch) amount = parseFloat(amtMatch[1].replace(/,/g, ''));
    }
    if (amount) {
      return {
        type: 'refund',
        amount,
        description: 'Amazon Refund Gift Card',
        date: parsed.date,
        subject,
        emailMetadata,
      };
    }
  }

  return null;
}

function processTransaction(txn, voucher, existingUsage, existingTopups, jobId, db) {
  const date = txn.date
    ? txn.date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
    : new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const label = txn.type === 'payment'
    ? `₹${txn.amount.toLocaleString('en-IN')} to ${txn.description}`
    : `₹${txn.amount.toLocaleString('en-IN')} Refund Gift Card`;

  if (txn.type === 'payment') {
    const isDup = existingUsage.some(u => u.date === date && Math.abs(u.amount - txn.amount) < 0.01 && u.description === txn.description);
    if (isDup) {
      if (txn.emailMetadata) {
        db.prepare('UPDATE voucher_usage SET email_metadata = ? WHERE voucher_id = ? AND date = ? AND amount = ? AND description = ?')
          .run(txn.emailMetadata, voucher.id, date, txn.amount, txn.description);
      }
      db.prepare(`INSERT INTO email_sync_results (sync_job_id, filename, status, error_message) VALUES (?, ?, 'skipped', 'Duplicate')`)
        .run(jobId, `[${date}] ${label}`);
      return 'skipped';
    }

    db.prepare('INSERT INTO voucher_usage (voucher_id, amount, date, description, email_metadata) VALUES (?, ?, ?, ?, ?)')
      .run(voucher.id, txn.amount, date, txn.description, txn.emailMetadata || null);
    db.prepare('UPDATE vouchers SET remaining_amount = remaining_amount - ? WHERE id = ?')
      .run(txn.amount, voucher.id);
    db.prepare(`INSERT INTO email_sync_results (sync_job_id, filename, status, transactions_imported) VALUES (?, ?, 'success', 1)`)
      .run(jobId, `[${date}] ${label}`);
    existingUsage.push({ date, amount: txn.amount, description: txn.description });
    return 'new';
  } else if (txn.type === 'refund') {
    const isDup = existingTopups.some(t => t.date === date && Math.abs(t.amount - txn.amount) < 0.01);
    if (isDup) {
      if (txn.emailMetadata) {
        db.prepare('UPDATE voucher_topups SET email_metadata = ? WHERE voucher_id = ? AND date = ? AND amount = ?')
          .run(txn.emailMetadata, voucher.id, date, txn.amount);
      }
      db.prepare(`INSERT INTO email_sync_results (sync_job_id, filename, status, error_message) VALUES (?, ?, 'skipped', 'Duplicate')`)
        .run(jobId, `[${date}] ${label}`);
      return 'skipped';
    }

    db.prepare('INSERT INTO voucher_topups (voucher_id, amount, date, description, source, email_metadata) VALUES (?, ?, ?, ?, ?, ?)')
      .run(voucher.id, txn.amount, date, txn.description, 'email', txn.emailMetadata || null);
    db.prepare('UPDATE vouchers SET remaining_amount = remaining_amount + ? WHERE id = ?')
      .run(txn.amount, voucher.id);
    db.prepare(`INSERT INTO email_sync_results (sync_job_id, filename, status, transactions_imported) VALUES (?, ?, 'success', 1)`)
      .run(jobId, `[${date}] ${label}`);
    existingTopups.push({ date, amount: txn.amount });
    return 'new';
  }

  return null;
}

export function getOrCreateAmazonPayVoucher(db) {
  let voucher = db.prepare("SELECT * FROM vouchers WHERE name = 'Amazon Pay Balance'").get();
  if (!voucher) {
    const result = db.prepare(`
      INSERT INTO vouchers (name, initial_amount, remaining_amount, purchase_date)
      VALUES ('Amazon Pay Balance', 0, 0, ?)
    `).run(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }));
    voucher = db.prepare('SELECT * FROM vouchers WHERE id = ?').get(result.lastInsertRowid);
  }
  return voucher;
}

async function getImapAuth(account) {
  if (account.auth_type === 'oauth') {
    const { google } = await import('googleapis');
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({
      refresh_token: account.password,
      access_token: account.access_token,
      expiry_date: account.token_expiry ? new Date(account.token_expiry).getTime() : null,
    });

    const { credentials } = await oauth2Client.refreshAccessToken();
    const db = getDb();
    db.prepare('UPDATE email_accounts SET access_token = ?, token_expiry = ? WHERE id = ?')
      .run(credentials.access_token, new Date(credentials.expiry_date).toISOString(), account.id);

    return {
      user: account.email,
      accessToken: credentials.access_token,
    };
  }

  return {
    user: account.email,
    pass: account.password,
  };
}
