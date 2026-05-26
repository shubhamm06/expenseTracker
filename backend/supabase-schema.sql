-- Supabase PostgreSQL schema for Expense Tracker
-- Run this in the Supabase SQL Editor to set up the database

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Categories
CREATE TABLE IF NOT EXISTS categories (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#6b7280'
);

-- Vouchers
CREATE TABLE IF NOT EXISTS vouchers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  initial_amount DOUBLE PRECISION NOT NULL,
  remaining_amount DOUBLE PRECISION NOT NULL,
  purchase_date TEXT NOT NULL,
  source_transaction_id BIGINT
);

-- Transactions
CREATE TABLE IF NOT EXISTS transactions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('debit', 'credit')),
  category_id BIGINT REFERENCES categories(id),
  source TEXT,
  is_reimbursable BOOLEAN DEFAULT FALSE,
  is_voucher_purchase BOOLEAN DEFAULT FALSE,
  voucher_id BIGINT REFERENCES vouchers(id),
  notes TEXT,
  category_source TEXT DEFAULT 'rule',
  created_at TIMESTAMPTZ DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')
);

-- Add FK from vouchers to transactions (deferred due to circular reference)
ALTER TABLE vouchers ADD CONSTRAINT fk_vouchers_source_transaction
  FOREIGN KEY (source_transaction_id) REFERENCES transactions(id);

-- Rules
CREATE TABLE IF NOT EXISTS rules (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pattern TEXT NOT NULL,
  category_id BIGINT NOT NULL REFERENCES categories(id)
);

-- Voucher usage
CREATE TABLE IF NOT EXISTS voucher_usage (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  voucher_id BIGINT NOT NULL REFERENCES vouchers(id),
  amount DOUBLE PRECISION NOT NULL,
  date TEXT NOT NULL,
  description TEXT,
  category_id BIGINT REFERENCES categories(id),
  category_source TEXT DEFAULT 'rule',
  email_metadata TEXT
);

-- Voucher topups
CREATE TABLE IF NOT EXISTS voucher_topups (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  voucher_id BIGINT NOT NULL REFERENCES vouchers(id),
  amount DOUBLE PRECISION NOT NULL,
  date TEXT NOT NULL,
  description TEXT,
  source TEXT,
  email_metadata TEXT,
  created_at TIMESTAMPTZ DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')
);

-- Uploaded files (file data stored in Supabase Storage, not in this table)
CREATE TABLE IF NOT EXISTS uploaded_files (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size BIGINT NOT NULL,
  storage_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'imported', 'failed')),
  status_message TEXT,
  transactions_imported INTEGER DEFAULT 0,
  source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual', 'email')),
  detected_source TEXT,
  pending_transactions TEXT,
  skipped_transactions TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')
);

-- Email accounts
CREATE TABLE IF NOT EXISTS email_accounts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  imap_host TEXT NOT NULL,
  imap_port INTEGER NOT NULL DEFAULT 993,
  password TEXT NOT NULL DEFAULT '',
  auth_type TEXT NOT NULL DEFAULT 'password' CHECK (auth_type IN ('password', 'oauth')),
  access_token TEXT,
  token_expiry TEXT,
  display_name TEXT,
  amazon_pay_sync BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'disconnected', 'error')),
  last_sync_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')
);

-- PDF passwords
CREATE TABLE IF NOT EXISTS pdf_passwords (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  label TEXT NOT NULL,
  password TEXT NOT NULL,
  source_match TEXT,
  created_at TIMESTAMPTZ DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')
);

-- Email sync jobs
CREATE TABLE IF NOT EXISTS email_sync_jobs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email_account_id BIGINT NOT NULL REFERENCES email_accounts(id),
  sync_type TEXT NOT NULL DEFAULT 'statement' CHECK (sync_type IN ('statement', 'amazon_pay')),
  trigger_type TEXT NOT NULL DEFAULT 'manual' CHECK (trigger_type IN ('manual', 'cron', 'auto')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  total_attachments INTEGER DEFAULT 0,
  processed_attachments INTEGER DEFAULT 0,
  imported_transactions INTEGER DEFAULT 0,
  failed_attachments INTEGER DEFAULT 0,
  error_message TEXT,
  sync_period TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')
);

