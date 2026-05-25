import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { google } from 'googleapis';
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../models/db.js';
import { parsePdf, extractTransactionsFromText, extractSourceFromText } from './pdfParser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = join(__dirname, '../../tmp/email-attachments');

if (!existsSync(TEMP_DIR)) {
  mkdirSync(TEMP_DIR, { recursive: true });
}

export async function runSyncForAccount(accountId, { sinceDays, triggerType = 'manual', syncPeriod } = {}) {
  const db = getDb();
  const account = db.prepare('SELECT * FROM email_accounts WHERE id = ?').get(accountId);
  if (!account) throw new Error('Account not found');

  const job = db.prepare(`
    INSERT INTO email_sync_jobs (email_account_id, sync_type, trigger_type, status, started_at, sync_period)
    VALUES (?, 'statement', ?, 'running', datetime('now', '+5 hours', '+30 minutes'), ?)
  `).run(accountId, triggerType, syncPeriod || null);
  const jobId = job.lastInsertRowid;

  try {
    let sinceDate;
    if (sinceDays) {
      sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - sinceDays);
    } else if (account.last_sync_at) {
      sinceDate = new Date(account.last_sync_at + (account.last_sync_at.includes('Z') ? '' : 'Z'));
    } else {
      sinceDate = new Date();
      sinceDate.setMonth(sinceDate.getMonth() - 2);
    }

    const passwords = db.prepare('SELECT * FROM pdf_passwords').all();
    let totalFound = 0;
    let totalImported = 0;
    let processed = 0;
    let failed = 0;

    await fetchAndProcessAttachments(account, sinceDate, async (attachment) => {
      totalFound++;
      db.prepare('UPDATE email_sync_jobs SET total_attachments = ? WHERE id = ?')
        .run(totalFound, jobId);

      const result = await processAttachment(attachment, passwords, jobId, db);
      processed++;
      if (result.success) {
        totalImported += result.transactionsImported;
      } else {
        failed++;
      }
      db.prepare(`
        UPDATE email_sync_jobs SET processed_attachments = ?, imported_transactions = ?, failed_attachments = ? WHERE id = ?
      `).run(processed, totalImported, failed, jobId);
    });

    db.prepare(`
      UPDATE email_sync_jobs SET status = 'completed', completed_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?
    `).run(jobId);
    db.prepare(`UPDATE email_accounts SET last_sync_at = datetime('now', '+5 hours', '+30 minutes'), status = 'connected', error_message = NULL WHERE id = ?`)
      .run(accountId);

    return { jobId, totalAttachments: totalFound, imported: totalImported, failed };
  } catch (err) {
    db.prepare(`
      UPDATE email_sync_jobs SET status = 'failed', error_message = ?, completed_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?
    `).run(err.message, jobId);
    db.prepare(`UPDATE email_accounts SET status = 'error', error_message = ? WHERE id = ?`)
      .run(err.message, accountId);
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

async function processAttachment(attachment, passwords, jobId, db) {
  const tempPath = join(TEMP_DIR, `${Date.now()}-${attachment.filename}`);

  try {
    writeFileSync(tempPath, attachment.content);

    const source = await tryExtractWithPasswords(tempPath, passwords, attachment.filename);

    if (!source) {
      db.prepare(`
        INSERT INTO email_sync_results (sync_job_id, filename, status, error_message)
        VALUES (?, ?, 'password_failed', 'No matching password found')
      `).run(jobId, attachment.filename);
      return { success: false };
    }

    const { text, detectedSource } = source;

    if (isExcludedContent(text)) {
      db.prepare(`
        INSERT INTO email_sync_results (sync_job_id, filename, status, error_message)
        VALUES (?, ?, 'skipped', 'Not a bank/card statement (bill, FD, or other document)')
      `).run(jobId, attachment.filename);
      return { success: false };
    }

    const transactions = extractTransactionsFromText(text, detectedSource);

    if (transactions.length === 0) {
      db.prepare(`
        INSERT INTO email_sync_results (sync_job_id, filename, status, error_message)
        VALUES (?, ?, 'parse_failed', 'No transactions extracted')
      `).run(jobId, attachment.filename);
      return { success: false };
    }

    const valid = transactions.filter(t => t.amount < 10000000);
    if (valid.length === 0) {
      db.prepare(`
        INSERT INTO email_sync_results (sync_job_id, filename, status, error_message)
        VALUES (?, ?, 'parse_failed', 'Extracted amounts are invalid')
      `).run(jobId, attachment.filename);
      return { success: false };
    }

    // Store decrypted PDF if a password was used
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

    // Store as pending for manual review — do NOT auto-import
    db.prepare(`
      INSERT INTO uploaded_files (original_name, mime_type, size, data, status, source_type, detected_source, pending_transactions)
      VALUES (?, 'application/pdf', ?, ?, 'pending', 'email', ?, ?)
    `).run(
      attachment.filename,
      fileBuffer.length,
      fileBuffer,
      detectedSource || null,
      JSON.stringify(valid)
    );

    db.prepare(`
      INSERT INTO email_sync_results (sync_job_id, filename, status, transactions_imported)
      VALUES (?, ?, 'success', ?)
    `).run(jobId, attachment.filename, valid.length);

    return { success: true, transactionsImported: valid.length };
  } catch (err) {
    db.prepare(`
      INSERT INTO email_sync_results (sync_job_id, filename, status, error_message)
      VALUES (?, ?, 'parse_failed', ?)
    `).run(jobId, attachment.filename, err.message);
    return { success: false };
  } finally {
    if (existsSync(tempPath)) {
      try { unlinkSync(tempPath); } catch {}
    }
  }
}

async function tryExtractWithPasswords(filePath, passwords, filename) {
  // First try without password (unencrypted PDF)
  try {
    const { text } = await parsePdf(filePath, null);
    const detectedSource = extractSourceFromText(text);
    return { text, detectedSource, usedPassword: null };
  } catch (err) {
    if (err.message !== 'PASSWORD_REQUIRED') {
      throw err;
    }
  }

  // Try to match password by source_match against filename
  const filenameLower = filename.toLowerCase();
  const matchedPasswords = passwords.filter(p =>
    p.source_match && filenameLower.includes(p.source_match.toLowerCase())
  );
  const unmatchedPasswords = passwords.filter(p =>
    !p.source_match || !filenameLower.includes(p.source_match.toLowerCase())
  );

  // Try matched passwords first, then all others
  const orderedPasswords = [...matchedPasswords, ...unmatchedPasswords];

  for (const pwEntry of orderedPasswords) {
    try {
      const { text } = await parsePdf(filePath, pwEntry.password);
      const detectedSource = extractSourceFromText(text);

      // If we got a source from the PDF, check if it matches the password's source_match
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

function importTransactions(transactions, source, db) {
  const rules = db.prepare('SELECT * FROM rules').all();
  const insertStmt = db.prepare(`
    INSERT INTO transactions (date, description, amount, type, category_id, source)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const dupCheckStmt = db.prepare(`
    SELECT COUNT(*) as count FROM transactions
    WHERE date = ? AND description = ? AND amount = ? AND type = ?
  `);

  let imported = 0;
  const importMany = db.transaction((rows) => {
    for (const row of rows) {
      const date = normalizeDate(row.date);
      if (!date || !row.amount) continue;

      const description = row.description || '';
      const type = row.type || 'debit';

      const existing = dupCheckStmt.get(date, description, row.amount, type);
      if (existing.count > 0) continue;

      let categoryId = null;
      const descLower = description.toLowerCase();
      for (const rule of rules) {
        if (descLower.includes(rule.pattern)) {
          categoryId = rule.category_id;
          break;
        }
      }

      insertStmt.run(date, description, row.amount, type, categoryId, source || null);
      imported++;
    }
  });

  importMany(transactions);
  return imported;
}

function normalizeDate(dateStr) {
  const str = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  const ddmmyyyy = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const ddmmyy = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/);
  if (ddmmyy) {
    const [, day, month, yr] = ddmmyy;
    const year = parseInt(yr) > 50 ? `19${yr}` : `20${yr}`;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const ddMonYyyy = str.match(/^(\d{1,2})\s+(\w{3})\s+(\d{4})$/);
  if (ddMonYyyy) {
    const [, day, mon, year] = ddMonYyyy;
    const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
    const m = months[mon.toLowerCase()];
    if (m) return `${year}-${m}-${day.padStart(2, '0')}`;
  }

  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  return null;
}
