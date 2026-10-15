// Business rules -- port of backend/includes/functions.php
import { all, one, scalar, column, exec } from './db.js';
import { daysOverdue, addDaysYmd } from './dates.js';
import { toInt, toFloat, trim } from './php.js';

export const DEFAULT_DUE_DAYS = 30; // grace days offered when the grace period is switched on in Settings
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
// Settings page: the grace period can be switched off. Off = aging counts from the billing date.
export async function agingGraceEnabled() {
  return (await getSetting('aging_grace_enabled', '0')) === '1';
}

/** The number of grace days saved in Settings (kept even while the grace period is switched off). */
export async function agingGraceSavedDays() {
  return Math.max(0, toInt(await getSetting('aging_grace_days', String(DEFAULT_DUE_DAYS))));
}

/** Grace days actually applied to aging: 0 when the grace period is off. */
export async function agingGraceDays() {
  return (await agingGraceEnabled()) ? agingGraceSavedDays() : 0;
}

/** Settings page: when ON (default), the covered period is worked out from the billing date automatically. */
export async function autoCoveredPeriodEnabled() {
  return (await getSetting('auto_covered_period', '1')) === '1';
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
 * Finds what is holding an SOA number: a ledger entry, or a tracker row marked
 * USED. Returns null when the number is free (or exempt through the A/B suffix
 * rule), otherwise { where, text } describing the holder.
 */
export async function soaNumberHolder(soa, excludeLedgerId = null, excludeTrackerId = null) {
  soa = trim(soa);
  if (soa === '' || soaHasSupplementarySuffix(soa)) return null;

  const lp = [soa];
  if (excludeLedgerId) lp.push(excludeLedgerId);
  const ledger = await one(
    `SELECT l.id, l.billing_date, COALESCE(c.name, l.company_name) AS company
       FROM ledger_entries l LEFT JOIN companies c ON c.id = l.company_id
      WHERE UPPER(l.soa_number) = UPPER(?)${excludeLedgerId ? ' AND l.id <> ?' : ''}
      ORDER BY l.id LIMIT 1`,
    lp
  );
  if (ledger) {
    return {
      where: 'ledger',
      text: `it is already on a ledger entry (#${ledger.id}${ledger.company ? `, ${ledger.company}` : ''})`,
    };
  }

  const tp = [soa];
  if (excludeTrackerId) tp.push(excludeTrackerId);
  const tracker = await one(
    `SELECT t.id, t.ledger_entry_id, c.name AS company
       FROM soa_tracker t LEFT JOIN companies c ON c.id = t.company_id
      WHERE UPPER(t.soa_number) = UPPER(?) AND t.status = 'USED'${excludeTrackerId ? ' AND t.id <> ?' : ''}
      ORDER BY t.id LIMIT 1`,
    tp
  );
  if (tracker) {
    return {
      where: 'tracker',
      text: tracker.ledger_entry_id
        ? `it is marked USED in the SOA Tracker (linked to ledger entry #${tracker.ledger_entry_id})`
        : `it is marked USED in the SOA Tracker${tracker.company ? ` for ${tracker.company}` : ''} but isn't attached to any ledger entry — open SOA Tracker and set it to Unused if that's a leftover`,
    };
  }
  return null;
}

/**
 * True if the SOA number is already USED somewhere else (a ledger entry or a
 * tracker row marked USED) and isn't exempt through the A/B suffix rule.
 */
export async function soaNumberConflicts(soa, excludeLedgerId = null, excludeTrackerId = null) {
  return (await soaNumberHolder(soa, excludeLedgerId, excludeTrackerId)) !== null;
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
  if (auth.branch() === null) { // admin or executive: every company
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