-- Email sync results
CREATE TABLE IF NOT EXISTS email_sync_results (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sync_job_id BIGINT NOT NULL REFERENCES email_sync_jobs(id),
  filename TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'password_failed', 'parse_failed', 'skipped')),
  transactions_imported INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_source ON transactions(source);
CREATE INDEX IF NOT EXISTS idx_voucher_usage_voucher ON voucher_usage(voucher_id);
CREATE INDEX IF NOT EXISTS idx_voucher_topups_voucher ON voucher_topups(voucher_id);
CREATE INDEX IF NOT EXISTS idx_email_sync_jobs_account ON email_sync_jobs(email_account_id);
CREATE INDEX IF NOT EXISTS idx_email_sync_results_job ON email_sync_results(sync_job_id);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_status ON uploaded_files(status);

-- Seed default categories
INSERT INTO categories (name, color) VALUES
  ('Groceries', '#22c55e'),
  ('Dining', '#f97316'),
  ('Shopping', '#8b5cf6'),
  ('Subscriptions', '#06b6d4'),
  ('Fuel', '#eab308'),
  ('Utilities', '#64748b'),
  ('Transport', '#ec4899'),
  ('Health', '#ef4444'),
  ('Entertainment', '#a855f7'),
  ('Other', '#6b7280'),
  ('Payments', '#475569')
ON CONFLICT (name) DO NOTHING;

-- Seed payment rule
INSERT INTO rules (pattern, category_id)
SELECT 'payment received, cc payment, payment received. thank you', id
FROM categories WHERE name = 'Payments'
ON CONFLICT DO NOTHING;

-- Seed Amazon Pay Balance voucher
INSERT INTO vouchers (name, initial_amount, remaining_amount, purchase_date)
SELECT 'Amazon Pay Balance', 0, 0, to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')
WHERE NOT EXISTS (SELECT 1 FROM vouchers WHERE name = 'Amazon Pay Balance');

-- Create Storage bucket for uploaded files
-- (Run this via Supabase Dashboard > Storage > New Bucket named 'uploads', or via API)

-- RLS Policies (permissive for now - will tighten when auth is added)
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE voucher_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE voucher_topups ENABLE ROW LEVEL SECURITY;
ALTER TABLE uploaded_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdf_passwords ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_sync_results ENABLE ROW LEVEL SECURITY;

-- Allow all operations via service_role key (backend uses service_role)
-- These policies allow the service_role full access
CREATE POLICY "service_role_all" ON categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON transactions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON rules FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON vouchers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON voucher_usage FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON voucher_topups FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON uploaded_files FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON email_accounts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON pdf_passwords FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON email_sync_jobs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON email_sync_results FOR ALL USING (true) WITH CHECK (true);

-- Database functions for complex queries

