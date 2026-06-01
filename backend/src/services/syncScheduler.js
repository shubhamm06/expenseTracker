import cron from 'node-cron';
import { supabase } from '../models/supabase.js';
import { runSyncForAccount } from './emailSync.js';
import { runAmazonPaySync } from './amazonPaySync.js';

let scheduledTask = null;
let amazonPayTask = null;
const activeJobs = new Map();

export function startScheduler() {
  scheduledTask = cron.schedule('30 0 * * *', () => {
    console.log('[Scheduler] Email sync cron TRIGGERED at', new Date().toISOString());
    syncAllAccounts();
  });
  console.log('[Scheduler] Email sync cron started (daily at 6:00 AM IST / 00:30 UTC)');

  amazonPayTask = cron.schedule('30 0,6,12,18 * * *', () => {
    console.log('[Scheduler] Amazon Pay sync cron TRIGGERED at', new Date().toISOString());
    syncAllAmazonPay();
  });
  console.log('[Scheduler] Amazon Pay sync cron started (every 6 hours at IST 6am/12pm/6pm/12am)');
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
  const { data: cards } = await supabase.from('cards').select('id').limit(1);
  if (!cards || cards.length === 0) return;

  const { data: accounts } = await supabase
    .from('email_accounts')
    .select('*')
    .neq('status', 'disconnected');

  for (const account of accounts || []) {
    if (activeJobs.has(`statement-${account.id}`)) continue;
    triggerSync(account.id, { triggerType: 'cron' });
  }
}

export async function syncAllAmazonPay() {
  const { data: accounts } = await supabase
    .from('email_accounts')
    .select('*')
    .eq('amazon_pay_sync', true)
    .neq('status', 'disconnected');

  for (const account of accounts || []) {
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
  return activeJobs.has(`statement-${accountId}`);
}

export function isAmazonPaySyncRunning(accountId) {
  return activeJobs.has(`amazon-${accountId}`);
}
