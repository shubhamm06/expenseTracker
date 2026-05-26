import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { google } from 'googleapis';
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../models/supabase.js';
import { parsePdf, extractTransactionsFromText, extractSourceFromText, extractDueDateFromText } from './pdfParser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = join(__dirname, '../../tmp/email-attachments');

if (!existsSync(TEMP_DIR)) {
  mkdirSync(TEMP_DIR, { recursive: true });
}

export async function runSyncForAccount(accountId, { sinceDays, triggerType = 'manual', syncPeriod } = {}) {
  const { data: account } = await supabase
    .from('email_accounts')
    .select('*')
    .eq('id', accountId)
    .single();

  if (!account) throw new Error('Account not found');

  const { data: job } = await supabase
    .from('email_sync_jobs')
    .insert({
      email_account_id: accountId,
      sync_type: 'statement',
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
    let sinceDate;
    if (sinceDays) {
      sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - sinceDays);
    } else if (account.last_sync_at) {
      sinceDate = new Date(account.last_sync_at);
    } else {
      sinceDate = new Date();
      sinceDate.setMonth(sinceDate.getMonth() - 2);
    }

    const { data: cards } = await supabase.from('cards').select('*');
    const { data: profile } = await supabase.from('user_profile').select('*').limit(1).single();
    const { generatePasswords } = await import('./passwordGenerator.js');
    const passwords = generatePasswords(cards || [], profile || {});

    // Per-user dedup: track files already processed to avoid duplicate pending entries
    // Uses detected_source + first transaction date to differentiate same-bank statements from different months
    let alreadySyncedKeys = new Set();
    if (sinceDays) {
      const { data: existingFiles } = await supabase
        .from('uploaded_files')
        .select('original_name, detected_source, pending_transactions')
        .eq('source_type', 'email')
        .eq('user_id', account.user_id)
        .in('status', ['pending', 'imported']);
      if (existingFiles) {
        for (const f of existingFiles) {
          let firstDate = '';
          if (f.pending_transactions) {
            try {
              const txns = JSON.parse(f.pending_transactions);
              if (txns.length > 0) firstDate = txns[0].date || '';
            } catch {}
          }
          alreadySyncedKeys.add(`${(f.detected_source || '').toLowerCase()}|${firstDate}`);
        }
      }
    }

    let totalFound = 0;
    let totalImported = 0;
    let processed = 0;
    let failed = 0;

    let lastProgressUpdate = 0;
    await fetchAndProcessAttachments(account, sinceDate, async (attachment) => {
      totalFound++;

      const result = await processAttachment(attachment, passwords || [], jobId, account.user_id, alreadySyncedKeys);
      processed++;
      if (result.success) {
        totalImported++;
      } else {
        failed++;
      }

      // Batch progress updates - every 3 attachments or when done
      if (processed - lastProgressUpdate >= 3) {
        lastProgressUpdate = processed;
        supabase
          .from('email_sync_jobs')
          .update({ total_attachments: totalFound, processed_attachments: processed, imported_transactions: totalImported, failed_attachments: failed })
          .eq('id', jobId)
          .then(() => {});
      }
    });

    // Final progress update
    await supabase
      .from('email_sync_jobs')
      .update({ total_attachments: totalFound, processed_attachments: processed, imported_transactions: totalImported, failed_attachments: failed })
      .eq('id', jobId);

    await supabase
      .from('email_sync_jobs')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', jobId);

    await supabase
      .from('email_accounts')
      .update({ last_sync_at: new Date().toISOString(), status: 'connected', error_message: null })
      .eq('id', accountId);

    return { jobId, totalAttachments: totalFound, imported: totalImported, failed };
  } catch (err) {
    await supabase
      .from('email_sync_jobs')
      .update({ status: 'failed', error_message: err.message, completed_at: new Date().toISOString() })
      .eq('id', jobId);

    await supabase
      .from('email_accounts')
      .update({ status: 'error', error_message: err.message })
      .eq('id', accountId);

    throw err;
  }
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

const STATEMENT_KEYWORDS = [
  'credit card statement',
  'card statement',
  'card bill',
  'credit card bill',
  'card e-statement',
  'card estatement',
  'credit card sta',
];

// Subject must contain "card" to qualify as a credit card statement email
const SUBJECT_REQUIRED_KEYWORDS = [
  'card',
];

const EXCLUDE_SUBJECT_KEYWORDS = [
  'fixed deposit',
  'fd interest',
  'fd receipt',
  'fd advice',
  'wifi',
  'wi-fi',
  'broadband',
  'internet bill',
  'electricity',
  'electric bill',
  'power bill',
  'water bill',
  'gas bill',
  'telephone bill',
  'phone bill',
  'mobile bill',
  'postpaid',
  'prepaid',
  'recharge',
  'dth',
  'insurance',
  'lic',
  'policy',
  'premium',
  'tax receipt',
  'tds certificate',
  'form 16',
  'form 26as',
  'itr',
  'rental agreement',
  'rent receipt',
  'invoice',
  'gst invoice',
  'salary slip',
  'payslip',
  'booking',
  'ticket',
  'eticket',
  'e-ticket',
  'order',
  'receipt',
  'quote',
  'proforma',
  'portfolio',
  'notice',
  'terms',
  'conditions',
  'maintenance',
  'claim',
];

const EXCLUDE_FILENAME_PATTERNS = [
  /invoice/i,
  /gst/i,
  /receipt/i,
  /eticket/i,
  /e-?ticket/i,
  /booking/i,
  /quote/i,
  /premium/i,
  /proforma/i,
  /policy/i,
  /insurance/i,
  /electricity/i,
  /maintenance/i,
  /taco\//i,
  /_merged\.pdf$/i,
  /attach\d*(electricity|maintenance|bill)/i,
  /portfolio/i,
  /notice/i,
  /claim/i,
  /cis_form/i,
  /rules.*policy/i,
  /fdint/i,
  /rd_advice/i,
  /retention/i,
  /agts_fy/i,
  /^NU\d{6,}/i,
  /terms.*conditions/i,
  /^GH\d{8,}/i,
  /\d+-\d*CF-/i,
  // Bank statements (not credit card)
  /Email_Bank_Statement/i,
  /Bank_Statement/i,
  /^\w+_\w+_\d{8}_\d+\.pdf$/i,  // Pattern: Name_Name_DDMMYYYY_Number.pdf (bank statements)
  // CAMS statements
  /_TXN\.pdf$/i,
  /^[A-Z]{3}\d{4}_[A-Z]{2}\d+_TXN/i,  // APR2026_AA06545515_TXN pattern
  /CAMS/i,
];

function isLikelyStatement(subject, filename) {
  const subjectLower = (subject || '').toLowerCase();
  const filenameLower = (filename || '').toLowerCase();

  // Must have "card" somewhere in the subject
  if (!SUBJECT_REQUIRED_KEYWORDS.some(kw => subjectLower.includes(kw))) return false;

  // Must match at least one statement keyword in subject or filename
  const combined = `${subjectLower} ${filenameLower}`;
  if (!STATEMENT_KEYWORDS.some(keyword => combined.includes(keyword))) return false;

  // Exclusions
  if (EXCLUDE_SUBJECT_KEYWORDS.some(keyword => subjectLower.includes(keyword))) return false;
  if (EXCLUDE_FILENAME_PATTERNS.some(pattern => pattern.test(filenameLower))) return false;
  return true;
}

const CONTENT_EXCLUDE_PATTERNS = [
  /postpaid\s*(wi-?fi|broadband|mobile)\s*(monthly\s*)?statement/i,
  /monthly\s*rental/i,
  /wifi.*plan/i,
  /broadband.*plan/i,
  /fixed\s*deposit/i,
  /fd\s*(interest|receipt|advice|certificate)/i,
  /term\s*deposit/i,
  /maturity\s*(amount|date|value)/i,
  /interest\s*certificate/i,
  /tds\s*(certificate|deducted)/i,
  /form\s*(16|26as)/i,
  /electricity\s*(bill|charges)/i,
  /power\s*(bill|consumption)/i,
  /water\s*(bill|charges)/i,
  /gas\s*(bill|connection)/i,
  /insurance\s*(policy|premium|certificate)/i,
  /life\s*insurance/i,
  /policy\s*document/i,
  /salary\s*slip/i,
  /pay\s*slip/i,
];

function isExcludedContent(text) {
  const snippet = text.substring(0, 3000).toLowerCase();
  if (CONTENT_EXCLUDE_PATTERNS.some(pattern => pattern.test(snippet))) return true;
  // Must contain "credit card" somewhere in the document to confirm it's a card statement
  if (!snippet.includes('credit card') && !snippet.includes('card number') && !snippet.includes('card no')) return true;
  return false;
}

async function fetchAndProcessAttachments(account, sinceDate, onAttachment) {
  const auth = await getImapAuth(account);
  const client = new ImapFlow({
    host: account.imap_host,
    port: account.imap_port,
    secure: true,
    auth,
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    try {
      const messages = client.fetch(
        { since: sinceDate },
        { source: true }
      );

      for await (const msg of messages) {
        const parsed = await simpleParser(msg.source);
        if (!parsed.attachments || parsed.attachments.length === 0) continue;

        const subject = parsed.subject || '';

        for (const att of parsed.attachments) {
          const filename = att.filename || '';
          if (!filename.toLowerCase().endsWith('.pdf')) continue;
          if (!isLikelyStatement(subject, filename)) continue;

          await onAttachment({
            filename,
            content: att.content,
            subject,
            date: parsed.date,
          });
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err) {
    try { await client.logout(); } catch {}
    throw new Error(`IMAP connection failed: ${err.message}`);
  }
}

async function processAttachment(attachment, passwords, jobId, userId, alreadySyncedKeys) {
  const tempPath = join(TEMP_DIR, `${Date.now()}-${attachment.filename}`);

  try {
    writeFileSync(tempPath, attachment.content);

    const source = await tryExtractWithPasswords(tempPath, passwords, attachment.filename);

    if (!source) {
      await supabase.from('email_sync_results').insert({
        sync_job_id: jobId,
        filename: attachment.filename,
        status: 'password_failed',
        error_message: 'No matching password found',
        user_id: userId,
      });
      return { success: false };
    }

    const { text, detectedSource } = source;

    if (isExcludedContent(text)) {
      await supabase.from('email_sync_results').insert({
        sync_job_id: jobId,
        filename: attachment.filename,
        status: 'skipped',
        error_message: 'Not a bank/card statement (bill, FD, or other document)',
        user_id: userId,
      });
      return { success: false };
    }

    const transactions = extractTransactionsFromText(text, detectedSource);

    if (transactions.length === 0) {
      await supabase.from('email_sync_results').insert({
        sync_job_id: jobId,
        filename: attachment.filename,
        status: 'parse_failed',
        error_message: 'No transactions extracted',
        user_id: userId,
      });
      return { success: false };
    }

    const valid = transactions.filter(t => t.amount < 10000000);
    if (valid.length === 0) {
      await supabase.from('email_sync_results').insert({
        sync_job_id: jobId,
        filename: attachment.filename,
        status: 'parse_failed',
        error_message: 'Extracted amounts are invalid',
        user_id: userId,
      });
      return { success: false };
    }

    let fileBuffer = attachment.content;
    if (source.usedPassword) {
      const decryptedPath = tempPath + '.decrypted.pdf';
      try {
        execFileSync('qpdf', ['--password=' + source.usedPassword.password, '--decrypt', tempPath, decryptedPath]);
        fileBuffer = readFileSync(decryptedPath);
      } catch {
        if (existsSync(decryptedPath)) {
          fileBuffer = readFileSync(decryptedPath);
        }
      } finally {
        if (existsSync(decryptedPath)) try { unlinkSync(decryptedPath); } catch {}
      }
    }

    const dueDate = extractDueDateFromText(text);

    // Per-user dedup: skip if this source + first transaction date combo already exists
    const firstTxnDate = valid.length > 0 ? (valid[0].date || '') : '';
    const displayName = `${attachment.filename}${detectedSource ? ' · ' + detectedSource : ''}${firstTxnDate ? ' · ' + firstTxnDate : ''}`;

    if (alreadySyncedKeys && alreadySyncedKeys.has(`${(detectedSource || '').toLowerCase()}|${firstTxnDate}`)) {
      await supabase.from('email_sync_results').insert({
        sync_job_id: jobId,
        filename: displayName,
        status: 'skipped',
        error_message: 'Already synced',
        user_id: userId,
      });
      return { success: false, skipped: true };
    }

    // Upload to Supabase Storage
    const storagePath = `uploads/email/${Date.now()}-${attachment.filename}`;
    await supabase.storage
      .from('uploads')
      .upload(storagePath, fileBuffer, { contentType: 'application/pdf' });

    await supabase.from('uploaded_files').insert({
      original_name: displayName,
      mime_type: 'application/pdf',
      size: fileBuffer.length,
      storage_path: storagePath,
      status: 'pending',
      source_type: 'email',
      detected_source: detectedSource || null,
      pending_transactions: JSON.stringify(valid),
      due_date: dueDate || null,
      user_id: userId,
    });

    await supabase.from('email_sync_results').insert({
      sync_job_id: jobId,
      filename: displayName,
      status: 'success',
      transactions_imported: valid.length,
      user_id: userId,
    });

    return { success: true, transactionsImported: valid.length };
  } catch (err) {
    await supabase.from('email_sync_results').insert({
      sync_job_id: jobId,
      filename: attachment.filename,
      status: 'parse_failed',
      error_message: err.message,
      user_id: userId,
    });
    return { success: false };
  } finally {
    if (existsSync(tempPath)) {
      try { unlinkSync(tempPath); } catch {}
    }
  }
}

async function tryExtractWithPasswords(filePath, passwords, filename) {
  try {
    const { text } = await parsePdf(filePath, null);
    const detectedSource = extractSourceFromText(text);
    return { text, detectedSource, usedPassword: null };
  } catch (err) {
    if (err.message !== 'PASSWORD_REQUIRED') {
      throw err;
    }
  }

  const filenameLower = filename.toLowerCase();
  const matchedPasswords = passwords.filter(p =>
    p.source_match && filenameLower.includes(p.source_match.toLowerCase())
  );
  const unmatchedPasswords = passwords.filter(p =>
    !p.source_match || !filenameLower.includes(p.source_match.toLowerCase())
  );

  const orderedPasswords = [...matchedPasswords, ...unmatchedPasswords];

  for (const pwEntry of orderedPasswords) {
    try {
      const { text } = await parsePdf(filePath, pwEntry.password);
      const detectedSource = extractSourceFromText(text);

      if (detectedSource && pwEntry.source_match) {
        const srcLower = detectedSource.toLowerCase();
        const matchLower = pwEntry.source_match.toLowerCase();
        if (srcLower.includes(matchLower) || matchLower.includes(srcLower)) {
          return { text, detectedSource, usedPassword: pwEntry };
        }
      }

      return { text, detectedSource, usedPassword: pwEntry };
    } catch {
      continue;
    }
  }

  return null;
}
