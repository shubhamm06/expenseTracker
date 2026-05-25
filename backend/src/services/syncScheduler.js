import cron from 'node-cron';
import { getDb } from '../models/db.js';
import { runSyncForAccount } from './emailSync.js';
import { runAmazonPaySync } from './amazonPaySync.js';

let scheduledTask = null;
let amazonPayTask = null;
const activeJobs = new Map();

export function startScheduler() {
  // Credit card statement sync — daily at 6 AM
  scheduledTask = cron.schedule('0 6 * * *', () => {
    syncAllAccounts();
  });
  console.log('[Scheduler] Email sync cron started (daily at 6 AM)');

  // Amazon Pay sync — every 6 hours
  amazonPayTask = cron.schedule('0 */6 * * *', () => {
    syncAllAmazonPay();
  });
  console.log('[Scheduler] Amazon Pay sync cron started (every 6 hours)');
}

export function stopScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
  if (amazonPayTask) {
    amazonPayTask.stop();
    amazonPayTask = null;
  }
}

export async function syncAllAccounts() {
  const db = getDb();
  const accounts = db.prepare(
    "SELECT * FROM email_accounts WHERE status != 'disconnected'"
  ).all();

  for (const account of accounts) {
    if (activeJobs.has(`statement-${account.id}`)) continue;
    triggerSync(account.id, { triggerType: 'cron' });
  }
}

export async function syncAllAmazonPay() {
  const db = getDb();
  const accounts = db.prepare(
    "SELECT * FROM email_accounts WHERE amazon_pay_sync = 1 AND status != 'disconnected'"
  ).all();

  for (const account of accounts) {
    if (activeJobs.has(`amazon-${account.id}`)) continue;
    triggerAmazonPaySync(account.id, { triggerType: 'cron' });
  }
}

export function triggerSync(accountId, { sinceDays, triggerType = 'manual', syncPeriod } = {}) {
  const key = `statement-${accountId}`;
  if (activeJobs.has(key)) {
    return { alreadyRunning: true };
  }

  activeJobs.set(key, true);

  processSync(accountId, { sinceDays, triggerType, syncPeriod }).finally(() => {
    activeJobs.delete(key);
  });

  return { started: true };
}

export function triggerAmazonPaySync(accountId, { sinceDays, triggerType = 'manual', syncPeriod } = {}) {
  const key = `amazon-${accountId}`;
  if (activeJobs.has(key)) {
    return { alreadyRunning: true };
  }

  activeJobs.set(key, true);

  runAmazonPaySync(accountId, { sinceDays, triggerType, syncPeriod }).then(result => {
    console.log(`[Scheduler] Amazon Pay sync for account ${accountId}: ${result.synced} new entries`);
  }).catch(err => {
    console.error(`[Scheduler] Amazon Pay sync failed for account ${accountId}:`, err.message);
  }).finally(() => {
    activeJobs.delete(key);
  });

  return { started: true };
}

async function processSync(accountId, options) {
  try {
    await runSyncForAccount(accountId, options);
  } catch (err) {
    console.error(`[Scheduler] Sync failed for account ${accountId}:`, err.message);
  }
}

export function isSyncRunning(accountId) {
  return activeJobs.has(`statement-${accountId}`) || activeJobs.has(`amazon-${accountId}`);
}

export function isAmazonPaySyncRunning(accountId) {
  return activeJobs.has(`amazon-${accountId}`);
}
