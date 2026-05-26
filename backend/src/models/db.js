import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, '../../data/expenses.db');

let db;

export function getDb() {
  if (!db) {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

export function initDb() {
  const database = getDb();

  database.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#6b7280'
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('debit', 'credit')),
      category_id INTEGER,
      source TEXT,
      is_reimbursable INTEGER DEFAULT 0,
      is_voucher_purchase INTEGER DEFAULT 0,
      voucher_id INTEGER,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
      FOREIGN KEY (category_id) REFERENCES categories(id),
      FOREIGN KEY (voucher_id) REFERENCES vouchers(id)
    );

    CREATE TABLE IF NOT EXISTS rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      category_id INTEGER NOT NULL,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS vouchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      initial_amount REAL NOT NULL,
      remaining_amount REAL NOT NULL,
      purchase_date TEXT NOT NULL,
      source_transaction_id INTEGER,
      FOREIGN KEY (source_transaction_id) REFERENCES transactions(id)
    );

    CREATE TABLE IF NOT EXISTS voucher_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voucher_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      description TEXT,
      category_id INTEGER,
      FOREIGN KEY (voucher_id) REFERENCES vouchers(id),
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS uploaded_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      data BLOB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'imported', 'failed')),
      status_message TEXT,
      transactions_imported INTEGER DEFAULT 0,
      source_type TEXT NOT NULL DEFAULT 'manual' CHECK(source_type IN ('manual', 'email')),
      detected_source TEXT,
      pending_transactions TEXT,
      uploaded_at TEXT DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
    );
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS email_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      imap_host TEXT NOT NULL,
      imap_port INTEGER NOT NULL DEFAULT 993,
      password TEXT NOT NULL DEFAULT '',
      auth_type TEXT NOT NULL DEFAULT 'password' CHECK(auth_type IN ('password', 'oauth')),
      access_token TEXT,
      token_expiry TEXT,
      display_name TEXT,
      amazon_pay_sync INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'connected' CHECK(status IN ('connected', 'disconnected', 'error')),
      last_sync_at TEXT,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
    );

    CREATE TABLE IF NOT EXISTS pdf_passwords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      password TEXT NOT NULL,
      source_match TEXT,
      created_at TEXT DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
    );

    CREATE TABLE IF NOT EXISTS email_sync_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email_account_id INTEGER NOT NULL,
      sync_type TEXT NOT NULL DEFAULT 'statement' CHECK(sync_type IN ('statement', 'amazon_pay')),
      trigger_type TEXT NOT NULL DEFAULT 'manual' CHECK(trigger_type IN ('manual', 'cron')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed')),
      total_attachments INTEGER DEFAULT 0,
      processed_attachments INTEGER DEFAULT 0,
      imported_transactions INTEGER DEFAULT 0,
      failed_attachments INTEGER DEFAULT 0,
      error_message TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
      FOREIGN KEY (email_account_id) REFERENCES email_accounts(id)
    );

    CREATE TABLE IF NOT EXISTS email_sync_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_job_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('success', 'password_failed', 'parse_failed', 'skipped')),
      transactions_imported INTEGER DEFAULT 0,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
      FOREIGN KEY (sync_job_id) REFERENCES email_sync_jobs(id)
    );
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS voucher_topups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voucher_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      description TEXT,
      source TEXT,
      created_at TEXT DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
      FOREIGN KEY (voucher_id) REFERENCES vouchers(id)
    );
  `);

  // Migrations for existing databases
  const emailCols = database.prepare("PRAGMA table_info(email_accounts)").all().map(c => c.name);
  if (emailCols.length > 0 && !emailCols.includes('auth_type')) {
    database.exec(`
      ALTER TABLE email_accounts ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'password';
      ALTER TABLE email_accounts ADD COLUMN access_token TEXT;
      ALTER TABLE email_accounts ADD COLUMN token_expiry TEXT;
    `);
  }
  if (emailCols.length > 0 && !emailCols.includes('amazon_pay_sync')) {
    database.exec(`ALTER TABLE email_accounts ADD COLUMN amazon_pay_sync INTEGER NOT NULL DEFAULT 0;`);
  }

  const syncJobCols = database.prepare("PRAGMA table_info(email_sync_jobs)").all().map(c => c.name);
  if (syncJobCols.length > 0 && !syncJobCols.includes('sync_type')) {
    database.exec(`ALTER TABLE email_sync_jobs ADD COLUMN sync_type TEXT NOT NULL DEFAULT 'statement';`);
  }
  if (syncJobCols.length > 0 && !syncJobCols.includes('trigger_type')) {
    database.exec(`ALTER TABLE email_sync_jobs ADD COLUMN trigger_type TEXT NOT NULL DEFAULT 'manual';`);
  }
  if (syncJobCols.length > 0 && !syncJobCols.includes('sync_period')) {
    database.exec(`ALTER TABLE email_sync_jobs ADD COLUMN sync_period TEXT;`);
  }

  const fileCols = database.prepare("PRAGMA table_info(uploaded_files)").all().map(c => c.name);
  if (fileCols.length > 0 && !fileCols.includes('source_type')) {
    database.exec(`
      ALTER TABLE uploaded_files ADD COLUMN source_type TEXT NOT NULL DEFAULT 'manual';
      ALTER TABLE uploaded_files ADD COLUMN detected_source TEXT;
      ALTER TABLE uploaded_files ADD COLUMN pending_transactions TEXT;
    `);
  }
  if (fileCols.length > 0 && !fileCols.includes('skipped_transactions')) {
    database.exec(`ALTER TABLE uploaded_files ADD COLUMN skipped_transactions TEXT;`);
  }

  const usageCols = database.prepare("PRAGMA table_info(voucher_usage)").all().map(c => c.name);
  if (usageCols.length > 0 && !usageCols.includes('email_metadata')) {
    database.exec(`ALTER TABLE voucher_usage ADD COLUMN email_metadata TEXT;`);
  }
  const topupCols = database.prepare("PRAGMA table_info(voucher_topups)").all().map(c => c.name);
  if (topupCols.length > 0 && !topupCols.includes('email_metadata')) {
    database.exec(`ALTER TABLE voucher_topups ADD COLUMN email_metadata TEXT;`);
  }

  const categoryCount = database.prepare('SELECT COUNT(*) as count FROM categories').get();
  if (categoryCount.count === 0) {
    const insert = database.prepare('INSERT INTO categories (name, color) VALUES (?, ?)');
    const defaults = [
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
    ];
    for (const [name, color] of defaults) {
      insert.run(name, color);
    }
  }

  // Add category_source to track manual vs rule-based categorization
  const txnCols = database.prepare("PRAGMA table_info(transactions)").all().map(c => c.name);
  if (!txnCols.includes('category_source')) {
    database.exec("ALTER TABLE transactions ADD COLUMN category_source TEXT DEFAULT 'rule'");
  }

  // Add category_source to voucher_usage
  const usageCols2 = database.prepare("PRAGMA table_info(voucher_usage)").all().map(c => c.name);
  if (!usageCols2.includes('category_source')) {
    database.exec("ALTER TABLE voucher_usage ADD COLUMN category_source TEXT DEFAULT 'rule'");
  }

  // Ensure "Payments" category exists for credit card bill payments
  const paymentsCategory = database.prepare("SELECT id FROM categories WHERE name = 'Payments'").get();
  if (!paymentsCategory) {
    database.prepare("INSERT INTO categories (name, color) VALUES ('Payments', '#475569')").run();
  }
  const paymentsCatId = database.prepare("SELECT id FROM categories WHERE name = 'Payments'").get().id;

  // Ensure auto-categorization rule for payments exists
  const paymentRule = database.prepare("SELECT id FROM rules WHERE category_id = ?").get(paymentsCatId);
  if (!paymentRule) {
    database.prepare("INSERT INTO rules (pattern, category_id) VALUES (?, ?)")
      .run('payment received, cc payment, payment received. thank you', paymentsCatId);
  }

    // Ensure Amazon Pay Balance voucher exists
  const amazonVoucher = database.prepare("SELECT id FROM vouchers WHERE name = 'Amazon Pay Balance'").get();
  if (!amazonVoucher) {
    database.prepare(`
      INSERT INTO vouchers (name, initial_amount, remaining_amount, purchase_date)
      VALUES ('Amazon Pay Balance', 0, 0, ?)
    `).run(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }));
  }

  // Fix: initial_amount should exclude email-sourced topups (refunds are not top-ups)
  // Correct formula: initial_amount = remaining_amount + total_usage - manual_topups
  // Simplified: initial_amount should equal (total_usage + remaining) - manual_topups_total
  // Actually: initial_amount = original_purchase + manual_topups
  // We compute: remaining + total_usage - manual_topups = original_purchase
  // So correct initial_amount = original_purchase + manual_topups = remaining + total_usage
  // Wait no: remaining = initial + manual_topups + email_topups - usage
  // correct_initial = initial + manual_topups (not email_topups)
  // So we just need: UPDATE initial_amount = initial_amount - email_topup_total WHERE current initial includes them
  // Idempotent approach: correct_initial = remaining + usage - email_topups - manual_topups + manual_topups = remaining + usage - email_topups
  // No, let's just directly compute: correct_initial = remaining_amount + total_usage - all_topups + manual_topups
  // Simplest idempotent: correct_initial = remaining + total_usage - email_topups
  database.prepare(`
    UPDATE vouchers SET initial_amount = (
      SELECT v.remaining_amount
        + COALESCE((SELECT SUM(amount) FROM voucher_usage WHERE voucher_id = v.id), 0)
        - COALESCE((SELECT SUM(amount) FROM voucher_topups WHERE voucher_id = v.id AND source != 'manual'), 0)
      FROM vouchers v WHERE v.id = vouchers.id
    )
  `).run();
}
