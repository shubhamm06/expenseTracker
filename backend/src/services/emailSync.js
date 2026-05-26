import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { google } from 'googleapis';
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../models/supabase.js';
import { parsePdf, extractTransactionsFromText, extractSourceFromText } from './pdfParser.js';

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

    const { data: passwords } = await supabase.from('pdf_passwords').select('*');
    let totalFound = 0;
    let totalImported = 0;
    let processed = 0;
    let failed = 0;

    await fetchAndProcessAttachments(account, sinceDate, async (attachment) => {
      totalFound++;
      await supabase
        .from('email_sync_jobs')
        .update({ total_attachments: totalFound })
        .eq('id', jobId);

      const result = await processAttachment(attachment, passwords || [], jobId);
      processed++;
      if (result.success) {
        totalImported += result.transactionsImported;
      } else {
        failed++;
      }
      await supabase
        .from('email_sync_jobs')
        .update({ processed_attachments: processed, imported_transactions: totalImported, failed_attachments: failed })
        .eq('id', jobId);
    });

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
  'account statement',
  'e-statement',
  'estatement',
  'e statement',
  'monthly statement',
  'billing statement',
  'credit card bill',
  'card bill',
  'statement of account',
  'statement for',
  'your statement',
  'new statement',
  'statement ready',
  'statement available',
  'statement generated',
  'statement is ready',
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
];

function isLikelyStatement(subject, filename) {
  const subjectLower = (subject || '').toLowerCase();
  const filenameLower = (filename || '').toLowerCase();
  const combined = `${subjectLower} ${filenameLower}`;

  if (!STATEMENT_KEYWORDS.some(keyword => combined.includes(keyword))) return false;
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
  return CONTENT_EXCLUDE_PATTERNS.some(pattern => pattern.test(snippet));
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

async function processAttachment(attachment, passwords, jobId) {
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

    // Upload to Supabase Storage
    const storagePath = `uploads/email/${Date.now()}-${attachment.filename}`;
    await supabase.storage
      .from('uploads')
      .upload(storagePath, fileBuffer, { contentType: 'application/pdf' });

    await supabase.from('uploaded_files').insert({
      original_name: attachment.filename,
      mime_type: 'application/pdf',
      size: fileBuffer.length,
      storage_path: storagePath,
      status: 'pending',
      source_type: 'email',
      detected_source: detectedSource || null,
      pending_transactions: JSON.stringify(valid),
    });

    await supabase.from('email_sync_results').insert({
      sync_job_id: jobId,
      filename: attachment.filename,
      status: 'success',
      transactions_imported: valid.length,
    });

    return { success: true, transactionsImported: valid.length };
  } catch (err) {
    await supabase.from('email_sync_results').insert({
      sync_job_id: jobId,
      filename: attachment.filename,
      status: 'parse_failed',
      error_message: err.message,
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
