// Business rules -- port of backend/includes/functions.php
import { all, one, scalar, column, exec } from './db.js';
import { daysOverdue, addDaysYmd } from './dates.js';
import { toInt, toFloat, trim } from './php.js';

export const DEFAULT_DUE_DAYS = 90;
export { daysOverdue };

// ---------------------------------------------------------------- settings

export async function getSetting(key, fallback = null, client = null) {
  const v = await scalar('SELECT setting_value FROM app_settings WHERE setting_key = ?', [key], client);
  return v !== null ? v : fallback;
}

export async function setSetting(key, value, client = null) {
  await exec(
    `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
     ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`,
    [key, String(value)],
    client
  );
}

/** Grace period (days after billing) before an entry starts aging. */
export async function agingGraceDays() {
  return toInt(await getSetting('aging_grace_days', String(DEFAULT_DUE_DAYS)));
}

/** "Less Taxes Withheld" auto-fill percentage. */
export async function taxWithheldPercent() {
  return toFloat(await getSetting('tax_withheld_percent', '2'));
}

/**
 * Returns a function computing the implicit due date (billing date + grace
 * days). The grace setting is read once per request instead of once per row.
 */
export async function makeImplicitDue() {
  const grace = await agingGraceDays();
  return (billingDate) => (billingDate ? addDaysYmd(billingDate, grace) : null);
}

/** Explicit due date if set, otherwise the implicit one. */
export function dueOf(row, implicitDue) {
  return row.due_date ? row.due_date : implicitDue(row.billing_date);
}

// ---------------------------------------------------------------- aging

export function agingRangeFromRequest(src) {
  const clean = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const s = String(v).trim();
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
    return toInt(s);
  };
  let from = clean(src.days_from);
  let to = clean(src.days_to);
  if (from !== null && to !== null && from > to) [from, to] = [to, from];
  return [from, to];
}

export function agingInRange(days, from, to) {
  if (from === null && to === null) return true;
  if (days === null) return false;
  if (from !== null && days < from) return false;
  if (to !== null && days > to) return false;
  return true;
}

export function agingBucket(d) {
  if (d === null) return 'N/A';
  if (d < 0) return 'Not Yet Due';
  if (d <= 30) return '0-30 days';
  if (d <= 60) return '31-60 days';
  if (d <= 90) return '61-90 days';
  return 'Over 90 days';
}

// ---------------------------------------------------------------- SOA numbers

export function soaHasSupplementarySuffix(soa) {
  const last = String(soa).trim().slice(-1).toUpperCase();
  return last === 'A' || last === 'B';
}

/**
 * True if the SOA number is already USED somewhere else (a ledger entry or a
 * tracker row marked USED) and isn't exempt through the A/B suffix rule.
 */
export async function soaNumberConflicts(soa, excludeLedgerId = null, excludeTrackerId = null) {
  soa = trim(soa);
  if (soa === '' || soaHasSupplementarySuffix(soa)) return false;
  let sql =
    'SELECT (SELECT COUNT(*) FROM ledger_entries WHERE UPPER(soa_number) = UPPER(?)' +
    (excludeLedgerId ? ' AND id <> ?' : '') +
    ") + (SELECT COUNT(*) FROM soa_tracker WHERE UPPER(soa_number) = UPPER(?) AND status = 'USED'" +
    (excludeTrackerId ? ' AND id <> ?' : '') +
    ')';
  const params = [soa];
  if (excludeLedgerId) params.push(excludeLedgerId);
  params.push(soa);
  if (excludeTrackerId) params.push(excludeTrackerId);
  return toInt(await scalar(sql, params)) > 0;
}

/**
 * An SOA number typed into a ledger row is logged in the tracker and marked
 * USED; the row's previous number (if different) goes back to UNUSED.
 */
export async function recordSoaNumberUsed(soa, companyId, ledgerEntryId) {
  soa = trim(soa).toUpperCase();
  if (soa === '') return;
  await exec(
    "UPDATE soa_tracker SET ledger_entry_id = NULL, status = 'UNUSED' WHERE ledger_entry_id = ? AND UPPER(soa_number) <> ?",
    [ledgerEntryId, soa]
  );
  // Prefer claiming an UNUSED row for this number (the one the tracker shows as available).
  const trackerId = await scalar(
    "SELECT id FROM soa_tracker WHERE UPPER(soa_number) = ? ORDER BY (status = 'USED') ASC, id ASC LIMIT 1",
    [soa]
  );
  if (trackerId) {
    await exec('UPDATE soa_tracker SET company_id = ?, ledger_entry_id = ?, status = ? WHERE id = ?', [
      companyId, ledgerEntryId, 'USED', trackerId,
    ]);
  } else {
    await exec('INSERT INTO soa_tracker (soa_number, company_id, ledger_entry_id, status) VALUES (?, ?, ?, ?)', [
      soa, companyId, ledgerEntryId, 'USED',
    ]);
  }
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

export async function nextSoaNumber(prefix = 'SN-C') {
  const like = prefix.replace(/[\\%_]/g, '\\$&') + '%';
  const numbers = [
    ...(await column('SELECT soa_number FROM soa_tracker WHERE soa_number ILIKE ?', [like])),
    ...(await column('SELECT soa_number FROM ledger_entries WHERE soa_number ILIKE ?', [like])),
  ];
  const re = new RegExp('^' + escapeRegExp(prefix) + '(\\d+)');
  let max = 0;
  for (const num of numbers) {
    const m = num ? String(num).match(re) : null;
    if (m) max = Math.max(max, toInt(m[1]));
  }
  return prefix + String(max + 1).padStart(5, '0');
}

// ---------------------------------------------------------------- branch isolation

/** " AND c.branch = ?" for branch accounts, nothing for admins. */
export function branchWhere(auth, alias = 'c') {
  const b = auth.branch();
  return b === null ? ['', []] : [` AND LOWER(${alias}.branch) = LOWER(?)`, [b]];
}

/** Same, but starting with WHERE. */
export function branchWhereStandalone(auth, alias = 'c') {
  const b = auth.branch();
  return b === null ? ['', []] : [` WHERE LOWER(${alias}.branch) = LOWER(?)`, [b]];
}

export async function canAccessCompany(auth, companyId) {
  if (!companyId) return false;
  if (auth.isAdmin()) {
    return toInt(await scalar('SELECT COUNT(*) FROM companies WHERE id = ?', [companyId])) > 0;
  }
  return toInt(await scalar('SELECT COUNT(*) FROM companies WHERE id = ? AND LOWER(branch) = LOWER(?)', [companyId, auth.branch()])) > 0;
}

/** Keeps ledger_entries.company_name in sync with the company's current name. */
export async function syncLedgerCompanyNames() {
  await exec(
    `UPDATE ledger_entries l SET company_name = c.name
     FROM companies c
     WHERE c.id = l.company_id AND (l.company_name IS NULL OR l.company_name = '' OR l.company_name <> c.name)`
  );
}

export { all, one, scalar, column, exec };
