import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { google } from 'googleapis';
import { supabase } from '../models/supabase.js';

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
  const { data: account } = await supabase
    .from('email_accounts')
    .select('*')
    .eq('id', accountId)
    .single();

  if (!account || !account.amazon_pay_sync) return { synced: 0 };

  const { data: job } = await supabase
    .from('email_sync_jobs')
    .insert({
      email_account_id: accountId,
      sync_type: 'amazon_pay',
      trigger_type: triggerType,
      status: 'running',
      started_at: new Date().toISOString(),
      sync_period: syncPeriod || null,
      user_id: account.user_id,
    })
    .select('id')
    .single();

  const jobId = job.id;

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
      const { data: lastSuccess } = await supabase
        .from('email_sync_jobs')
        .select('completed_at')
        .eq('email_account_id', accountId)
        .eq('sync_type', 'amazon_pay')
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(1)
        .single();

      if (lastSuccess && lastSuccess.completed_at) {
        sinceDate = new Date(lastSuccess.completed_at);
        sinceDate.setDate(sinceDate.getDate() - 1);
      } else {
        sinceDate = new Date();
        sinceDate.setMonth(sinceDate.getMonth() - 2);
      }
    }

    const voucher = await getOrCreateAmazonPayVoucher(account.user_id);

    const { data: existingUsage } = await supabase
      .from('voucher_usage')
      .select('date, amount, description')
      .eq('voucher_id', voucher.id);

    const { data: existingTopups } = await supabase
      .from('voucher_topups')
      .select('date, amount, description')
      .eq('voucher_id', voucher.id);

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
              const result = await processTransaction(txn, voucher, existingUsage || [], existingTopups || [], jobId, account.user_id);
              if (result === 'new') newCount++;
              else if (result === 'skipped') skipped++;
              processed++;
            }
            await supabase
              .from('email_sync_jobs')
              .update({ total_attachments: totalFound, processed_attachments: processed, imported_transactions: newCount, failed_attachments: skipped })
              .eq('id', jobId);
            batch = [];
          }
        }

        if (batch.length > 0) {
          const results = await processBatch(batch);
          for (const txn of results) {
            if (txn === null || txn === 'no_match') continue;
            totalFound++;
            const result = await processTransaction(txn, voucher, existingUsage || [], existingTopups || [], jobId, account.user_id);
            if (result === 'new') newCount++;
            else if (result === 'skipped') skipped++;
            processed++;
          }
          await supabase
            .from('email_sync_jobs')
            .update({ total_attachments: totalFound, processed_attachments: processed, imported_transactions: newCount, failed_attachments: skipped })
            .eq('id', jobId);
        }
      } finally {
        lock.release();
      }

      await client.logout();
    } catch (err) {
      try { await client.logout(); } catch {}
      throw new Error(`Amazon Pay sync failed: ${err.message}`);
    }

    await supabase
      .from('email_sync_jobs')
      .update({ status: 'completed', imported_transactions: newCount, failed_attachments: skipped, completed_at: new Date().toISOString() })
      .eq('id', jobId);

    return { jobId, synced: newCount, total: totalFound };
  } catch (err) {
    await supabase
      .from('email_sync_jobs')
      .update({ status: 'failed', error_message: err.message, completed_at: new Date().toISOString() })
      .eq('id', jobId);
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

async function processTransaction(txn, voucher, existingUsage, existingTopups, jobId, userId) {
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
        await supabase
          .from('voucher_usage')
          .update({ email_metadata: txn.emailMetadata })
          .eq('voucher_id', voucher.id)
          .eq('date', date)
          .eq('amount', txn.amount)
          .eq('description', txn.description);
      }
      await supabase.from('email_sync_results').insert({
        sync_job_id: jobId,
        filename: `[${date}] ${label}`,
        status: 'skipped',
        error_message: 'Duplicate',
        user_id: userId,
      });
      return 'skipped';
    }

    await supabase.from('voucher_usage').insert({
      voucher_id: voucher.id,
      amount: txn.amount,
      date,
      description: txn.description,
      email_metadata: txn.emailMetadata || null,
      user_id: userId,
    });

    const { data: v } = await supabase
      .from('vouchers')
      .select('remaining_amount')
      .eq('id', voucher.id)
      .single();

    await supabase
      .from('vouchers')
      .update({ remaining_amount: v.remaining_amount - txn.amount })
      .eq('id', voucher.id);

    await supabase.from('email_sync_results').insert({
      sync_job_id: jobId,
      filename: `[${date}] ${label}`,
      status: 'success',
      transactions_imported: 1,
      user_id: userId,
    });
    existingUsage.push({ date, amount: txn.amount, description: txn.description });
    return 'new';
  } else if (txn.type === 'refund') {
    const isDup = existingTopups.some(t => t.date === date && Math.abs(t.amount - txn.amount) < 0.01);
    if (isDup) {
      if (txn.emailMetadata) {
        await supabase
          .from('voucher_topups')
          .update({ email_metadata: txn.emailMetadata })
          .eq('voucher_id', voucher.id)
          .eq('date', date)
          .eq('amount', txn.amount);
      }
      await supabase.from('email_sync_results').insert({
        sync_job_id: jobId,
        filename: `[${date}] ${label}`,
        status: 'skipped',
        error_message: 'Duplicate',
        user_id: userId,
      });
      return 'skipped';
    }

    await supabase.from('voucher_topups').insert({
      voucher_id: voucher.id,
      amount: txn.amount,
      date,
      description: txn.description,
      source: 'email',
      email_metadata: txn.emailMetadata || null,
      user_id: userId,
    });

    const { data: v } = await supabase
      .from('vouchers')
      .select('remaining_amount')
      .eq('id', voucher.id)
      .single();

    await supabase
      .from('vouchers')
      .update({ remaining_amount: v.remaining_amount + txn.amount })
      .eq('id', voucher.id);

    await supabase.from('email_sync_results').insert({
      sync_job_id: jobId,
      filename: `[${date}] ${label}`,
      status: 'success',
      transactions_imported: 1,
      user_id: userId,
    });
    existingTopups.push({ date, amount: txn.amount });
    return 'new';
  }

  return null;
}

export async function getOrCreateAmazonPayVoucher(userId) {
  const { data: voucher } = await supabase
    .from('vouchers')
    .select('*')
    .eq('name', 'Amazon Pay Balance')
    .eq('user_id', userId)
    .single();

  if (voucher) return voucher;

  const { data: newVoucher } = await supabase
    .from('vouchers')
    .insert({
      name: 'Amazon Pay Balance',
      initial_amount: 0,
      remaining_amount: 0,
      purchase_date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
      user_id: userId,
    })
    .select('*')
    .single();

  return newVoucher;
}

async function getImapAuth(account) {
  if (account.auth_type === 'oauth') {
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
    await supabase
      .from('email_accounts')
      .update({
        access_token: credentials.access_token,
        token_expiry: new Date(credentials.expiry_date).toISOString(),
      })
      .eq('id', account.id);

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