-- Dashboard summary
CREATE OR REPLACE FUNCTION get_dashboard_summary(p_month TEXT, p_year TEXT)
RETURNS JSON AS $$
DECLARE
  v_total_spend DOUBLE PRECISION;
  v_total_credit DOUBLE PRECISION;
  v_reimbursable DOUBLE PRECISION;
  v_voucher_usage DOUBLE PRECISION;
  v_voucher_topups DOUBLE PRECISION;
  v_category_breakdown JSON;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO v_total_spend
  FROM transactions
  WHERE type = 'debit'
    AND is_reimbursable = FALSE
    AND is_voucher_purchase = FALSE
    AND to_char(date::date, 'MM') = p_month
    AND to_char(date::date, 'YYYY') = p_year;

  SELECT COALESCE(SUM(amount), 0) INTO v_total_credit
  FROM transactions
  WHERE type = 'credit'
    AND is_reimbursable = FALSE
    AND to_char(date::date, 'MM') = p_month
    AND to_char(date::date, 'YYYY') = p_year;

  SELECT COALESCE(SUM(amount), 0) INTO v_reimbursable
  FROM transactions
  WHERE type = 'debit'
    AND is_reimbursable = TRUE
    AND to_char(date::date, 'MM') = p_month
    AND to_char(date::date, 'YYYY') = p_year;

  SELECT COALESCE(SUM(amount), 0) INTO v_voucher_usage
  FROM voucher_usage
  WHERE to_char(date::date, 'MM') = p_month
    AND to_char(date::date, 'YYYY') = p_year;

  SELECT COALESCE(SUM(amount), 0) INTO v_voucher_topups
  FROM voucher_topups
  WHERE to_char(date::date, 'MM') = p_month
    AND to_char(date::date, 'YYYY') = p_year
    AND source != 'manual';

  SELECT COALESCE(json_agg(row_to_json(sub)), '[]'::json) INTO v_category_breakdown
  FROM (
    SELECT name, color, SUM(total) as total FROM (
      SELECT c.name, c.color, COALESCE(SUM(t.amount), 0) as total
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE t.type = 'debit'
        AND t.is_reimbursable = FALSE
        AND t.is_voucher_purchase = FALSE
        AND to_char(t.date::date, 'MM') = p_month
        AND to_char(t.date::date, 'YYYY') = p_year
      GROUP BY c.name, c.color
      UNION ALL
      SELECT c.name, c.color, COALESCE(SUM(vu.amount), 0) as total
      FROM voucher_usage vu
      LEFT JOIN categories c ON vu.category_id = c.id
      WHERE to_char(vu.date::date, 'MM') = p_month
        AND to_char(vu.date::date, 'YYYY') = p_year
      GROUP BY c.name, c.color
    ) combined
    GROUP BY name, color
    ORDER BY total DESC
  ) sub;

  RETURN json_build_object(
    'month', p_month,
    'year', p_year,
    'total_spend', v_total_spend + (v_voucher_usage - v_voucher_topups),
    'total_credit', v_total_credit,
    'direct_spend', v_total_spend,
    'voucher_spend', v_voucher_usage - v_voucher_topups,
    'reimbursable_total', v_reimbursable,
    'category_breakdown', v_category_breakdown
  );
END;
$$ LANGUAGE plpgsql;

-- Monthly comparison
CREATE OR REPLACE FUNCTION get_monthly_comparison(p_months INTEGER DEFAULT 6)
RETURNS JSON AS $$
DECLARE
  v_results JSON;
BEGIN
  SELECT COALESCE(json_agg(row_to_json(sub) ORDER BY sub.sort_key), '[]'::json) INTO v_results
  FROM (
    SELECT
      to_char(d, 'MM') as month,
      to_char(d, 'YYYY') as year,
      to_char(d, 'Mon YYYY') as label,
      (
        SELECT COALESCE(SUM(amount), 0)
        FROM transactions
        WHERE type = 'debit'
          AND is_reimbursable = FALSE
          AND is_voucher_purchase = FALSE
          AND to_char(date::date, 'MM') = to_char(d, 'MM')
          AND to_char(date::date, 'YYYY') = to_char(d, 'YYYY')
      ) + (
        SELECT COALESCE(SUM(amount), 0)
        FROM voucher_usage
        WHERE to_char(date::date, 'MM') = to_char(d, 'MM')
          AND to_char(date::date, 'YYYY') = to_char(d, 'YYYY')
      ) - (
        SELECT COALESCE(SUM(amount), 0)
        FROM voucher_topups
        WHERE to_char(date::date, 'MM') = to_char(d, 'MM')
          AND to_char(date::date, 'YYYY') = to_char(d, 'YYYY')
          AND source != 'manual'
      ) as total,
      (
        SELECT COALESCE(SUM(amount), 0)
        FROM transactions
        WHERE type = 'credit'
          AND is_reimbursable = FALSE
          AND to_char(date::date, 'MM') = to_char(d, 'MM')
          AND to_char(date::date, 'YYYY') = to_char(d, 'YYYY')
      ) as credit,
      d as sort_key
    FROM generate_series(
      date_trunc('month', now()) - ((p_months - 1) || ' months')::interval,
      date_trunc('month', now()),
      '1 month'::interval
    ) d
  ) sub;

  RETURN v_results;
END;
$$ LANGUAGE plpgsql;
