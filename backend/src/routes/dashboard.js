import { Router } from 'express';
import { getDb } from '../models/db.js';

const router = Router();

router.get('/summary', (req, res) => {
  const { month, year } = req.query;
  const db = getDb();

  const m = (month || String(new Date().getMonth() + 1)).padStart(2, '0');
  const y = year || String(new Date().getFullYear());

  const totalSpend = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM transactions
    WHERE type = 'debit'
      AND is_reimbursable = 0
      AND is_voucher_purchase = 0
      AND strftime('%m', date) = ?
      AND strftime('%Y', date) = ?
  `).get(m, y);

  const totalCredit = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM transactions
    WHERE type = 'credit'
      AND is_reimbursable = 0
      AND strftime('%m', date) = ?
      AND strftime('%Y', date) = ?
  `).get(m, y);

  const reimbursableTotal = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM transactions
    WHERE type = 'debit'
      AND is_reimbursable = 1
      AND strftime('%m', date) = ?
      AND strftime('%Y', date) = ?
  `).get(m, y);

  const voucherUsageTotal = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM voucher_usage
    WHERE strftime('%m', date) = ?
      AND strftime('%Y', date) = ?
  `).get(m, y);

  const voucherTopupsTotal = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM voucher_topups
    WHERE strftime('%m', date) = ?
      AND strftime('%Y', date) = ?
      AND source != 'manual'
  `).get(m, y);

  const categoryBreakdown = db.prepare(`
    SELECT c.name, c.color, COALESCE(SUM(t.amount), 0) as total
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE t.type = 'debit'
      AND t.is_reimbursable = 0
      AND t.is_voucher_purchase = 0
      AND strftime('%m', t.date) = ?
      AND strftime('%Y', t.date) = ?
    GROUP BY t.category_id
    ORDER BY total DESC
  `).all(m, y);

  const voucherCategoryBreakdown = db.prepare(`
    SELECT c.name, c.color, COALESCE(SUM(vu.amount), 0) as total
    FROM voucher_usage vu
    LEFT JOIN categories c ON vu.category_id = c.id
    WHERE strftime('%m', vu.date) = ?
      AND strftime('%Y', vu.date) = ?
    GROUP BY vu.category_id
  `).all(m, y);

  // Merge voucher usage into category breakdown
  const merged = [...categoryBreakdown];
  for (const vc of voucherCategoryBreakdown) {
    const existing = merged.find(c => c.name === vc.name);
    if (existing) {
      existing.total += vc.total;
    } else {
      merged.push(vc);
    }
  }

  const netVoucherSpend = voucherUsageTotal.total - voucherTopupsTotal.total;

  res.json({
    month: m,
    year: y,
    total_spend: totalSpend.total + netVoucherSpend,
    total_credit: totalCredit.total,
    direct_spend: totalSpend.total,
    voucher_spend: netVoucherSpend,
    reimbursable_total: reimbursableTotal.total,
    category_breakdown: merged,
  });
});

router.get('/monthly-comparison', (req, res) => {
  const db = getDb();
  const { months = 6 } = req.query;

  const results = [];
  const now = new Date();

  for (let i = 0; i < Number(months); i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const y = String(d.getFullYear());

    const directSpend = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM transactions
      WHERE type = 'debit'
        AND is_reimbursable = 0
        AND is_voucher_purchase = 0
        AND strftime('%m', date) = ?
        AND strftime('%Y', date) = ?
    `).get(m, y);

    const creditTotal = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM transactions
      WHERE type = 'credit'
        AND is_reimbursable = 0
        AND strftime('%m', date) = ?
        AND strftime('%Y', date) = ?
    `).get(m, y);

    const voucherSpend = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM voucher_usage
      WHERE strftime('%m', date) = ?
        AND strftime('%Y', date) = ?
    `).get(m, y);

    const voucherTopups = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM voucher_topups
      WHERE strftime('%m', date) = ?
        AND strftime('%Y', date) = ?
        AND source != 'manual'
    `).get(m, y);

    results.push({
      month: m,
      year: y,
      label: d.toLocaleString('default', { month: 'short', year: 'numeric' }),
      total: directSpend.total + (voucherSpend.total - voucherTopups.total),
      credit: creditTotal.total,
    });
  }

  res.json(results.reverse());
});

export default router;
