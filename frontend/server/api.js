// JSON API -- port of backend/api.php.
// Same actions, same request fields, same response shapes, so the React
// pages work unchanged. All requests hit /api.php?action=xxx (the
// vercel.json rewrite sends that path to this code).

import bcrypt from 'bcryptjs';
import { all, one, scalar, exec, insertId, transaction } from './db.js';
import { HttpError, jsonExit, getQuery, getJsonBody, sendJson } from './http.js';
import { readSession, sessionCookie, renewCookie, clearCookie, attemptLogin, makeAuth } from './auth.js';
import { toInt, toFloat, trim, truthy, elvis, round } from './php.js';
import { monthKey, addMonthsKey, currentMonthKey } from './dates.js';
import { DEFAULT_TERMS_MONTHS } from './monthly.js';
import { todayYmd, todayMs, parseDate, normalizePeriod, coveredPeriodForBilling, normalizeCoveredRules, DEFAULT_COVERED_RULES } from './dates.js';
import { buildMonthlyReport } from './monthly.js';
import { parseSoa, matchHmo } from './soa.js';
import {
  daysOverdue, agingBucket, agingRangeFromRequest, agingInRange, makeImplicitDue, dueOf,
  agingGraceDays, agingGraceEnabled, autoCoveredPeriodEnabled, coveredPeriodRules, agingGraceSavedDays, taxWithheldPercent, getSetting, setSetting, soaNumberConflicts, soaNumberHolder, recordSoaNumberUsed, releaseSoaForEntry,
  nextSoaNumber, branchWhere, branchWhereStandalone, canAccessCompany, syncLedgerCompanyNames,
} from './lib.js';

const PAYMENT_METHODS = ['Cash', 'Card', 'Check'];
const PAYMENT_BANKS = ['Metrobank', 'BPI', 'PBB', 'Maya', 'Other'];
const STATUSES = ['ACTIVE', 'INACTIVE', 'BANKRUPT'];

const isSet = (v) => v !== undefined && v !== null;
const sum = (rows, key) => rows.reduce((t, r) => t + toFloat(r[key]), 0);

// Sidebar pages a role may be given (Settings > Users > Sidebar access). Admin always sees everything.
// A role can only be switched on/off inside its own list; pages outside it stay closed for that role.
const NAV_PAGES = ['/', '/summary', '/reports-by-month', '/companies', '/hmos', '/company-charges', '/billing', '/ledger', '/aging', '/past-due', '/soa-tracker', '/monitoring',
  '/payables/cash-position', '/payables/main', '/payables/running', '/payables/record', '/payables/titles'];
// Payables pages start switched OFF for every role except Admin until Admin / Executive ticks them.
const NAV_DEFAULT_OFF = NAV_PAGES.filter((p) => p.startsWith('/payables'));
const NAV_BASE = {
  accounting: NAV_PAGES,
  branch: NAV_PAGES,
  staff: ['/', '/reports-by-month', '/companies', '/hmos', '/company-charges', '/billing', '/ledger', ...NAV_DEFAULT_OFF],
  executive: ['/', '/summary', '/past-due', '/aging', '/reports-by-month', '/ledger', ...NAV_DEFAULT_OFF],
};

async function getNavAccess() {
  let saved = {};
  try { saved = JSON.parse(await getSetting('nav_access', '{}')) || {}; } catch { saved = {}; }
  const out = {};
  for (const role of Object.keys(NAV_BASE)) {
    const base = NAV_BASE[role];
    out[role] = Array.isArray(saved[role]) ? base.filter((p) => p === '/' || saved[role].includes(p)) : base.filter((p) => !NAV_DEFAULT_OFF.includes(p));
  }
  return out;
}

async function userPayload(u) {
  if (!u) return null;
  const access = u.role === 'admin' ? null : (await getNavAccess())[u.role] || null;
  return {
    id: u.id, username: u.username, full_name: u.full_name, role: u.role,
    nav_access: access,
    // Accounting works like an admin inside Receivables (not Users, Branches, Settings or Payables)
    is_admin: u.role === 'admin' || u.role === 'accounting',
    is_accounting: u.role === 'accounting',
    is_executive: u.role === 'executive',
    is_staff: u.role === 'staff',
  };
}

// What a staff account may call: view companies + ledger + dashboard + monthly report,
// and edit only the three payment fields of a ledger row.
const STAFF_ACTIONS = new Set([
  'get_dashboard', 'get_company_dashboard', 'get_companies', 'get_ledger', 'inline_update_ledger', 'get_monthly_report',
  'get_payments', 'add_payment', 'update_payment', 'delete_payment',
  'get_billing', 'save_billing', 'parse_soa', 'post_billing', 'get_settings', // Billing: open, import SOA, post (no void)
  'get_hmos', 'get_hmo', // Companies / HMOs pages are view-only for staff
  'get_payables', 'save_payable', 'get_main_fund', 'save_main_fund', 'get_cash_position', 'save_cash_position', 'save_account_titles', 'add_payables_bulk', 'set_payable_status', 'set_payable_release', 'clear_released_payable', 'delete_payable', // Payables: each action still checks Sidebar access
]);
const STAFF_EDITABLE_FIELDS = ['payment_date', 'check_ref', 'paid_amount'];

// What an executive (owner / accounting) account may call: reports, the ledger (edit + delete, like Admin).
const EXECUTIVE_ACTIONS = new Set([
  'get_exec_dashboard', 'get_summary', 'get_companies', 'get_aging', 'get_past_due', 'get_settings',
  'get_monthly_report', 'get_ledger', 'inline_update_ledger', 'quick_add_ledger', 'delete_ledger',
  'get_payments', 'add_payment', 'update_payment', 'delete_payment',
  'get_users', 'create_user', 'update_user', 'delete_user',
  'get_branch_sites', 'save_branch_sites', 'get_nav_access', 'save_nav_access',
  'get_payables', 'save_payable', 'get_main_fund', 'save_main_fund', 'get_cash_position', 'save_cash_position', 'save_account_titles', 'add_payables_bulk', 'set_payable_status', 'set_payable_release', 'clear_released_payable', 'delete_payable',
]);

function recalcRow(d) {
  const amount = toFloat(d.amount);
  const tax = toFloat(d.tax_withheld);
  const surcharge = toFloat(d.surcharge);
  const rebate = toFloat(d.rebate);
  const paid = toFloat(d.paid_amount);
  // Receivable = Amount - Tax W/H + Surcharge - Rebate (only a rebate that was actually entered).
  const receivable = round(amount - tax + surcharge - rebate, 2);
  // Balance = Receivable - Paid. An unpaid difference stays outstanding until it is paid; an overpayment
  // is shown as 0 outstanding, never as a negative amount in the totals.
  const balance = Math.max(0, round(receivable - paid, 2));
  return [receivable, balance];
}


// ---------------------------------------------------------------- several payments on one ledger row
// Table `ledger_payments` (database/add_ledger_payments.sql). Until that SQL is run everything keeps working
// the old way: one Paid / Payment Date / Check Ref per row.
const PAY_FIELDS = ['payment_date', 'check_ref', 'check_date', 'payment_method', 'payment_method_bank', 'payment_method_other'];

async function paymentsEnabled() {
  return !!(await scalar("SELECT to_regclass('public.ledger_payments')"));
}

async function autoTaxFor(row) {
  const acctType = await scalar('SELECT account_type FROM companies WHERE id = ?', [toInt(row.company_id)]);
  return acctType === 'CHARGE' ? 0 : round(toFloat(row.amount) * (await taxWithheldPercent()) / 100, 2);
}

/** Paid / Payment Date / Check Ref / Balance of a row = the total and the latest of its payments. */
async function syncRowFromPayments(id) {
  const row = await one('SELECT * FROM ledger_entries WHERE id = ?', [id]);
  if (!row) return null;
  const pays = await all(
    "SELECT * FROM ledger_payments WHERE ledger_entry_id = ? ORDER BY COALESCE(payment_date, '') ASC, id ASC", [id]);
  const total = round(pays.reduce((t, p) => t + toFloat(p.amount), 0), 2);
  const last = pays.length ? pays[pays.length - 1] : null;
  row.paid_amount = total;
  row.tax_withheld = await autoTaxFor(row);
  const [receivable, balance] = recalcRow(row);
  await exec(
    `UPDATE ledger_entries SET paid_amount = ?, payment_date = ?, check_ref = ?, check_date = ?, payment_method = ?,
            payment_method_bank = ?, payment_method_other = ?, tax_withheld = ?, receivable_amount = ?, balance = ?,
            updated_at = (now() AT TIME ZONE 'Asia/Manila') WHERE id = ?`,
    [total, last?.payment_date ?? null, last?.check_ref ?? null, last?.check_date ?? null, last?.payment_method ?? null,
      last?.payment_method_bank ?? null, last?.payment_method_other ?? null, row.tax_withheld, receivable, balance, id]);
  return { paid_amount: total, receivable_amount: receivable, balance, payment_date: last?.payment_date ?? null, payment_count: pays.length };
}

/** After Paid / Payment Date / Check Ref is typed straight into the row: keep a single payment in step with it. */
async function mirrorRowToPayments(id) {
  const row = await one('SELECT * FROM ledger_entries WHERE id = ?', [id]);
  if (!row) return;
  const pays = await all('SELECT id FROM ledger_payments WHERE ledger_entry_id = ?', [id]);
  const paid = toFloat(row.paid_amount);
  if (pays.length === 0 && paid > 0.009) {
    await exec(
      `INSERT INTO ledger_payments (ledger_entry_id, payment_date, amount, check_ref, check_date, payment_method, payment_method_bank, payment_method_other)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, row.payment_date, paid, row.check_ref, row.check_date, row.payment_method, row.payment_method_bank, row.payment_method_other]);
  } else if (pays.length === 1) {
    if (paid <= 0.009 && !row.payment_date && !row.check_ref) {
      await exec('DELETE FROM ledger_payments WHERE id = ?', [pays[0].id]);
    } else {
      await exec(
        `UPDATE ledger_payments SET amount = ?, payment_date = ?, check_ref = ?, check_date = ?, payment_method = ?,
                payment_method_bank = ?, payment_method_other = ? WHERE id = ?`,
        [paid, row.payment_date, row.check_ref, row.check_date, row.payment_method, row.payment_method_bank, row.payment_method_other, pays[0].id]);
    }
  }
}

/** Map of ledger row id -> its payments (empty map while the table does not exist yet). */
async function paymentsByEntry(entryIds = null) {
  const map = new Map();
  if (!(await paymentsEnabled())) return map;
  const rows = await all('SELECT ledger_entry_id, payment_date, amount FROM ledger_payments');
  const keep = entryIds ? new Set(entryIds.map(String)) : null;
  for (const p of rows) {
    const k = String(p.ledger_entry_id);
    if (keep && !keep.has(k)) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push({ payment_date: p.payment_date, amount: toFloat(p.amount) });
  }
  return map;
}

function cleanPayment(input) {
  const out = {};
  const amount = toFloat(input.amount);
  if (!(amount > 0)) jsonExit({ ok: false, error: 'Enter the payment amount (more than 0).' }, 400);
  out.amount = round(amount, 2);
  const txt = (v) => { v = trim(v ?? ''); return v === '' ? null : v; };
  out.payment_date = txt(input.payment_date);
  out.check_ref = txt(input.check_ref);
  out.check_date = txt(input.check_date);
  const pm = trim(input.payment_method ?? '');
  out.payment_method = PAYMENT_METHODS.includes(pm) ? pm : null;
  const bank = trim(input.payment_method_bank ?? '');
  out.payment_method_bank = PAYMENT_BANKS.includes(bank) ? bank : null;
  out.payment_method_other = txt(input.payment_method_other);
  out.remarks = txt(input.remarks);
  return out;
}

async function paymentsReply(entryId) {
  const e = await one('SELECT id, soa_number, amount, receivable_amount, paid_amount, balance, payment_date FROM ledger_entries WHERE id = ?', [entryId]);
  const payments = await all('SELECT * FROM ledger_payments WHERE ledger_entry_id = ? ORDER BY COALESCE(payment_date, \'\') ASC, id ASC', [entryId]);
  return { enabled: true, entry: e, payments, payment_count: payments.length };
}

async function requireCompanyAccess(auth, companyId) {
  if (!(await canAccessCompany(auth, companyId))) {
    jsonExit({ ok: false, error: 'You do not have access to that company.' }, 403);
  }
}

// ======================================================================
// Actions that need a login. Each gets (input, auth, query) and returns the
// JSON body (or calls jsonExit for errors).
// ======================================================================
// ---------------------------------------------------------------- RUNNING PAYABLES (admin)
// Table creates itself the first time it is used (same SQL is in database/running_payables.sql).
const DEFAULT_ACCOUNT_TITLES = ['Salary', "Doctor's PF", 'Supplier', 'Cash / PCF', 'Capex / Machine', 'Incorporator', 'Government / License', 'Other'];
let payablesReady = false;
async function ensurePayablesTable() {
  if (payablesReady) return;
  await exec(`CREATE TABLE IF NOT EXISTS running_payables (
    id SERIAL PRIMARY KEY,
    check_date DATE NULL,
    payee TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Other',
    amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Unpaid',
    note TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  // the name picked under the account title (e.g. which supplier); added later, so older tables get it here
  await exec('ALTER TABLE running_payables ADD COLUMN IF NOT EXISTS title_name TEXT NULL');
  // check release tracking (separate from Paid / Unpaid): Pending Release | Released; cleared_at hides it from Main once the bank clears it
  await exec("ALTER TABLE running_payables ADD COLUMN IF NOT EXISTS release_status TEXT NOT NULL DEFAULT 'Pending Release'");
  await exec('ALTER TABLE running_payables ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMPTZ NULL');
  payablesReady = true;
}
// Account titles (the category list) are editable by the admin and stored as JSON in app_settings.
async function getAccountTitles() {
  try {
    const list = JSON.parse(await getSetting('payable_account_titles', 'null'));
    if (Array.isArray(list) && list.length) return list.map((t) => String(t));
  } catch { /* fall through to defaults */ }
  return DEFAULT_ACCOUNT_TITLES;
}
// Names saved under an account title (e.g. the suppliers under "Supplier"): { "Supplier": ["ABC Pharma", ...] }
async function getTitleNames() {
  try {
    const o = JSON.parse(await getSetting('payable_title_names', '{}'));
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      const out = {};
      for (const [k, v] of Object.entries(o)) if (Array.isArray(v)) out[k] = v.map((x) => String(x));
      return out;
    }
  } catch { /* none saved yet */ }
  return {};
}
const cleanTitle = (v) => trim(v ?? '').replace(/\s+/g, ' ').slice(0, 60);
// Admin always; any other role only when Sidebar access gives it at least one of these Payables pages.
async function requirePayablesAdmin(auth, ...pages) {
  if (auth.isAdmin()) return;
  const allowed = (await getNavAccess())[auth.user?.role] || [];
  if (!pages.some((pg) => allowed.includes(pg))) jsonExit({ ok: false, error: 'You do not have access to this Payables page.' }, 403);
}

// ---------------------------------------------------------------- MAIN (cash fund) -- hand-typed figures live in app_settings
const PULL_LABELS = ['Funding for upcoming payables', 'Owners / profit pull out', ''];
const money2 = (v) => Math.round(toFloat(v) * 100) / 100;
function cleanMainFund(src) {
  const o = src && typeof src === 'object' ? src : {};
  const checks = (Array.isArray(o.checks) ? o.checks : []).slice(0, 300).map((c, i) => ({
    id: trim(c?.id ?? '').slice(0, 40) || `c${Date.now().toString(36)}${i}`,
    name: trim(c?.name ?? '').replace(/\s+/g, ' ').slice(0, 160),
    amount: money2(c?.amount),
  })).filter((c) => c.name || c.amount);
  const pullIn = Array.isArray(o.pull) ? o.pull : [];
  const pull = PULL_LABELS.map((def, i) => ({
    label: trim(pullIn[i]?.label ?? def).slice(0, 80) || def,
    amount: money2(pullIn[i]?.amount),
  }));
  return {
    passbook: money2(o.passbook), deposit: money2(o.deposit), aub: money2(o.aub),
    aub_label: trim(o.aub_label ?? '').replace(/\s+/g, ' ').slice(0, 60),
    pull, checks,
    receivables_label: trim(o.receivables_label ?? '').slice(0, 80),
    receivables_date: /^\d{4}-\d{2}-\d{2}$/.test(String(o.receivables_date ?? '')) ? o.receivables_date : '',
    receivables: money2(o.receivables),
    updated_at: trim(o.updated_at ?? '').slice(0, 40) || null,
  };
}
async function getMainFund() {
  try { return cleanMainFund(JSON.parse(await getSetting('main_fund', '{}'))); } catch { return cleanMainFund({}); }
}

// ---------------------------------------------------------------- CASH POSITION -- future payables are hand-typed and live in app_settings
function cleanFuture(list) {
  return (Array.isArray(list) ? list : []).slice(0, 100).map((x, i) => ({
    id: trim(x?.id ?? '').slice(0, 40) || `f${Date.now().toString(36)}${i}`,
    label: trim(x?.label ?? '').replace(/\s+/g, ' ').slice(0, 120),
    amount: money2(x?.amount), // may be negative (a deduction)
  })).filter((x) => x.label || x.amount);
}
async function getCashPositionSettings() {
  try { const o = JSON.parse(await getSetting('cash_position', '{}')); return { future: cleanFuture(o?.future) }; } catch { return { future: [] }; }
}

const actions = {

  // ---------------------------------------------------------------- DASHBOARD
  async get_dashboard(input, auth) {
    const [bw, bp] = branchWhere(auth, 'c');
    const [bws, bps] = branchWhereStandalone(auth, 'c');
    const due = await makeImplicitDue();

    const totalBilled = toFloat(await scalar(`SELECT COALESCE(SUM(l.amount),0) FROM ledger_entries l JOIN companies c ON c.id = l.company_id WHERE 1=1 ${bw}`, bp));
    const totalPaid = toFloat(await scalar(`SELECT COALESCE(SUM(l.paid_amount),0) FROM ledger_entries l JOIN companies c ON c.id = l.company_id WHERE 1=1 ${bw}`, bp));
    const totalBalance = toFloat(await scalar(`SELECT COALESCE(SUM(l.balance),0) FROM ledger_entries l JOIN companies c ON c.id = l.company_id WHERE 1=1 ${bw}`, bp));
    const totalCompanies = toInt(await scalar(`SELECT COUNT(*) FROM companies c${bws}`, bps));
    const activeCompanies = toInt(await scalar(`SELECT COUNT(*) FROM companies c WHERE c.status='ACTIVE'${bw}`, bp));

    let pastDueTotal = 0;
    let pastDueCount = 0;
    const open = await all(`SELECT l.billing_date, l.due_date, l.balance FROM ledger_entries l JOIN companies c ON c.id = l.company_id WHERE l.balance > 0 ${bw}`, bp);
    for (const r of open) {
      const d = daysOverdue(dueOf(r, due));
      if (d !== null && d > 0) {
        pastDueTotal += toFloat(r.balance);
        pastDueCount++;
      }
    }

    const topOutstanding = await all(
      `SELECT c.id, c.name, c.status, COALESCE(SUM(l.balance),0) as outstanding
       FROM companies c LEFT JOIN ledger_entries l ON l.company_id = c.id
       WHERE 1=1 ${bw}
       GROUP BY c.id ORDER BY outstanding DESC, c.id DESC LIMIT 10`, bp);

    const recent = await all(
      `SELECT l.*, c.name as company_name FROM ledger_entries l
       JOIN companies c ON c.id = l.company_id
       WHERE 1=1 ${bw}
       ORDER BY l.created_at DESC, l.id DESC LIMIT 10`, bp);

    return { ok: true, data: {
      total_billed: totalBilled,
      total_paid: totalPaid,
      total_balance: totalBalance,
      total_companies: totalCompanies,
      active_companies: activeCompanies,
      collection_rate: totalBilled > 0 ? round((totalPaid / totalBilled) * 100, 1) : 0,
      past_due_total: pastDueTotal,
      past_due_count: pastDueCount,
      top_outstanding: topOutstanding,
      recent,
    } };
  },

  // ---------------------------------------------------------------- COMPANY DASHBOARD
  // The evolving dashboard: one company (or all of them), viewed per month or per year.
  //   billed      = amounts billed, placed by billing date
  //   collected   = payments received, placed by payment date
  //   outstanding = unpaid balance of the entries billed in that period
  //   past_due    = the part of that balance that is already past its due date
  async get_company_dashboard(input, auth) {
    const companyId = isSet(input.company_id) && input.company_id !== '' ? toInt(input.company_id) : null;
    if (companyId) await requireCompanyAccess(auth, companyId);

    const todayKey = todayYmd();
    const nowYear = toInt(todayKey.slice(0, 4));
    const nowMonth = toInt(todayKey.slice(5, 7));
    const view = input.view === 'year' ? 'year' : input.view === 'all' ? 'all' : 'month';
    const type = ['HMO', 'COMPANY', 'CHARGE'].includes(input.type) ? input.type : null; // null = everything (CHARGE = Company Charges accounts)
    let year = toInt(input.year);
    if (year < 2000 || year > 2100) year = nowYear;
    const allMonths = String(input.month) === 'all'; // "All months" chip: the whole year in the monthly view
    let month = toInt(input.month);
    if (allMonths) month = 0;
    else if (month < 1 || month > 12) month = year === nowYear ? nowMonth : 12;

    // Yearly / All time views can be narrowed to one month (1-12): that month of the chosen year, or that month in every year.
    const fm = toInt(input.fm) >= 1 && toInt(input.fm) <= 12 ? toInt(input.fm) : 0;
    const [bw, bp] = branchWhere(auth, 'c');
    let sql = `SELECT l.id, l.company_id, l.billing_date, l.period_date, l.period_from, l.period_to, l.due_date, l.payment_date, l.soa_number,
                      l.amount, l.paid_amount, l.balance, c.name AS company_name, c.status AS company_status, c.account_type
               FROM ledger_entries l JOIN companies c ON c.id = l.company_id
               WHERE 1=1 ${bw}`;
    let params = bp;
    if (type) { sql += ' AND c.account_type = ?'; params = [...params, type]; }
    if (companyId) { sql += ' AND l.company_id = ?'; params = [...params, companyId]; }
    const rows = await all(sql, params);
    const due = await makeImplicitDue();
    const payMap = await paymentsByEntry(); // each payment counts in the month it was received

    const blank = () => ({ billed: 0, collected: 0, outstanding: 0, past_due: 0, past_due_count: 0, entries: 0, open_count: 0 });
    const ymOf = (v) => {
      const ms = parseDate(v);
      if (ms === null) return null;
      const d = new Date(ms);
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
    };
    const inPeriod = (ym) => {
      if (view === 'all') return fm ? (!!ym && ym.m === fm) : true;
      if (!ym || ym.y !== year) return false;
      if (view === 'year') return fm ? ym.m === fm : true;
      return allMonths || ym.m === month;
    };

    const yearAgg = new Map();
    const monthAgg = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, ...blank() }));
    const yAgg = (y) => { if (!yearAgg.has(y)) yearAgg.set(y, { year: y, ...blank() }); return yearAgg.get(y); };

    const period = blank();
    // unpaid balance whose DUE DATE falls in the selected month (not the covered period)
    const dueIn = { total: 0, count: 0, upcoming: 0, upcoming_count: 0, by_type: { HMO: 0, CHARGE: 0, COMPANY: 0 }, before: 0, before_count: 0, before_by_type: { HMO: 0, CHARGE: 0, COMPANY: 0 }, before_start: null, before_year_only: false };
    // overdue from EARLIER than the selected period (so Due + this = what Cash Position calls Due Receivables); only when the period has a known start
    const pad = (n) => String(n).padStart(2, '0');
    const periodStart = view === 'all' ? null
      : view === 'month' ? `${year}-${allMonths ? '01' : pad(month)}`
      : `${year}-${fm ? pad(fm) : '01'}`;
    dueIn.before_start = periodStart;
    dueIn.before_year_only = !!periodStart && ((view === 'month' && allMonths) || (view === 'year' && !fm));
    const bucketLabels = ['Not Yet Due', '0-30 days', '31-60 days', '61-90 days', 'Over 90 days', 'N/A'];
    const aging = Object.fromEntries(bucketLabels.map((l) => [l, { count: 0, total: 0 }]));
    const companies = new Map();
    const periodEntries = [];
    const undated = { billed_count: 0, billed_total: 0, collected_total: 0 };
    const byType = { COMPANY: blank(), HMO: blank(), CHARGE: blank() };

    const co = (r) => {
      let c = companies.get(r.company_id);
      if (!c) { c = { id: toInt(r.company_id), name: r.company_name, status: r.company_status, account_type: r.account_type, billed: 0, collected: 0, outstanding: 0, past_due: 0 }; companies.set(r.company_id, c); }
      return c;
    };

    for (const r of rows) {
      const amount = toFloat(r.amount);
      const paid = toFloat(r.paid_amount);
      const bal = toFloat(r.balance);
      const open = bal > 0.009;
      const d = open ? daysOverdue(dueOf(r, due)) : null;
      const late = open && d !== null && d > 0;

      // placed by the covered period (its end date), falling back to the billing date when none is set
      const coverDate = r.period_to || r.period_from || r.billing_date;
      const b = ymOf(coverDate);
      const tt = byType[r.account_type === 'HMO' ? 'HMO' : r.account_type === 'CHARGE' ? 'CHARGE' : 'COMPANY'];
      if (!b) {
        undated.billed_count++; undated.billed_total += amount;
      } else {
        const ya = yAgg(b.y);
        ya.billed += amount; ya.entries++;
        if (open) { ya.outstanding += bal; ya.open_count++; }
        if (late) { ya.past_due += bal; ya.past_due_count++; }
        if (b.y === year) {
          const ma = monthAgg[b.m - 1];
          ma.billed += amount; ma.entries++;
          if (open) { ma.outstanding += bal; ma.open_count++; }
          if (late) { ma.past_due += bal; ma.past_due_count++; }
        }
      }
      if (open) {
        // same rule as Reports by Month: its own Due Date, else Period Date + the payment terms (3 months)
        const dk = r.due_date ? monthKey(r.due_date) : (monthKey(r.period_date) ? addMonthsKey(monthKey(r.period_date), DEFAULT_TERMS_MONTHS) : null);
        const dueYm = dk ? { y: toInt(dk.slice(0, 4)), m: toInt(dk.slice(5, 7)) } : null;
        if (inPeriod(dueYm)) {
          dueIn.total += bal; dueIn.count++;
          dueIn.by_type[r.account_type === 'HMO' ? 'HMO' : r.account_type === 'CHARGE' ? 'CHARGE' : 'COMPANY'] += bal;
        } else if (periodStart && dk && dk < periodStart) {
          dueIn.before += bal; dueIn.before_count++;
          dueIn.before_by_type[r.account_type === 'HMO' ? 'HMO' : r.account_type === 'CHARGE' ? 'CHARGE' : 'COMPANY'] += bal;
        }
      }
      if (inPeriod(b)) {
        period.billed += amount; period.entries++;
        tt.billed += amount; tt.entries++;
        const c = co(r); c.billed += amount;
        if (open) {
          period.outstanding += bal; period.open_count++; c.outstanding += bal; tt.outstanding += bal; tt.open_count++;
          aging[agingBucket(d)].count++; aging[agingBucket(d)].total += bal;
        }
        if (late) { period.past_due += bal; period.past_due_count++; c.past_due += bal; tt.past_due += bal; tt.past_due_count++; }
        periodEntries.push({
          id: toInt(r.id), company_id: toInt(r.company_id), company_name: r.company_name, account_type: r.account_type,
          billing_date: r.billing_date, period_from: r.period_from, period_to: r.period_to, soa_number: r.soa_number, amount, paid_amount: paid, balance: bal,
          overdue_days: late ? d : 0, _t: b ? parseDate(coverDate) : null,
        });
      }

      // placed by payment date: one payment per piece when the row has a payment history, else the row's own Paid
      const pieces = payMap.get(String(r.id)) || (paid > 0 ? [{ payment_date: r.payment_date, amount: paid }] : []);
      for (const pc of pieces) {
        if (!(pc.amount > 0)) continue;
        const p = ymOf(pc.payment_date);
        if (!p) {
          undated.collected_total += pc.amount;
        } else {
          yAgg(p.y).collected += pc.amount;
          if (p.y === year) monthAgg[p.m - 1].collected += pc.amount;
        }
        if (inPeriod(p)) { period.collected += pc.amount; co(r).collected += pc.amount; tt.collected += pc.amount; }
      }
    }

    // make sure the selected / current year is always in the list
    yAgg(year); yAgg(nowYear);
    const withRate = (o) => ({ ...o, collection_rate: o.billed > 0 ? round((o.collected / o.billed) * 100, 1) : 0 });

    periodEntries.sort((a, b) => (b._t ?? 0) - (a._t ?? 0) || b.id - a.id);
    const companyList = [...companies.values()]
      .filter((c) => c.billed > 0 || c.collected > 0 || c.outstanding > 0)
      .sort((a, b) => b.outstanding - a.outstanding || b.billed - a.billed);

    return { ok: true, data: {
      today: todayKey,
      company_id: companyId,
      type,
      view, year, month, fm,
      period: withRate(period),
      due_in: dueIn,
      by_type: { COMPANY: withRate(byType.COMPANY), HMO: withRate(byType.HMO), CHARGE: withRate(byType.CHARGE) },
      years: [...yearAgg.values()].sort((a, b) => a.year - b.year).map(withRate),
      months: monthAgg.map(withRate),
      aging,
      companies: companyList.slice(0, 300), // the page shows the top 15 when combined, all of them in separate blocks
      companies_total: companyList.length,
      entries: periodEntries.slice(0, 100).map(({ _t, ...e }) => e),
      entries_total: periodEntries.length,
      undated,
    } };
  },

  // ---------------------------------------------------------------- EXECUTIVE DASHBOARD
  // The owner / accounting overview: where the money is, how old it is, how
  // collections are trending, and who to chase first.
  async get_exec_dashboard(input, auth) {
    const [bw, bp] = branchWhere(auth, 'c');
    const due = await makeImplicitDue();
    const rows = await all(
      `SELECT l.id, l.company_id, l.billing_date, l.period_from, l.period_to, l.due_date, l.payment_date, l.amount, l.paid_amount, l.balance,
              l.soa_number, c.name AS company_name, c.account_type
       FROM ledger_entries l JOIN companies c ON c.id = l.company_id
       WHERE 1=1 ${bw}`, bp);

    const labels = ['Not Yet Due', '0-30 days', '31-60 days', '61-90 days', 'Over 90 days', 'N/A'];
    const buckets = Object.fromEntries(labels.map((l) => [l, { count: 0, total: 0 }]));
    let billed = 0, collected = 0, outstanding = 0, pastDueTotal = 0, pastDueCount = 0, openCount = 0;
    let overpaidTotal = 0, overpaidCount = 0;
    const byCompany = new Map();
    const typeOf = (t) => (t === 'HMO' ? 'HMO' : t === 'CHARGE' ? 'CHARGE' : 'COMPANY');
    const byType = Object.fromEntries(['HMO', 'CHARGE', 'COMPANY'].map((k) => [k, { billed: 0, collected: 0, outstanding: 0, past_due: 0, past_due_count: 0, open_count: 0, accounts: new Set() }]));

    // Month keys for the last 12 months (Manila time), oldest first
    const today = new Date(todayMs());
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
      months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }
    const trend = Object.fromEntries(months.map((m) => [m, { month: m, billed: 0, collected: 0 }]));
    const monthOf = (v) => {
      const ms = parseDate(v);
      if (ms === null) return null;
      const d = new Date(ms);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    };
    const recentPayments = [];
    const payMap = await paymentsByEntry(); // one piece per payment received (falls back to the row's own Paid)

    for (const r of rows) {
      const amount = toFloat(r.amount);
      const paid = toFloat(r.paid_amount);
      const bal = toFloat(r.balance);
      billed += amount;
      collected += paid;
      const tg = byType[typeOf(r.account_type)];
      tg.billed += amount; tg.collected += paid; tg.accounts.add(r.company_id);
      const bm = monthOf(r.period_to || r.period_from || r.billing_date); // covered period month
      if (bm && trend[bm]) trend[bm].billed += amount;
      const pieces = payMap.get(String(r.id)) || (paid > 0 ? [{ payment_date: r.payment_date, amount: paid }] : []);
      for (const pc of pieces) {
        if (!(pc.amount > 0)) continue;
        const pm = monthOf(pc.payment_date);
        if (pm && trend[pm]) trend[pm].collected += pc.amount;
        if (pc.payment_date && parseDate(pc.payment_date) !== null) {
          recentPayments.push({ id: r.id, company_id: r.company_id, company_name: r.company_name,
            payment_date: pc.payment_date, paid_amount: pc.amount, soa_number: r.soa_number, _t: parseDate(pc.payment_date) });
        }
      }
      if (bal < -0.009) { overpaidTotal += -bal; overpaidCount++; }
      if (bal <= 0.009) continue;

      outstanding += bal;
      openCount++;
      tg.outstanding += bal; tg.open_count++;
      const d = daysOverdue(dueOf(r, due));
      const bucket = agingBucket(d);
      buckets[bucket].count++;
      buckets[bucket].total += bal;
      if (d !== null && d > 0) {
        pastDueTotal += bal;
        pastDueCount++;
        tg.past_due += bal; tg.past_due_count++;
        const c = byCompany.get(r.company_id) || { id: toInt(r.company_id), name: r.company_name, account_type: typeOf(r.account_type), past_due: 0, entries: 0, oldest_days: 0 };
        c.past_due += bal;
        c.entries++;
        c.oldest_days = Math.max(c.oldest_days, d);
        byCompany.set(r.company_id, c);
      }
    }

    recentPayments.sort((a, b) => b._t - a._t || b.id - a.id);

    return { ok: true, data: {
      today: todayYmd(),
      totals: {
        billed, collected, outstanding, past_due: pastDueTotal, past_due_count: pastDueCount,
        open_count: openCount,
        collection_rate: billed > 0 ? round((collected / billed) * 100, 1) : 0,
        past_due_share: outstanding > 0 ? round((pastDueTotal / outstanding) * 100, 1) : 0,
        companies_past_due: byCompany.size,
        overpaid_total: overpaidTotal, overpaid_count: overpaidCount,
      },
      buckets,
      top_past_due: [...byCompany.values()].sort((a, b) => b.past_due - a.past_due).slice(0, 8),
      past_due_accounts: [...byCompany.values()].sort((a, b) => b.past_due - a.past_due).slice(0, 300),
      by_type: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, { ...v, accounts: v.accounts.size, collection_rate: v.billed > 0 ? round((v.collected / v.billed) * 100, 1) : 0 }])),
      trend: Object.values(trend),
      recent_payments: recentPayments.slice(0, 8).map(({ _t, ...p }) => p),
    } };
  },

  // ---------------------------------------------------------------- SUMMARY
  async get_summary(input, auth) {
    const companyId = isSet(input.company_id) && input.company_id !== '' ? toInt(input.company_id) : null;
    if (companyId) await requireCompanyAccess(auth, companyId);
    const bucketFilterMap = {
      not_yet_due: 'Not Yet Due', '0-30': '0-30 days', '31-60': '31-60 days', '61-90': '61-90 days', over90: 'Over 90 days',
    };
    let agingFilter = input.aging ?? '';
    if (typeof agingFilter !== 'string' || !Object.hasOwn(bucketFilterMap, agingFilter)) agingFilter = '';
    const showAll = truthy(input.show_all) && !auth.isExecutive();
    const searchQuery = trim(input.q ?? '');

    let sql = 'SELECT l.*, c.name as company_name, c.account_type FROM ledger_entries l JOIN companies c ON c.id = l.company_id';
    const where = [];
    let params = [];
    if (!showAll) where.push('l.balance > 0.009');
    if (companyId) {
      where.push('l.company_id = ?');
      params.push(companyId);
    } else {
      const [bs, bp] = branchWhereStandalone(auth, 'c');
      if (bs !== '') {
        where.push(bs.replace(/^\s*WHERE\s*/i, ''));
        params = params.concat(bp);
      }
    }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY UPPER(l.billing_date) COLLATE "C" ASC NULLS FIRST, l.id ASC';
    const rows = await all(sql, params);
    const due = await makeImplicitDue();

    let summary = rows.map((r) => {
      const d = daysOverdue(dueOf(r, due));
      const sinceBilling = daysOverdue(r.billing_date);
      const isPaid = toFloat(r.balance) <= 0.009;
      r.deduction = toFloat(r.balance);
      r.is_paid = isPaid;
      r.is_overdue = !isPaid && d !== null && d > 0;
      r.days = r.is_overdue ? d : sinceBilling;
      r.aging_bucket = isPaid ? 'Paid' : agingBucket(d);
      return r;
    });

    // Owner / accounting accounts only see entries that are past due.
    if (auth.isExecutive()) summary = summary.filter((r) => r.is_overdue);

    if (agingFilter) summary = summary.filter((r) => r.aging_bucket === bucketFilterMap[agingFilter]);

    if (searchQuery !== '') {
      const needle = searchQuery.toLowerCase();
      summary = summary.filter((r) =>
        [r.company_name, r.deduction_remarks, r.remarks, r.soa_number, r.billing_date, r.amount]
          .map((x) => x ?? '').join(' ').toLowerCase().includes(needle)
      );
    }
    return { ok: true, data: summary };
  },

  // ---------------------------------------------------------------- COMPANIES
  async get_companies(input, auth) {
    const [w, p] = branchWhereStandalone(auth, 'c');
    const data = await all(
      `SELECT c.*, COALESCE(SUM(l.balance),0) as outstanding, COUNT(l.id) as entry_count
       FROM companies c LEFT JOIN ledger_entries l ON l.company_id = c.id
       ${w}
       GROUP BY c.id ORDER BY UPPER(c.name) COLLATE "C" ASC, c.id ASC`, p);
    return { ok: true, data };
  },

  async get_company(input, auth) {
    const id = toInt(input.id);
    await requireCompanyAccess(auth, id);
    const row = await one('SELECT * FROM companies WHERE id = ?', [id]);
    if (!row) jsonExit({ ok: false, error: 'Not found.' }, 404);
    return { ok: true, data: row };
  },

  async create_company(input, auth) { return saveCompany(input, auth, 'create_company'); },
  async update_company(input, auth) { return saveCompany(input, auth, 'update_company'); },

  async delete_company(input, auth) {
    const id = toInt(input.id);
    await requireCompanyAccess(auth, id);
    const name = await scalar('SELECT name FROM companies WHERE id=?', [id]);
    // Billing transactions already posted into this company's ledger go with its entries.
    await exec('DELETE FROM billing_transactions WHERE ledger_entry_id IN (SELECT id FROM ledger_entries WHERE company_id = ?)', [id]);
    await exec('DELETE FROM companies WHERE id=?', [id]);
    return { ok: true, message: `Company "${name ?? ''}" and its ledger entries were deleted.` };
  },

  async update_company_status(input, auth) {
    const id = toInt(input.id);
    const newStatus = input.status ?? '';
    if (!STATUSES.includes(newStatus)) jsonExit({ ok: false, error: 'Invalid status value.' }, 400);
    await requireCompanyAccess(auth, id);
    await exec('UPDATE companies SET status=? WHERE id=?', [newStatus, id]);
    return { ok: true, message: `Status updated to ${newStatus}.` };
  },

  async get_branches(input, auth) {
    const branches = await all(`SELECT username, full_name FROM users WHERE role = 'branch' ORDER BY UPPER(username) COLLATE "C" ASC`);
    const stats = {};
    if (auth.isAdmin() || auth.isAccounting()) {
      const rows = await all(
        `SELECT c.branch, COUNT(DISTINCT c.id) AS company_count, COALESCE(SUM(l.balance),0) AS outstanding
         FROM companies c LEFT JOIN ledger_entries l ON l.company_id = c.id
         GROUP BY c.branch ORDER BY c.branch NULLS FIRST`);
      for (const r of rows) stats[r.branch ?? ''] = r;
    }
    // PHP encoded an empty array as [] (not {}).
    return { ok: true, data: { branches, stats: Object.keys(stats).length ? stats : [] } };
  },

  // ---------------------------------------------------------------- LEDGER
  async get_ledger(input, auth) {
    const companyId = isSet(input.company_id) && input.company_id !== '' ? toInt(input.company_id) : null;
    if (companyId) await requireCompanyAccess(auth, companyId);
    let sql = 'SELECT l.*, c.name as company_name, c.status as company_status, c.account_type as account_type, h.name as via_hmo_name FROM ledger_entries l JOIN companies c ON c.id = l.company_id LEFT JOIN companies h ON h.id = l.via_hmo_id';
    let params = [];
    if (companyId) {
      sql += ' WHERE l.company_id = ?';
      params.push(companyId);
    } else {
      const [bs, bp] = branchWhereStandalone(auth, 'c');
      sql += bs;
      params = bp;
    }
    sql += ' ORDER BY UPPER(l.billing_date) COLLATE "C" DESC NULLS LAST, l.id DESC';
    const entries = await all(sql, params);
    const due = await makeImplicitDue();

    const selectedCompany = companyId ? await one('SELECT * FROM companies WHERE id=?', [companyId]) : null;

    // how many payments each row has (the "+ Payment" button shows it); 0 everywhere until the payments table exists
    const payCounts = new Map();
    const paymentsOn = await paymentsEnabled();
    if (paymentsOn && entries.length) {
      const counts = await all('SELECT ledger_entry_id, COUNT(*) AS n FROM ledger_payments GROUP BY ledger_entry_id');
      counts.forEach((c) => payCounts.set(String(c.ledger_entry_id), toInt(c.n)));
    }
    for (const r of entries) r.payment_count = payCounts.get(String(r.id)) || 0;

    const agingTally = {};
    for (const r of entries) {
      if (toFloat(r.balance) <= 0.009) continue;
      const bucket = agingBucket(daysOverdue(dueOf(r, due)));
      agingTally[bucket] = (agingTally[bucket] ?? 0) + toFloat(r.balance);
    }

    for (const r of entries) {
      if (toFloat(r.balance) <= 0.009) {
        r.is_paid = true;
        r.is_overdue = false;
        r.days_overdue = null;
        r.aging_bucket = 'Paid';
        continue;
      }
      const d = daysOverdue(dueOf(r, due));
      r.is_paid = false;
      r.is_overdue = d !== null && d > 0;
      r.days_overdue = d;
      r.aging_bucket = agingBucket(d);
    }

    let companySummary = [];
    if (!companyId) {
      const [bws, bps] = branchWhereStandalone(auth, 'c');
      const rows = await all(
        `SELECT c.id, c.name, c.status, c.account_type, COUNT(l.id) as entry_count, COALESCE(SUM(l.balance),0) as outstanding
         FROM companies c LEFT JOIN ledger_entries l ON l.company_id = c.id
         ${bws}
         GROUP BY c.id ORDER BY c.id`, bps);
      const byCompany = new Map();
      for (const row of rows) {
        if (toInt(row.entry_count) === 0) continue; // no ledger entries at all -- nothing to show
        byCompany.set(toInt(row.id), {
          id: toInt(row.id),
          name: row.name,
          status: row.status,
          account_type: row.account_type,
          outstanding: toFloat(row.outstanding),
          worst_days_overdue: null,
          soonest_days_until_due: null,
        });
      }
      for (const r of entries) {
        if (r.is_paid) continue;
        const c = byCompany.get(toInt(r.company_id));
        if (!c) continue;
        const d = r.days_overdue;
        if (d === null) continue;
        if (d > 0) {
          if (c.worst_days_overdue === null || d > c.worst_days_overdue) c.worst_days_overdue = d;
        } else {
          const untilDue = -d;
          if (c.soonest_days_until_due === null || untilDue < c.soonest_days_until_due) c.soonest_days_until_due = untilDue;
        }
      }
      companySummary = [...byCompany.values()].sort((a, b) => b.outstanding - a.outstanding);
    }

    return { ok: true, data: {
      entries,
      company: selectedCompany,
      totals: { amount: sum(entries, 'amount'), paid: sum(entries, 'paid_amount'), balance: sum(entries, 'balance') },
      tax_percent: await taxWithheldPercent(),
      payments_enabled: paymentsOn,
      aging_tally: Object.keys(agingTally).length ? agingTally : [],
      company_summary: companySummary,
    } };
  },

  async quick_add_ledger(input, auth) {
    const cid = toInt(input.company_id);
    await requireCompanyAccess(auth, cid);
    const cName = await scalar('SELECT name FROM companies WHERE id = ?', [cid]);
    const billingDate = todayYmd();
    const cp = (await autoCoveredPeriodEnabled()) ? coveredPeriodForBilling(billingDate, await coveredPeriodRules()) : null; // follows the billing date when the Settings switch is ON
    const id = await insertId(
      `INSERT INTO ledger_entries (company_id, company_name, billing_date, period_from, period_to, period_date, amount, tax_withheld, surcharge, rebate, paid_amount, receivable_amount, balance)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0)`,
      [cid, cName || null, billingDate, cp?.from ?? null, cp?.to ?? null, cp ? normalizePeriod(cp.from) : null]
    );
    return { ok: true, id };
  },


  // ---- several payments on one ledger row
  async get_payments(input, auth) {
    const id = toInt(input.ledger_entry_id);
    const cid = await scalar('SELECT company_id FROM ledger_entries WHERE id = ?', [id]);
    if (!cid) jsonExit({ ok: false, error: 'Entry not found.' }, 404);
    await requireCompanyAccess(auth, toInt(cid));
    if (!(await paymentsEnabled())) {
      const e = await one('SELECT id, soa_number, amount, receivable_amount, paid_amount, balance, payment_date FROM ledger_entries WHERE id = ?', [id]);
      return { ok: true, data: { enabled: false, entry: e, payments: [], payment_count: 0 } };
    }
    return { ok: true, data: await paymentsReply(id) };
  },

  async add_payment(input, auth) {
    const id = toInt(input.ledger_entry_id);
    const cid = await scalar('SELECT company_id FROM ledger_entries WHERE id = ?', [id]);
    if (!cid) jsonExit({ ok: false, error: 'Entry not found.' }, 404);
    await requireCompanyAccess(auth, toInt(cid));
    if (!(await paymentsEnabled())) jsonExit({ ok: false, error: 'Payments are not set up yet. Run database/add_ledger_payments.sql in Supabase first.' }, 400);
    const p = cleanPayment(input);
    // a row that still has Paid typed in directly (no payment record yet) keeps that amount as its first payment
    await mirrorRowToPayments(id);
    await exec(
      `INSERT INTO ledger_payments (ledger_entry_id, payment_date, amount, check_ref, check_date, payment_method, payment_method_bank, payment_method_other, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, p.payment_date, p.amount, p.check_ref, p.check_date, p.payment_method, p.payment_method_bank, p.payment_method_other, p.remarks]);
    const row = await syncRowFromPayments(id);
    return { ok: true, row, data: await paymentsReply(id) };
  },

  async update_payment(input, auth) {
    const pid = toInt(input.id);
    if (!(await paymentsEnabled())) jsonExit({ ok: false, error: 'Payments are not set up yet.' }, 400);
    const pay = await one('SELECT * FROM ledger_payments WHERE id = ?', [pid]);
    if (!pay) jsonExit({ ok: false, error: 'Payment not found.' }, 404);
    const cid = await scalar('SELECT company_id FROM ledger_entries WHERE id = ?', [pay.ledger_entry_id]);
    await requireCompanyAccess(auth, toInt(cid));
    const p = cleanPayment(input);
    await exec(
      `UPDATE ledger_payments SET payment_date = ?, amount = ?, check_ref = ?, check_date = ?, payment_method = ?,
              payment_method_bank = ?, payment_method_other = ?, remarks = ? WHERE id = ?`,
      [p.payment_date, p.amount, p.check_ref, p.check_date, p.payment_method, p.payment_method_bank, p.payment_method_other, p.remarks, pid]);
    const row = await syncRowFromPayments(toInt(pay.ledger_entry_id));
    return { ok: true, row, data: await paymentsReply(toInt(pay.ledger_entry_id)) };
  },

  async delete_payment(input, auth) {
    const pid = toInt(input.id);
    if (!(await paymentsEnabled())) jsonExit({ ok: false, error: 'Payments are not set up yet.' }, 400);
    const pay = await one('SELECT * FROM ledger_payments WHERE id = ?', [pid]);
    if (!pay) jsonExit({ ok: false, error: 'Payment not found.' }, 404);
    const cid = await scalar('SELECT company_id FROM ledger_entries WHERE id = ?', [pay.ledger_entry_id]);
    await requireCompanyAccess(auth, toInt(cid));
    await exec('DELETE FROM ledger_payments WHERE id = ?', [pid]);
    const row = await syncRowFromPayments(toInt(pay.ledger_entry_id));
    return { ok: true, row, data: await paymentsReply(toInt(pay.ledger_entry_id)) };
  },

  async inline_update_ledger(input, auth) {
    const allowed = ['billing_date', 'period_date', 'covered_period', 'soa_number', 'amount', 'tax_withheld', 'surcharge', 'rebate',
      'payment_date', 'check_ref', 'check_date', 'paid_amount', 'due_date', 'remarks', 'deduction_remarks',
      'payment_method', 'payment_method_bank', 'payment_method_other'];
    const id = toInt(input.id);
    const field = input.field ?? '';
    let value = input.value ?? null;

    if (!id || !allowed.includes(field)) jsonExit({ ok: false, error: 'Invalid field.' }, 400);
    if (field === 'tax_withheld') jsonExit({ ok: false, error: 'Tax W/H is calculated automatically (Amount x tax %).' }, 400);
    if (auth.isStaff() && !STAFF_EDITABLE_FIELDS.includes(field)) {
      jsonExit({ ok: false, error: 'Staff accounts can only edit Payment Date, Check Ref and Paid.' }, 403);
    }

    const row = await one('SELECT * FROM ledger_entries WHERE id = ?', [id]);
    if (!row) jsonExit({ ok: false, error: 'Entry not found.' }, 404);
    await requireCompanyAccess(auth, toInt(row.company_id));

    if (field === 'covered_period') {
      // "2026-09-18|2026-09-30" (or '' to clear). period_date keeps the month so Reports by Month still works.
      const [pf, pt] = String(value ?? '').split('|').map((x) => x.trim());
      const ymd = /^\d{4}-\d{2}-\d{2}$/;
      if (!pf && !pt) {
        await exec(`UPDATE ledger_entries SET period_from=NULL, period_to=NULL, period_date=NULL, updated_at=(now() AT TIME ZONE 'Asia/Manila') WHERE id=?`, [id]);
      } else {
        if (!ymd.test(pf || '') || !ymd.test(pt || '')) jsonExit({ ok: false, error: 'Enter both dates for the covered period.' }, 400);
        if (pf > pt) jsonExit({ ok: false, error: 'The covered period "to" date cannot be before the "from" date.' }, 400);
        await exec(`UPDATE ledger_entries SET period_from=?, period_to=?, period_date=?, updated_at=(now() AT TIME ZONE 'Asia/Manila') WHERE id=?`, [pf, pt, normalizePeriod(pf), id]);
      }
      return { ok: true, receivable_amount: row.receivable_amount, balance: row.balance };
    }

    if (['amount', 'tax_withheld', 'surcharge', 'rebate', 'paid_amount'].includes(field)) {
      value = value === '' || value === null ? 0 : toFloat(value);
    } else if (field === 'period_date') {
      // Always stored as the 1st of the month: "2026-06-01" = June 2026.
      if (value === '' || value === null) {
        value = null;
      } else {
        value = normalizePeriod(value);
        if (value === null) jsonExit({ ok: false, error: 'Choose a month and a year for the Period Date.' }, 400);
      }
    } else if (['billing_date', 'payment_date', 'due_date', 'check_date'].includes(field)) {
      value = value === '' ? null : value === null ? null : String(value);
    } else if (field === 'soa_number') {
      value = elvis(trim(value).toUpperCase(), null);
    } else if (field === 'payment_method') {
      value = trim(value);
      value = PAYMENT_METHODS.includes(value) ? value : null;
    } else if (field === 'payment_method_bank') {
      value = trim(value);
      value = PAYMENT_BANKS.includes(value) ? value : null;
    } else {
      value = elvis(trim(value), null);
    }

    let sharedSoa = false;
    if (field === 'soa_number' && value) {
      const holder = await soaNumberHolder(value, id);
      if (holder && holder.where === 'ledger' && truthy(input.allow_shared)) {
        sharedSoa = true; // confirmed: two payments use the same SOA
      } else if (holder && holder.where === 'ledger') {
        // The browser asks "use the same SOA on both payments?" and retries with allow_shared.
        jsonExit({ ok: false, code: 'SOA_SHARED', error: `SOA number "${String(value).toUpperCase()}" is already in use — ${holder.text}.` }, 409);
      } else if (holder) {
        jsonExit({ ok: false, error: `SOA number "${value}" is already in use — ${holder.text}. Add a letter like A or B for a supplementary copy, or use a different number.` }, 409);
      }
    }

    const payLinked = field === 'paid_amount' || PAY_FIELDS.includes(field);
    const payOn = payLinked && (await paymentsEnabled());
    if (payOn) {
      const n = toInt(await scalar('SELECT COUNT(*) FROM ledger_payments WHERE ledger_entry_id = ?', [id]));
      if (n > 1) jsonExit({ ok: false, code: 'MULTI_PAYMENT', error: `This entry has ${n} payments. Use the + Payment button to change them.` }, 409);
    }

    row[field] = value;
    // Tax W/H is automatic (view only in the Ledger): Amount x the tax % (Settings, 2 by default), none for
    // Charge to Company accounts. It is re-derived on every edit so every row follows the same formula.
    // Rebate is NOT calculated: only a rebate that someone actually enters reduces the balance. An unpaid
    // difference stays outstanding until it is paid.
    const acctType = await scalar('SELECT account_type FROM companies WHERE id = ?', [toInt(row.company_id)]);
    const autoTax = acctType === 'CHARGE' ? 0 : round(toFloat(row.amount) * (await taxWithheldPercent()) / 100, 2);
    row.tax_withheld = autoTax;
    const [receivable, balance] = recalcRow(row);

    // `field` is checked against the allow-list above, so it's safe to put in the SQL.
    await exec(
      `UPDATE ledger_entries SET ${field} = ?, receivable_amount = ?, balance = ?, updated_at = (now() AT TIME ZONE 'Asia/Manila') WHERE id = ?`,
      [value, receivable, balance, id]
    );
    await exec('UPDATE ledger_entries SET tax_withheld = ? WHERE id = ?', [autoTax, id]);
    if (payOn) await mirrorRowToPayments(id);

    if (field === 'soa_number') {
      if (value) {
        await recordSoaNumberUsed(value, row.company_id, id, sharedSoa);
      } else {
        await releaseSoaForEntry(id);
      }
    }

    const due = await makeImplicitDue();
    return {
      ok: true,
      receivable_amount: receivable,
      balance,
      tax_withheld: autoTax,
      deduction: balance,
      aging_bucket: agingBucket(daysOverdue(dueOf(row, due))),
    };
  },

  async delete_ledger(input, auth) {
    // Only Admin and Executive accounts may delete ledger data. Staff and Branch accounts may not.
    if (!auth.isAdmin() && !auth.isExecutive() && !auth.isAccounting()) {
      jsonExit({ ok: false, error: 'Only Admin, Accounting and Executive accounts can delete ledger entries.' }, 403);
    }
    const id = toInt(input.id);
    const cid = await scalar('SELECT company_id FROM ledger_entries WHERE id=?', [id]);
    if (!cid) jsonExit({ ok: false, error: 'Entry not found.' }, 404);
    await requireCompanyAccess(auth, toInt(cid));
    // Free the SOA number first; otherwise the tracker row stays USED forever and blocks the number.
    await releaseSoaForEntry(id);
    // The Billing transaction that was posted into this entry goes too, so it doesn't stay "POSTED" with nothing behind it.
    await exec('DELETE FROM billing_transactions WHERE ledger_entry_id = ?', [id]);
    await exec('DELETE FROM ledger_entries WHERE id=?', [id]);
    return { ok: true, message: 'Ledger entry deleted.' };
  },

  // Move a charge from an HMO's ledger onto the company that HMO is linked to.
  async charge_entry_to_company(input, auth) {
    const id = toInt(input.id);
    const entry = await one('SELECT id, company_id FROM ledger_entries WHERE id=?', [id]);
    if (!entry) jsonExit({ ok: false, error: 'Entry not found.' }, 404);
    await requireCompanyAccess(auth, toInt(entry.company_id));
    const hmo = await one('SELECT id, account_type, linked_company_id FROM companies WHERE id=?', [toInt(entry.company_id)]);
    if (!hmo || hmo.account_type !== 'HMO') jsonExit({ ok: false, error: 'Only HMO charges can be charged to a company.' }, 400);
    if (!hmo.linked_company_id) jsonExit({ ok: false, error: 'This HMO is not linked to a company yet. Edit the HMO under Companies and choose its company.' }, 400);
    const target = await one('SELECT id, name FROM companies WHERE id=?', [toInt(hmo.linked_company_id)]);
    if (!target) jsonExit({ ok: false, error: 'The linked company no longer exists.' }, 400);
    await requireCompanyAccess(auth, toInt(target.id));
    await exec('UPDATE ledger_entries SET company_id=?, company_name=?, via_hmo_id=? WHERE id=?', [toInt(target.id), target.name, toInt(hmo.id), id]);
    return { ok: true, message: `Charged to ${target.name}.` };
  },

  // Undo the above: send the charge back to the HMO it came from.
  async return_entry_to_hmo(input, auth) {
    const id = toInt(input.id);
    const entry = await one('SELECT id, company_id, via_hmo_id FROM ledger_entries WHERE id=?', [id]);
    if (!entry) jsonExit({ ok: false, error: 'Entry not found.' }, 404);
    if (!entry.via_hmo_id) jsonExit({ ok: false, error: 'This entry was not charged through an HMO.' }, 400);
    await requireCompanyAccess(auth, toInt(entry.company_id));
    await requireCompanyAccess(auth, toInt(entry.via_hmo_id));
    const hmoName = await scalar('SELECT name FROM companies WHERE id=?', [toInt(entry.via_hmo_id)]);
    await exec('UPDATE ledger_entries SET company_id=?, company_name=?, via_hmo_id=NULL WHERE id=?', [toInt(entry.via_hmo_id), hmoName, id]);
    return { ok: true, message: `Returned to ${hmoName}.` };
  },

  // ---------------------------------------------------------------- BILLING (POS-style)
  // A billing transaction is opened with patient / service / amount, an HMO and
  // a company. "Bill to" says which of the two gets charged. Posting it adds a
  // charge to that account's ledger; voiding it removes that charge again.
  async get_billing(input, auth) {
    const b = auth.branch();
    const w = b === null ? '' : ' WHERE (LOWER(h.branch) = LOWER(?) OR LOWER(c.branch) = LOWER(?))';
    const p = b === null ? [] : [b, b];
    const data = await all(
      `SELECT t.*, h.name AS hmo_name, c.name AS company_name
       FROM billing_transactions t
       LEFT JOIN companies h ON h.id = t.hmo_id
       LEFT JOIN companies c ON c.id = t.company_id
       ${w}
       ORDER BY t.id DESC LIMIT 500`, p);
    return { ok: true, data };
  },

  async save_billing(input, auth) {
    const id = toInt(input.id);
    const billTo = input.bill_to === 'COMPANY' ? 'COMPANY' : 'HMO';
    // One account per transaction: an HMO, or a "Charge to company" account
    const hmoId = billTo === 'HMO' ? toInt(input.hmo_id) || null : null;
    const companyId = billTo === 'COMPANY' ? toInt(input.company_id) || null : null;
    const amount = toFloat(input.amount);
    const patient = trim(input.patient_name ?? '');
    const service = trim(input.service ?? '');
    const remarks = elvis(trim(input.remarks ?? ''), null);
    const txnDate = elvis(trim(input.txn_date ?? ''), todayYmd());
    let periodFrom = trim(input.period_from ?? '') || null;
    let periodTo = trim(input.period_to ?? '') || null;
    if (!periodFrom && !periodTo && (await autoCoveredPeriodEnabled())) {
      // No covered period given: work it out from the billing date (Settings switch).
      const cp = coveredPeriodForBilling(txnDate, await coveredPeriodRules());
      if (cp) { periodFrom = cp.from; periodTo = cp.to; }
    }
    const soa = trim(input.soa_number ?? '').toUpperCase() || null;

    if (!hmoId && !companyId) jsonExit({ ok: false, error: 'Choose an HMO.' }, 400);
    if (billTo === 'HMO' && !hmoId) jsonExit({ ok: false, error: 'Billing the HMO needs an HMO selected.' }, 400);
    if (billTo === 'COMPANY' && !companyId) jsonExit({ ok: false, error: 'Charge to company needs a charge account selected.' }, 400);
    if (amount < 0) jsonExit({ ok: false, error: 'Amount cannot be negative.' }, 400);
    if ((periodFrom && !periodTo) || (!periodFrom && periodTo)) jsonExit({ ok: false, error: 'Enter both dates for the covered period.' }, 400);
    if (periodFrom && periodTo && periodFrom > periodTo) jsonExit({ ok: false, error: 'The covered period "to" date cannot be before the "from" date.' }, 400);

    if (soa) {
      const holder = await soaNumberHolder(soa);
      if (holder) {
        jsonExit({ ok: false, error: `SOA number \"${soa}\" is already in use — ${holder.text}. Use a different number (or add A/B for a supplementary copy).` }, 409);
      }
    }

    if (hmoId) {
      const t = await scalar('SELECT account_type FROM companies WHERE id=?', [hmoId]);
      if (t !== 'HMO') jsonExit({ ok: false, error: 'The HMO you chose is not an HMO account.' }, 400);
      await requireCompanyAccess(auth, hmoId);
    }
    if (companyId) {
      const t = await scalar('SELECT account_type FROM companies WHERE id=?', [companyId]);
      if (t !== 'CHARGE') jsonExit({ ok: false, error: 'Choose a "Charge to company" account (add one under Companies).' }, 400);
      await requireCompanyAccess(auth, companyId);
    }

    if (!id) {
      const newId = await insertId(
        `INSERT INTO billing_transactions (txn_date, patient_name, service, amount, hmo_id, company_id, bill_to, status, remarks, period_from, period_to, soa_number)
         VALUES (?,?,?,?,?,?,?,'OPEN',?,?,?,?)`,
        [txnDate, patient, service, amount, hmoId, companyId, billTo, remarks, periodFrom, periodTo, soa]
      );
      return { ok: true, id: newId, message: 'Transaction opened.' };
    }

    const cur = await one('SELECT status FROM billing_transactions WHERE id=?', [id]);
    if (!cur) jsonExit({ ok: false, error: 'Transaction not found.' }, 404);
    if (cur.status !== 'OPEN') jsonExit({ ok: false, error: 'Only open transactions can be edited. Void it and open a new one.' }, 409);
    await exec(
      `UPDATE billing_transactions SET txn_date=?, patient_name=?, service=?, amount=?, hmo_id=?, company_id=?, bill_to=?, remarks=?, period_from=?, period_to=?, soa_number=? WHERE id=?`,
      [txnDate, patient, service, amount, hmoId, companyId, billTo, remarks, periodFrom, periodTo, soa, id]
    );
    return { ok: true, id, message: 'Transaction updated.' };
  },

  // Reads an uploaded SOA .xlsx (sent as base64) and returns what Billing needs to open a
  // transaction: the HMO it matches, billing date, SOA number, amounts and covered period.
  // It only reads the file; nothing is saved until the person confirms the import.
  async parse_soa(input, auth) {
    const name = trim(input.file_name ?? '') || 'SOA.xlsx';
    const b64 = String(input.data ?? '').replace(/^data:[^,]*,/, '');
    if (!b64) jsonExit({ ok: false, error: 'No file received.' }, 400);
    if (b64.length > 6_000_000) jsonExit({ ok: false, error: 'That file is too large (limit about 4 MB).' }, 413);
    const parsed = await parseSoa(Buffer.from(b64, 'base64'), name);
    if (parsed.error) return { ok: true, data: parsed };

    const [bw, bp] = branchWhere(auth, 'h');
    const hmos = await all(`SELECT h.id, h.name, h.code FROM companies h WHERE h.account_type = 'HMO' ${bw} ORDER BY UPPER(h.name) COLLATE "C" ASC`, bp);
    const { hmo, how } = matchHmo(parsed.company_name, hmos);
    let duplicate = null;
    if (parsed.soa_number) {
      const holder = await soaNumberHolder(parsed.soa_number);
      if (holder) duplicate = holder.text;
    }
    return { ok: true, data: { ...parsed, hmo_id: hmo ? String(hmo.id) : '', hmo_name: hmo ? hmo.name : '', hmo_match: how, duplicate } };
  },

  async post_billing(input, auth) {
    const id = toInt(input.id);
    const t = await one('SELECT * FROM billing_transactions WHERE id=?', [id]);
    if (!t) jsonExit({ ok: false, error: 'Transaction not found.' }, 404);
    if (t.status !== 'OPEN') jsonExit({ ok: false, error: 'This transaction is already posted or voided.' }, 409);
    const amount = toFloat(t.amount);
    if (amount <= 0) jsonExit({ ok: false, error: 'Enter an amount greater than zero before posting.' }, 400);

    const chargeId = toInt(t.bill_to === 'COMPANY' ? t.company_id : t.hmo_id);
    if (!chargeId) jsonExit({ ok: false, error: 'The account to bill no longer exists. Edit the transaction first.' }, 400);
    await requireCompanyAccess(auth, chargeId);

    const hmoName = t.hmo_id ? await scalar('SELECT name FROM companies WHERE id=?', [toInt(t.hmo_id)]) : null;
    const coName = t.company_id ? await scalar('SELECT name FROM companies WHERE id=?', [toInt(t.company_id)]) : null;
    const chargeName = t.bill_to === 'COMPANY' ? coName : hmoName;
    if (t.soa_number) {
      const holder = await soaNumberHolder(t.soa_number);
      if (holder) {
        jsonExit({ ok: false, error: `Can't post: SOA number "${t.soa_number}" is already in use — ${holder.text}. Edit the transaction and use a different number (or add A/B for a supplementary copy).` }, 409);
      }
    }
    const note = `${t.remarks ? `${trim(t.remarks)} ` : ''}[Billing #${id}]`;
    const periodMonth = t.period_from ? normalizePeriod(t.period_from) : null;

    const postTax = t.bill_to === 'COMPANY' ? 0 : round(amount * (await taxWithheldPercent()) / 100, 2); // Tax W/H = Amount x tax %; none for Charge to Company
    const entryId = await transaction(async (client) => {
      const eid = await insertId(
        `INSERT INTO ledger_entries (company_id, company_name, billing_date, soa_number, period_from, period_to, period_date, amount, tax_withheld, surcharge, rebate, paid_amount, receivable_amount, balance, remarks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?)`,
        [chargeId, chargeName, t.txn_date || todayYmd(), t.soa_number || null, t.period_from || null, t.period_to || null, periodMonth, amount, postTax, amount - postTax, amount - postTax, note], client
      );
      await exec(
        `UPDATE billing_transactions SET status='POSTED', ledger_entry_id=?, posted_at=(now() AT TIME ZONE 'Asia/Manila') WHERE id=?`,
        [eid, id], client
      );
      return eid;
    });
    if (t.soa_number) await recordSoaNumberUsed(t.soa_number, chargeId, entryId);
    return { ok: true, id, ledger_entry_id: entryId, company_id: chargeId, message: `Posted to ${chargeName}'s ledger.` };
  },

  async void_billing(input, auth) {
    const id = toInt(input.id);
    const t = await one('SELECT * FROM billing_transactions WHERE id=?', [id]);
    if (!t) jsonExit({ ok: false, error: 'Transaction not found.' }, 404);
    if (t.status === 'VOID') jsonExit({ ok: false, error: 'Already voided.' }, 409);

    if (t.status === 'POSTED' && t.ledger_entry_id) {
      const e = await one('SELECT id, company_id, paid_amount FROM ledger_entries WHERE id=?', [toInt(t.ledger_entry_id)]);
      if (e) {
        await requireCompanyAccess(auth, toInt(e.company_id));
        if (toFloat(e.paid_amount) > 0) {
          jsonExit({ ok: false, error: 'This charge already has a payment recorded. Remove the payment in the Ledger first, then void it.' }, 409);
        }
        await exec("UPDATE soa_tracker SET ledger_entry_id = NULL, status = 'UNUSED' WHERE ledger_entry_id = ?", [toInt(e.id)]);
        await exec('DELETE FROM ledger_entries WHERE id=?', [toInt(e.id)]);
      }
    }
    await exec(`UPDATE billing_transactions SET status='VOID', ledger_entry_id=NULL WHERE id=?`, [id]);
    return { ok: true, message: 'Transaction voided.' };
  },

  // ---------------------------------------------------------------- HMO PROVIDERS
  // One row per HMO account with what the clinic has charged through it.
  // "Billed to HMO" / "Billed to partners" come from posted Billing transactions;
  // "Account balance" is whatever sits on the HMO's own ledger.
  async get_hmos(input, auth) {
    const [bw, bp] = branchWhere(auth, 'h');
    const data = await all(
      `SELECT h.id, h.name, h.code, h.status, h.contact_person, h.contact_number, h.email_address, h.remarks, h.branch,
         COALESCE((SELECT SUM(l.balance) FROM ledger_entries l WHERE l.company_id = h.id), 0) AS account_balance,
         (SELECT COUNT(*) FROM hmo_partners p WHERE p.hmo_id = h.id) AS partner_count,
         COALESCE((SELECT SUM(t.amount) FROM billing_transactions t WHERE t.hmo_id = h.id AND t.status = 'OPEN'), 0) AS open_amount,
         (SELECT COUNT(*) FROM billing_transactions t WHERE t.hmo_id = h.id AND t.status = 'OPEN') AS open_count,
         COALESCE((SELECT SUM(t.amount) FROM billing_transactions t WHERE t.hmo_id = h.id AND t.status = 'POSTED' AND t.bill_to = 'HMO'), 0) AS billed_hmo,
         COALESCE((SELECT SUM(l.balance) FROM billing_transactions t JOIN ledger_entries l ON l.id = t.ledger_entry_id
                   WHERE t.hmo_id = h.id AND t.status = 'POSTED' AND t.bill_to = 'HMO'), 0) AS unpaid_hmo,
         COALESCE((SELECT SUM(t.amount) FROM billing_transactions t WHERE t.hmo_id = h.id AND t.status = 'POSTED' AND t.bill_to = 'COMPANY'), 0) AS billed_partners,
         COALESCE((SELECT SUM(l.balance) FROM billing_transactions t JOIN ledger_entries l ON l.id = t.ledger_entry_id
                   WHERE t.hmo_id = h.id AND t.status = 'POSTED' AND t.bill_to = 'COMPANY'), 0) AS unpaid_partners
       FROM companies h
       WHERE h.account_type = 'HMO' ${bw}
       ORDER BY UPPER(h.name) COLLATE "C" ASC, h.id ASC`, bp);
    return { ok: true, data };
  },

  async get_hmo(input, auth) {
    const id = toInt(input.id);
    await requireCompanyAccess(auth, id);
    const hmo = await one(`SELECT * FROM companies WHERE id = ? AND account_type = 'HMO'`, [id]);
    if (!hmo) jsonExit({ ok: false, error: 'HMO not found.' }, 404);

    // Partner companies: the ones set up explicitly, plus anyone the HMO has been billed with.
    const partners = await all(
      `SELECT c.id, c.name, c.status,
         EXISTS (SELECT 1 FROM hmo_partners p WHERE p.hmo_id = ? AND p.company_id = c.id) AS is_partner,
         (SELECT COUNT(*) FROM billing_transactions t WHERE t.hmo_id = ? AND t.company_id = c.id AND t.status <> 'VOID') AS txn_count,
         COALESCE((SELECT SUM(t.amount) FROM billing_transactions t WHERE t.hmo_id = ? AND t.company_id = c.id AND t.status = 'POSTED' AND t.bill_to = 'COMPANY'), 0) AS billed_to_company,
         COALESCE((SELECT SUM(l.balance) FROM billing_transactions t JOIN ledger_entries l ON l.id = t.ledger_entry_id
                   WHERE t.hmo_id = ? AND t.company_id = c.id AND t.status = 'POSTED' AND t.bill_to = 'COMPANY'), 0) AS unpaid
       FROM companies c
       WHERE c.account_type = 'COMPANY'
         AND (c.id IN (SELECT company_id FROM hmo_partners WHERE hmo_id = ?)
              OR c.id IN (SELECT company_id FROM billing_transactions WHERE hmo_id = ? AND company_id IS NOT NULL))
       ORDER BY UPPER(c.name) COLLATE "C" ASC`, [id, id, id, id, id, id]);

    const transactions = await all(
      `SELECT t.id, t.txn_date, t.patient_name, t.service, t.period_from, t.period_to, t.soa_number, t.amount, t.bill_to, t.status, t.ledger_entry_id, t.company_id,
              c.name AS company_name, l.balance AS ledger_balance, l.paid_amount AS ledger_paid
       FROM billing_transactions t
       LEFT JOIN companies c ON c.id = t.company_id
       LEFT JOIN ledger_entries l ON l.id = t.ledger_entry_id
       WHERE t.hmo_id = ?
       ORDER BY t.id DESC LIMIT 300`, [id]);

    return { ok: true, data: { hmo, partners, transactions } };
  },

  async get_hmo_partners(input, auth) {
    const data = await all('SELECT hmo_id, company_id FROM hmo_partners');
    return { ok: true, data };
  },

  async add_hmo_partner(input, auth) {
    const hmoId = toInt(input.hmo_id);
    const companyId = toInt(input.company_id);
    await requireCompanyAccess(auth, hmoId);
    await requireCompanyAccess(auth, companyId);
    const hmoType = await scalar('SELECT account_type FROM companies WHERE id=?', [hmoId]);
    const coType = await scalar('SELECT account_type FROM companies WHERE id=?', [companyId]);
    if (hmoType !== 'HMO') jsonExit({ ok: false, error: 'That account is not an HMO.' }, 400);
    if (coType !== 'COMPANY') jsonExit({ ok: false, error: 'Partners must be company accounts.' }, 400);
    await exec('INSERT INTO hmo_partners (hmo_id, company_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [hmoId, companyId]);
    return { ok: true, message: 'Partner company added.' };
  },

  async remove_hmo_partner(input, auth) {
    const hmoId = toInt(input.hmo_id);
    const companyId = toInt(input.company_id);
    await requireCompanyAccess(auth, hmoId);
    await exec('DELETE FROM hmo_partners WHERE hmo_id = ? AND company_id = ?', [hmoId, companyId]);
    return { ok: true, message: 'Partner company removed.' };
  },

  // ---------------------------------------------------------------- BRANCH SITES
  // Other branches (for example Demic Jaro) run as their own separate copy of this app with their own
  // database. This list only holds their names and links so Admin / Executive can jump to them.
  async get_branch_sites(input, auth) {
    if (!auth.isAdmin() && !auth.isExecutive()) jsonExit({ ok: false, error: 'Only an admin or executive can see branches.' }, 403);
    let list = [];
    try { list = JSON.parse(await getSetting('branch_sites', '[]')) || []; } catch { list = []; }
    return { ok: true, data: Array.isArray(list) ? list : [] };
  },

  async save_branch_sites(input, auth) {
    if (!auth.isAdmin() && !auth.isExecutive()) jsonExit({ ok: false, error: 'Only an admin or executive can change branches.' }, 403);
    const raw = Array.isArray(input.sites) ? input.sites : [];
    if (raw.length > 30) jsonExit({ ok: false, error: 'Too many branches (limit 30).' }, 400);
    const sites = [];
    for (const s of raw) {
      const name = trim(s?.name ?? '').slice(0, 80);
      let url = trim(s?.url ?? '').slice(0, 300);
      const note = trim(s?.note ?? '').slice(0, 200);
      if (!name) jsonExit({ ok: false, error: 'Every branch needs a name.' }, 400);
      if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
      if (url && !/^https?:\/\/[^\s/]+\.[^\s/]+/i.test(url)) jsonExit({ ok: false, error: `The link for "${name}" does not look right.` }, 400);
      sites.push({ name, url, note });
    }
    await setSetting('branch_sites', JSON.stringify(sites));
    return { ok: true, data: sites, message: 'Branches saved.' };
  },

  async get_settings() {
    return { ok: true, data: {
      aging_grace_enabled: await agingGraceEnabled(),
      aging_grace_days: await agingGraceSavedDays(),
      tax_withheld_percent: await taxWithheldPercent(),
      auto_covered_period_enabled: await autoCoveredPeriodEnabled(),
      covered_period_rules: await coveredPeriodRules(),
      covered_period_default_rules: DEFAULT_COVERED_RULES,
    } };
  },

  async save_aging_setting(input, auth) {
    if (!auth.isAdmin()) jsonExit({ ok: false, error: 'Only an admin can change settings.' }, 403);
    const enabled = truthy(input.aging_grace_enabled);
    const days = Math.max(0, toInt(input.aging_grace_days));
    if (enabled && days < 1) jsonExit({ ok: false, error: 'Enter at least 1 grace day, or switch the grace period off.' }, 400);
    await setSetting('aging_grace_enabled', enabled ? '1' : '0');
    await setSetting('aging_grace_days', String(days));
    return {
      ok: true,
      message: enabled
        ? `Grace period ON: aging starts ${days} day${days === 1 ? '' : 's'} after the billing date.`
        : 'Grace period OFF: aging counts from the billing date.',
    };
  },

  async save_covered_period_setting(input, auth) {
    if (!auth.isAdmin()) jsonExit({ ok: false, error: 'Only an admin can change settings.' }, 403);
    const enabled = truthy(input.auto_covered_period);
    await setSetting('auto_covered_period', enabled ? '1' : '0');
    return {
      ok: true,
      message: enabled
        ? 'Automatic covered period ON: it follows the billing date.'
        : 'Automatic covered period OFF: enter the covered period yourself.',
    };
  },

  async save_covered_period_rules(input, auth) {
    if (!auth.isAdmin()) jsonExit({ ok: false, error: 'Only an admin can change settings.' }, 403);
    let rules;
    try { rules = normalizeCoveredRules(input.rules); } catch (e) { jsonExit({ ok: false, error: e.message }, 400); }
    await setSetting('covered_period_rules', JSON.stringify(rules));
    return { ok: true, message: `Covered-period rules saved (${rules.length} rule${rules.length === 1 ? '' : 's'}).` };
  },

  async save_tax_setting(input, auth) {
    let percent = isSet(input.tax_withheld_percent) ? toFloat(input.tax_withheld_percent) : 2;
    percent = Math.max(0, Math.min(100, percent));
    await setSetting('tax_withheld_percent', String(percent));

    let recalcCount = 0;
    const cid = isSet(input.company_id) ? toInt(input.company_id) : null;
    if (truthy(input.recalc_existing) && cid && (await canAccessCompany(auth, cid))) {
      const recalcIsCharge = (await scalar('SELECT account_type FROM companies WHERE id = ?', [cid])) === 'CHARGE';
      const rows = await all('SELECT id, amount, surcharge, rebate, paid_amount, receivable_amount FROM ledger_entries WHERE company_id = ?', [cid]);
      for (const r of rows) {
        const amount = toFloat(r.amount);
        const tax = recalcIsCharge ? 0 : round((amount * percent) / 100, 2);
        const receivable = amount - tax + toFloat(r.surcharge) - toFloat(r.rebate);
        let paid = toFloat(r.paid_amount);
        if (Math.abs(paid - toFloat(r.receivable_amount)) < 0.01) paid = receivable;
        const balance = Math.max(0, round(receivable - paid, 2));
        await exec(
          "UPDATE ledger_entries SET tax_withheld = ?, receivable_amount = ?, paid_amount = ?, balance = ?, updated_at = (now() AT TIME ZONE 'Asia/Manila') WHERE id = ?",
          [tax, receivable, paid, balance, r.id]
        );
        if (await paymentsEnabled()) await mirrorRowToPayments(r.id);
        recalcCount++;
      }
    }
    let msg = `Tax withheld auto-fill now set to ${percent}%.`;
    if (recalcCount > 0) msg += ` Recalculated ${recalcCount} existing entr${recalcCount === 1 ? 'y' : 'ies'} for this company.`;
    return { ok: true, message: msg };
  },

  // ---------------------------------------------------------------- AGING REPORT
  async get_aging(input, auth, query) {
    const [rangeFrom, rangeTo] = agingRangeFromRequest(query);
    const [bw, bp] = branchWhere(auth, 'c');
    const rows = await all(
      `SELECT l.*, c.name as company_name, c.status as company_status
       FROM ledger_entries l JOIN companies c ON c.id = l.company_id
       WHERE l.balance > 0.009 ${bw}
       ORDER BY UPPER(c.name) COLLATE "C" ASC, UPPER(l.billing_date) COLLATE "C" ASC NULLS FIRST, l.id ASC`, bp);
    const due = await makeImplicitDue();

    const labels = ['Not Yet Due', '0-30 days', '31-60 days', '61-90 days', 'Over 90 days', 'N/A'];
    const buckets = Object.fromEntries(labels.map((l) => [l, { count: 0, total: 0 }]));
    const byCompany = new Map();

    for (const r of rows) {
      const days = daysOverdue(dueOf(r, due));
      if (!agingInRange(days, rangeFrom, rangeTo)) continue;
      const bucket = agingBucket(days);
      const bal = toFloat(r.balance);
      buckets[bucket].count++;
      buckets[bucket].total += bal;
      if (!byCompany.has(r.company_name)) {
        byCompany.set(r.company_name, { ...Object.fromEntries(labels.map((l) => [l, 0])), total: 0 });
      }
      const c = byCompany.get(r.company_name);
      c[bucket] += bal;
      c.total += bal;
    }
    const byCompanyList = [...byCompany.entries()]
      .map(([company, b]) => ({ company, ...b }))
      .sort((a, b) => b.total - a.total);

    return { ok: true, data: {
      grace_days: await agingGraceDays(),
      range: { from: rangeFrom, to: rangeTo },
      buckets,
      by_company: byCompanyList,
    } };
  },

  // ---------------------------------------------------------------- PAST DUE
  async get_past_due(input, auth) {
    const [bw, bp] = branchWhere(auth, 'c');
    const rows = await all(
      `SELECT l.*, c.name as company_name, c.status as company_status
       FROM ledger_entries l JOIN companies c ON c.id = l.company_id
       WHERE l.balance > 0.009 ${bw}
       ORDER BY UPPER(l.billing_date) COLLATE "C" ASC NULLS FIRST, l.id ASC`, bp);
    const due = await makeImplicitDue();

    const pastDue = [];
    const byCompany = {};
    for (const r of rows) {
      const dueDate = dueOf(r, due);
      const d = daysOverdue(dueDate);
      if (d !== null && d > 0) {
        r.due = dueDate;
        r.days = d;
        pastDue.push(r);
        byCompany[r.company_name] = (byCompany[r.company_name] ?? 0) + toFloat(r.balance);
      }
    }
    pastDue.sort((a, b) => b.days - a.days);
    const sortedByCompany = Object.fromEntries(Object.entries(byCompany).sort((a, b) => b[1] - a[1]));

    return { ok: true, data: {
      entries: pastDue,
      total: sum(pastDue, 'balance'),
      by_company: Object.keys(sortedByCompany).length ? sortedByCompany : [],
    } };
  },

  // ---------------------------------------------------------------- REPORTS BY MONTH
  async get_monthly_report(input, auth) {
    return { ok: true, data: await buildMonthlyReport(auth, input) };
  },

  // ---------------------------------------------------------------- SOA TRACKER
  async get_soa_tracker(input, auth) {
    const prefix = elvis(trim(input.prefix ?? 'SN-C'), 'SN-C');
    const suggested = await nextSoaNumber(prefix);
    const [bw, bp] = branchWhere(auth, 'c');
    const entries = await all(
      `SELECT t.*, c.name as company_name,
         (SELECT COUNT(*) FROM ledger_entries l WHERE UPPER(l.soa_number) = UPPER(t.soa_number)) AS share_count
       FROM soa_tracker t LEFT JOIN companies c ON c.id = t.company_id
       WHERE 1=1 ${bw}
       ORDER BY t.issued_date DESC NULLS LAST, t.id DESC`, bp);
    return { ok: true, data: { entries, suggested, prefix } };
  },

  async soa_generate(input, auth) {
    const companyId = elvis(toInt(input.company_id), null);
    if (companyId) await requireCompanyAccess(auth, companyId);
    const soa = trim(input.soa_number ?? '').toUpperCase();
    if (soa === '') jsonExit({ ok: false, error: 'SOA number is required.' }, 400);
    if (await soaNumberConflicts(soa)) jsonExit({ ok: false, error: `SOA number "${soa}" is already in use.` }, 409);
    const status = (input.status ?? 'UNUSED') === 'USED' ? 'USED' : 'UNUSED';

    const existingId = await scalar("SELECT id FROM soa_tracker WHERE UPPER(soa_number) = ? AND status <> 'USED' ORDER BY id LIMIT 1", [soa]);
    if (existingId) {
      await exec('UPDATE soa_tracker SET company_id = ?, status = ? WHERE id = ?', [companyId, status, existingId]);
    } else {
      await exec('INSERT INTO soa_tracker (soa_number, company_id, status) VALUES (?, ?, ?)', [soa, companyId, status]);
    }
    return { ok: true, message: `Saved SOA number: ${soa}` };
  },

  async soa_update_entry(input, auth) {
    const entryId = toInt(input.id);
    const companyId = elvis(toInt(input.company_id), null);
    if (companyId) await requireCompanyAccess(auth, companyId);
    const soa = trim(input.soa_number ?? '').toUpperCase();
    if (soa === '') jsonExit({ ok: false, error: 'SOA number is required.' }, 400);
    if (await soaNumberConflicts(soa, null, entryId)) jsonExit({ ok: false, error: `SOA number "${soa}" is already in use.` }, 409);
    const status = (input.status ?? 'UNUSED') === 'USED' ? 'USED' : 'UNUSED';
    let issued = trim(input.issued_date ?? '');
    issued = issued !== '' ? issued.replace(/T/g, ' ') + ':00' : null;

    if (issued) {
      await exec('UPDATE soa_tracker SET soa_number = ?, company_id = ?, status = ?, issued_date = ? WHERE id = ?', [soa, companyId, status, issued, entryId]);
    } else {
      await exec('UPDATE soa_tracker SET soa_number = ?, company_id = ?, status = ? WHERE id = ?', [soa, companyId, status, entryId]);
    }
    return { ok: true, message: 'SOA entry updated.' };
  },

  // Delete an SOA number from the tracker (even one marked USED), so it can be issued again.
  // If it is attached to a ledger entry and clear_ledger is set, that entry's SOA # is cleared too
  // (the entry and its amounts stay) -- otherwise the ledger entry would keep holding the number.
  async soa_delete(input, auth) {
    const id = toInt(input.id);
    const row = await one('SELECT id, soa_number, company_id, ledger_entry_id FROM soa_tracker WHERE id = ?', [id]);
    if (!row) jsonExit({ ok: false, error: 'SOA entry not found.' }, 404);
    if (row.company_id) await requireCompanyAccess(auth, toInt(row.company_id));
    let cleared = false;
    if (truthy(input.clear_ledger)) {
      // every ledger entry using this number (more than one when two payments share it)
      const users = await all('SELECT id, company_id FROM ledger_entries WHERE UPPER(soa_number) = UPPER(?)', [row.soa_number]);
      for (const e of users) {
        await requireCompanyAccess(auth, toInt(e.company_id));
        await exec(`UPDATE ledger_entries SET soa_number = NULL, updated_at=(now() AT TIME ZONE 'Asia/Manila') WHERE id = ?`, [toInt(e.id)]);
        cleared = true;
      }
    }
    await exec('DELETE FROM soa_tracker WHERE id = ?', [id]);
    return { ok: true, message: `SOA number ${row.soa_number} deleted${cleared ? ' and removed from its ledger entry' : ''}.` };
  },

  async soa_check(input) {
    const number = trim(input.number ?? '').toUpperCase();
    if (number === '') return { ok: true, data: { tracker: [], ledger: [] } };
    const tracker = await all('SELECT t.*, c.name as company_name FROM soa_tracker t LEFT JOIN companies c ON c.id = t.company_id WHERE UPPER(t.soa_number) = ?', [number]);
    const ledger = await all('SELECT l.*, c.name as company_name FROM ledger_entries l JOIN companies c ON c.id = l.company_id WHERE UPPER(l.soa_number) = ?', [number]);
    return { ok: true, data: { tracker, ledger } };
  },

  // ---------------------------------------------------------------- USERS (admin only)
  // Admins create and manage Staff accounts. Admin / branch / executive accounts
  // are listed for reference but can't be edited or deleted from here.
  async get_users(input, auth) {
    if (!auth.isAdmin() && !auth.isExecutive()) jsonExit({ ok: false, error: 'Only an admin or executive can manage users.' }, 403);
    const data = await all('SELECT id, username, full_name, role, created_at FROM users ORDER BY (role = \'staff\') DESC, UPPER(username) COLLATE "C" ASC');
    return { ok: true, data };
  },

  async create_user(input, auth) {
    if (!auth.isAdmin() && !auth.isExecutive()) jsonExit({ ok: false, error: 'Only an admin or executive can manage users.' }, 403);
    const username = trim(input.username ?? '');
    const password = String(input.password ?? '');
    const fullName = elvis(trim(input.full_name ?? ''), username);
    const role = ['admin', 'accounting'].includes(input.role) ? input.role : 'staff'; // admins and executives may add Admin, Accounting or Staff accounts
    if (!/^[A-Za-z0-9._-]{3,50}$/.test(username)) {
      jsonExit({ ok: false, error: 'Username must be 3-50 characters: letters, numbers, dot, dash or underscore.' }, 400);
    }
    if (password.length < 6) jsonExit({ ok: false, error: 'Password must be at least 6 characters.' }, 400);
    if (await scalar('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [username])) {
      jsonExit({ ok: false, error: `The username "${username}" is already taken.` }, 409);
    }
    const hash = await bcrypt.hash(password, 10);
    const id = await insertId('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)', [username, hash, fullName, role]);
    return { ok: true, id, message: `${role === 'admin' ? 'Admin' : role === 'accounting' ? 'Accounting' : 'Staff'} account "${username}" created.` };
  },

  async update_user(input, auth) {
    if (!auth.isAdmin() && !auth.isExecutive()) jsonExit({ ok: false, error: 'Only an admin or executive can manage users.' }, 403);
    const id = toInt(input.id);
    const row = await one('SELECT id, username, role FROM users WHERE id = ?', [id]);
    if (!row) jsonExit({ ok: false, error: 'User not found.' }, 404);
    if (!['staff', 'accounting'].includes(row.role)) jsonExit({ ok: false, error: 'Only Staff and Accounting accounts can be edited here.' }, 403);
    const fullName = elvis(trim(input.full_name ?? ''), row.username);
    const password = String(input.password ?? '');
    if (password !== '') {
      if (password.length < 6) jsonExit({ ok: false, error: 'Password must be at least 6 characters.' }, 400);
      await exec('UPDATE users SET full_name = ?, password_hash = ? WHERE id = ?', [fullName, await bcrypt.hash(password, 10), id]);
    } else {
      await exec('UPDATE users SET full_name = ? WHERE id = ?', [fullName, id]);
    }
    return { ok: true, message: `Account "${row.username}" updated.` };
  },

  async delete_user(input, auth) {
    if (!auth.isAdmin() && !auth.isExecutive()) jsonExit({ ok: false, error: 'Only an admin or executive can manage users.' }, 403);
    const id = toInt(input.id);
    const row = await one('SELECT id, username, role FROM users WHERE id = ?', [id]);
    if (!row) jsonExit({ ok: false, error: 'User not found.' }, 404);
    if (!['staff', 'accounting'].includes(row.role)) jsonExit({ ok: false, error: 'Only Staff and Accounting accounts can be deleted here.' }, 403);
    await exec('DELETE FROM users WHERE id = ?', [id]);
    return { ok: true, message: `Account "${row.username}" deleted.` };
  },

  // Which sidebar pages each role may open. Only Admin and Executive can read / change it.
  async get_nav_access(input, auth) {
    if (!auth.isAdmin() && !auth.isExecutive()) jsonExit({ ok: false, error: 'Only an admin or executive can change sidebar access.' }, 403);
    return { ok: true, data: { access: await getNavAccess(), base: NAV_BASE, pages: NAV_PAGES } };
  },

  async save_nav_access(input, auth) {
    if (!auth.isAdmin() && !auth.isExecutive()) jsonExit({ ok: false, error: 'Only an admin or executive can change sidebar access.' }, 403);
    const raw = input.access && typeof input.access === 'object' ? input.access : {};
    const clean = {};
    for (const role of Object.keys(NAV_BASE)) {
      const want = Array.isArray(raw[role]) ? raw[role] : NAV_BASE[role].filter((p) => !NAV_DEFAULT_OFF.includes(p));
      clean[role] = NAV_BASE[role].filter((p) => p === '/' || want.includes(p));
    }
    await setSetting('nav_access', JSON.stringify(clean));
    return { ok: true, data: { access: await getNavAccess() }, message: 'Sidebar access saved.' };
  },

  // ---------------------------------------------------------------- MONITORING
  async get_monitoring(input, auth) {
    const [bw, bp] = branchWhere(auth, 'c');
    const data = await all(
      `SELECT m.*, c.name as company_name FROM monitoring_entries m
       JOIN companies c ON c.id = m.company_id
       WHERE 1=1 ${bw}
       ORDER BY UPPER(m.due_date) COLLATE "C" ASC NULLS FIRST, m.id DESC`, bp);
    return { ok: true, data };
  },

  async create_monitoring(input, auth) { return saveMonitoring(input, auth, 'create_monitoring'); },
  async update_monitoring(input, auth) { return saveMonitoring(input, auth, 'update_monitoring'); },

  async delete_monitoring(input, auth) {
    const id = toInt(input.id);
    const cid = await scalar('SELECT company_id FROM monitoring_entries WHERE id=?', [id]);
    if (!cid) jsonExit({ ok: false, error: 'Not found.' }, 404);
    await requireCompanyAccess(auth, toInt(cid));
    await exec('DELETE FROM monitoring_entries WHERE id=?', [id]);
    return { ok: true, message: 'Monitoring entry deleted.' };
  },

  // ---------------------------------------------------------------- RUNNING PAYABLES
  async get_payables(input, auth) {
    await requirePayablesAdmin(auth, '/payables/running', '/payables/record', '/payables/titles');
    await ensurePayablesTable();
    const data = await all(
      `SELECT id, check_date::text AS check_date, payee, category, title_name, amount, status, release_status, cleared_at::text AS cleared_at, note
       FROM running_payables
       ORDER BY (status = 'Unpaid') DESC, check_date DESC NULLS LAST, id DESC`);
    return { ok: true, data, categories: await getAccountTitles(), title_names: await getTitleNames() };
  },

  async save_payable(input, auth) {
    await requirePayablesAdmin(auth, '/payables/running');
    await ensurePayablesTable();
    const payee = trim(input.payee ?? '').slice(0, 200);
    if (!payee) jsonExit({ ok: false, error: 'Enter the payee name.' }, 400);
    const amount = toFloat(input.amount);
    if (!(amount > 0)) jsonExit({ ok: false, error: 'Enter an amount greater than zero.' }, 400);
    const category = cleanTitle(input.category) || 'Other';
    const titleName = elvis(trim(input.title_name ?? '').replace(/\s+/g, ' ').slice(0, 120), null);
    const status = input.status === 'Paid' ? 'Paid' : 'Unpaid';
    // only a Paid item can be Released
    const release = status === 'Paid' && input.release_status === 'Released' ? 'Released' : 'Pending Release';
    const checkDate = /^\d{4}-\d{2}-\d{2}$/.test(String(input.check_date ?? '')) ? input.check_date : null;
    const note = elvis(trim(input.note ?? '').slice(0, 300), null);
    const id = toInt(input.id);
    if (id) {
      const n = await exec(
        `UPDATE running_payables SET check_date=?, payee=?, category=?, title_name=?, amount=?, status=?,
           cleared_at = CASE WHEN release_status = '${release}' AND '${release}' = 'Released' THEN cleared_at ELSE NULL END,
           release_status=?, note=?, updated_at=NOW() WHERE id=?`,
        [checkDate, payee, category, titleName, amount, status, release, note, id]);
      if (!n) jsonExit({ ok: false, error: 'Not found.' }, 404);
      return { ok: true, id, message: 'Payable updated.' };
    }
    const newId = await insertId(
      'INSERT INTO running_payables (check_date, payee, category, title_name, amount, status, release_status, note) VALUES (?,?,?,?,?,?,?,?)',
      [checkDate, payee, category, titleName, amount, status, release, note]);
    return { ok: true, id: newId, message: 'Payable added.' };
  },

  // ---------------------------------------------------------------- MAIN (cash fund)
  async get_main_fund(input, auth) {
    await requirePayablesAdmin(auth, '/payables/main');
    await ensurePayablesTable();
    const [row] = await all("SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS n FROM running_payables WHERE status = 'Unpaid'");
    // paid + released + not yet cleared payables show up in Released Check Monitoring automatically
    const released = await all(
      `SELECT id, check_date::text AS check_date, payee, category, title_name, amount
       FROM running_payables
       WHERE status = 'Paid' AND release_status = 'Released' AND cleared_at IS NULL
       ORDER BY check_date DESC NULLS LAST, id DESC`);
    return { ok: true, data: await getMainFund(), running_payables: toFloat(row?.total), running_count: toInt(row?.n),
      released_payables: released.map((r) => ({ ...r, amount: toFloat(r.amount) })) };
  },

  async save_main_fund(input, auth) {
    await requirePayablesAdmin(auth, '/payables/main');
    const data = cleanMainFund(input.data);
    data.updated_at = todayYmd();
    await setSetting('main_fund', JSON.stringify(data));
    return { ok: true, data };
  },

  // ---------------------------------------------------------------- CASH POSITION
  async get_cash_position(input, auth) {
    await requirePayablesAdmin(auth, '/payables/cash-position');
    await ensurePayablesTable();
    const [bw, bp] = branchWhere(auth, 'c');
    // receivables, split with the same due rule as Reports by Month: its own Due Date, else Period Date + 3 months
    const rows = await all(`SELECT l.balance, l.period_date, l.due_date FROM ledger_entries l JOIN companies c ON c.id = l.company_id WHERE l.balance > 0.009 ${bw}`, bp);
    const nowKey = currentMonthKey();
    const rec = { due: 0, due_count: 0, not_yet: 0, not_yet_count: 0, unplaced: 0, unplaced_count: 0 };
    for (const r of rows) {
      const bal = toFloat(r.balance);
      const pk = monthKey(r.period_date);
      const dueKey = r.due_date ? monthKey(r.due_date) : (pk ? addMonthsKey(pk, DEFAULT_TERMS_MONTHS) : null);
      if (!dueKey) { rec.unplaced += bal; rec.unplaced_count++; rec.not_yet += bal; rec.not_yet_count++; continue; }
      if (dueKey <= nowKey) { rec.due += bal; rec.due_count++; } else { rec.not_yet += bal; rec.not_yet_count++; }
    }
    const [row] = await all("SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS n FROM running_payables WHERE status = 'Unpaid'");
    const released = await all(
      `SELECT id, payee, amount FROM running_payables WHERE status = 'Paid' AND release_status = 'Released' AND cleared_at IS NULL`);
    return { ok: true, as_of: todayYmd(), receivables: rec, main: await getMainFund(), future: (await getCashPositionSettings()).future,
      running_payables: toFloat(row?.total), running_count: toInt(row?.n),
      released_payables: released.map((r) => ({ id: toInt(r.id), payee: r.payee, amount: toFloat(r.amount) })) };
  },

  async save_cash_position(input, auth) {
    await requirePayablesAdmin(auth, '/payables/cash-position');
    const future = cleanFuture(input.future);
    await setSetting('cash_position', JSON.stringify({ future }));
    return { ok: true, future };
  },

  async save_account_titles(input, auth) {
    await requirePayablesAdmin(auth, '/payables/titles');
    const seen = new Set();
    const titles = [];
    for (const t of Array.isArray(input.titles) ? input.titles : []) {
      const name = cleanTitle(t);
      if (name && !seen.has(name.toLowerCase())) { seen.add(name.toLowerCase()); titles.push(name); }
    }
    if (!titles.length) jsonExit({ ok: false, error: 'Keep at least one account title.' }, 400);
    if (titles.length > 60) jsonExit({ ok: false, error: 'Too many account titles (limit 60).' }, 400);
    // names under each title (only for titles that still exist)
    const names = {};
    const given = input.names && typeof input.names === 'object' ? input.names : {};
    for (const t of titles) {
      const seenN = new Set();
      const list = [];
      for (const n of Array.isArray(given[t]) ? given[t] : []) {
        const nm = trim(n ?? '').replace(/\s+/g, ' ').slice(0, 120);
        if (nm && !seenN.has(nm.toLowerCase())) { seenN.add(nm.toLowerCase()); list.push(nm); }
      }
      if (list.length > 300) jsonExit({ ok: false, error: `Too many names under "${t}" (limit 300).` }, 400);
      if (list.length) names[t] = list;
    }
    await setSetting('payable_account_titles', JSON.stringify(titles));
    await setSetting('payable_title_names', JSON.stringify(names));
    return { ok: true, data: titles, names, message: 'Account titles saved.' };
  },

  async add_payables_bulk(input, auth) {
    await requirePayablesAdmin(auth, '/payables/record');
    await ensurePayablesTable();
    const raw = Array.isArray(input.items) ? input.items : [];
    if (!raw.length) jsonExit({ ok: false, error: 'Add at least one payable.' }, 400);
    if (raw.length > 100) jsonExit({ ok: false, error: 'Too many rows at once (limit 100).' }, 400);
    const items = raw.map((it, i) => {
      const payee = trim(it?.payee ?? '').slice(0, 200);
      const amount = toFloat(it?.amount);
      if (!payee) jsonExit({ ok: false, error: `Row ${i + 1}: enter the payee name.` }, 400);
      if (!(amount > 0)) jsonExit({ ok: false, error: `Row ${i + 1}: enter an amount greater than zero.` }, 400);
      return [
        /^\d{4}-\d{2}-\d{2}$/.test(String(it?.check_date ?? '')) ? it.check_date : null,
        payee,
        cleanTitle(it?.category) || 'Other',
        elvis(trim(it?.title_name ?? '').replace(/\s+/g, ' ').slice(0, 120), null),
        amount,
        it?.status === 'Paid' ? 'Paid' : 'Unpaid',
        elvis(trim(it?.note ?? '').slice(0, 300), null),
      ];
    });
    await transaction(async (client) => {
      for (const v of items) {
        await exec('INSERT INTO running_payables (check_date, payee, category, title_name, amount, status, note) VALUES (?,?,?,?,?,?,?)', v, client);
      }
    });
    return { ok: true, count: items.length, message: `${items.length} ${items.length === 1 ? 'payable' : 'payables'} added to Running Payables.` };
  },

  async set_payable_status(input, auth) {
    await requirePayablesAdmin(auth, '/payables/running');
    await ensurePayablesTable();
    const status = input.status === 'Paid' ? 'Paid' : 'Unpaid';
    const n = await exec("UPDATE running_payables SET status=?, release_status = CASE WHEN ? = 'Paid' THEN release_status ELSE 'Pending Release' END, cleared_at = CASE WHEN ? = 'Paid' THEN cleared_at ELSE NULL END, updated_at=NOW() WHERE id=?", [status, status, status, toInt(input.id)]);
    if (!n) jsonExit({ ok: false, error: 'Not found.' }, 404);
    return { ok: true, message: `Marked ${status}.` };
  },

  // Check release status (Pending Release | Released). Only a Paid payable can be Released; marking the same one again changes nothing.
  async set_payable_release(input, auth) {
    await requirePayablesAdmin(auth, '/payables/running');
    await ensurePayablesTable();
    const id = toInt(input.id);
    const released = input.release_status === 'Released';
    const [row] = await all('SELECT status, release_status FROM running_payables WHERE id = ?', [id]);
    if (!row) jsonExit({ ok: false, error: 'Not found.' }, 404);
    if (released && row.status !== 'Paid') jsonExit({ ok: false, error: 'Mark it Paid first. Only a paid check can be released.' }, 400);
    if (released && row.release_status === 'Released') return { ok: true, message: 'Already released.' };
    await exec('UPDATE running_payables SET release_status=?, cleared_at=NULL, updated_at=NOW() WHERE id=?', [released ? 'Released' : 'Pending Release', id]);
    return { ok: true, message: released ? 'Marked Released. It now shows in Main under Released Check Monitoring.' : 'Marked Pending Release.' };
  },

  // Bank cleared a released check: it leaves Released Check Monitoring in Main (the payable keeps its Released status).
  async clear_released_payable(input, auth) {
    await requirePayablesAdmin(auth, '/payables/main');
    await ensurePayablesTable();
    const n = await exec("UPDATE running_payables SET cleared_at = NOW() WHERE id = ? AND status = 'Paid' AND release_status = 'Released' AND cleared_at IS NULL", [toInt(input.id)]);
    return { ok: true, message: n ? 'Marked cleared. Removed from Released Check Monitoring.' : 'Already cleared.' };
  },

  async delete_payable(input, auth) {
    await requirePayablesAdmin(auth, '/payables/running');
    await ensurePayablesTable();
    await exec('DELETE FROM running_payables WHERE id=?', [toInt(input.id)]);
    return { ok: true, message: 'Payable deleted.' };
  },
};

async function saveCompany(input, auth, action) {
  const name = trim(input.name ?? '');
  const code = trim(input.code ?? '');
  const status = STATUSES.includes(input.status ?? '') ? input.status : 'ACTIVE';
  const accountType = ['HMO', 'CHARGE'].includes(input.account_type) ? input.account_type : 'COMPANY'; // CHARGE = "Charge to company" ledger (same name as an HMO is allowed)
  const contact = trim(input.contact_person ?? '');
  const number = trim(input.contact_number ?? '');
  const email = trim(input.email_address ?? '');
  const remarks = trim(input.remarks ?? '');
  const branch = (auth.isAdmin() || auth.isAccounting()) ? elvis(trim(input.branch ?? ''), null) : auth.branch();

  if (name === '') jsonExit({ ok: false, error: 'Company name is required.' }, 400);

  // Each HMO account is linked to ONE company (the company it bills). Only an
  // HMO can have a linked company, and it must be a real COMPANY account.
  let linkedId = toInt(input.linked_company_id) || null;
  if (accountType !== 'HMO') linkedId = null;
  if (linkedId) {
    const target = await scalar(`SELECT account_type FROM companies WHERE id=?`, [linkedId]);
    if (target !== 'COMPANY' || linkedId === toInt(input.id)) {
      jsonExit({ ok: false, error: 'Please choose a valid company to link this HMO to.' }, 400);
    }
  }

  try {
    if (action === 'create_company') {
      const id = await insertId(
        'INSERT INTO companies (name, code, status, account_type, linked_company_id, branch, contact_person, contact_number, email_address, remarks) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [name, code, status, accountType, linkedId, branch, contact, number, email, remarks]
      );
      return { ok: true, id, message: `Company "${name}" added.` };
    }
    const editId = toInt(input.id);
    await requireCompanyAccess(auth, editId);
    await exec(
      'UPDATE companies SET name=?, code=?, status=?, account_type=?, linked_company_id=?, branch=?, contact_person=?, contact_number=?, email_address=?, remarks=? WHERE id=?',
      [name, code, status, accountType, linkedId, branch, contact, number, email, remarks, editId]
    );
    await syncLedgerCompanyNames();
    return { ok: true, message: `Company "${name}" updated.` };
  } catch (e) {
    if (e?.code === '23505') {
      jsonExit({ ok: false, error: `A company named "${name}" already exists.` }, 409);
    }
    throw e;
  }
}

async function saveMonitoring(input, auth, action) {
  const cId = toInt(input.company_id);
  await requireCompanyAccess(auth, cId);
  const expected = elvis(input.expected_date ?? null, null);
  const amount = toFloat(input.amount);
  const remaining = toFloat(input.remaining_balance);
  const due = elvis(input.due_date ?? null, null);
  const remarks = elvis(trim(input.remarks ?? ''), null);

  if (action === 'create_monitoring') {
    const id = await insertId(
      'INSERT INTO monitoring_entries (company_id, expected_date, amount, remaining_balance, due_date, remarks) VALUES (?,?,?,?,?,?)',
      [cId, expected, amount, remaining, due, remarks]
    );
    return { ok: true, id, message: 'Monitoring entry added.' };
  }
  const editId = toInt(input.id);
  await exec(
    'UPDATE monitoring_entries SET company_id=?, expected_date=?, amount=?, remaining_balance=?, due_date=?, remarks=? WHERE id=?',
    [cId, expected, amount, remaining, due, remarks, editId]
  );
  return { ok: true, message: 'Monitoring entry updated.' };
}

// ======================================================================
// Entry point (used by api/app.js on Vercel and by dev-api.js locally)
// ======================================================================
export default async function handleApi(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  try {
    const query = getQuery(req);
    const body = await getJsonBody(req);
    const input = { ...query, ...body }; // like PHP array_merge($_GET, $body)
    const action = input.action ?? '';
    const user = readSession(req);
    // Every request from a logged-in person restarts the 30-minute idle clock.
    if (user && action !== 'logout') { const c = renewCookie(req); if (c) res.setHeader('Set-Cookie', c); }

    // ---- public (no login needed)
    if (action === 'login') {
      const u = await attemptLogin(trim(input.username ?? ''), String(input.password ?? ''));
      if (u) return sendJson(res, 200, { ok: true, user: await userPayload(u) }, { 'Set-Cookie': sessionCookie(req, u) });
      return sendJson(res, 401, { ok: false, error: 'Invalid username or password.' });
    }
    if (action === 'me') {
      // A deleted staff account must not stay logged in from an old cookie.
      if (['staff', 'accounting'].includes(user?.role) && (await scalar('SELECT COUNT(*) FROM users WHERE id = ? AND role = ?', [user.id, user.role])) === '0') {
        return sendJson(res, 200, { ok: true, user: null }, { 'Set-Cookie': clearCookie(req) });
      }
      return sendJson(res, 200, { ok: true, user: await userPayload(user) });
    }
    if (action === 'logout') return sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearCookie(req) });

    // ---- everything else needs a login
    if (!user) return sendJson(res, 401, { ok: false, error: 'Not logged in.' });

    if (user.role === 'executive' && !EXECUTIVE_ACTIONS.has(action)) {
      return sendJson(res, 403, { ok: false, error: 'Your account can view reports only.' });
    }
    // Staff: re-check the account still exists as Staff (so deleting a user locks them out at once),
    // then allow only the staff actions.
    if (user.role === 'staff') {
      const current = await one('SELECT role FROM users WHERE id = ?', [user.id]);
      if (!current || current.role !== 'staff') {
        return sendJson(res, 401, { ok: false, error: 'Not logged in.' }, { 'Set-Cookie': clearCookie(req) });
      }
      if (!STAFF_ACTIONS.has(action)) {
        return sendJson(res, 403, { ok: false, error: 'Your staff account cannot do that.' });
      }
    }
    // Accounting: re-check the account still exists (deleting it locks the person out at once).
    if (user.role === 'accounting') {
      const current = await one('SELECT role FROM users WHERE id = ?', [user.id]);
      if (!current || current.role !== 'accounting') {
        return sendJson(res, 401, { ok: false, error: 'Not logged in.' }, { 'Set-Cookie': clearCookie(req) });
      }
    }
    // The executive dashboard is for owner / accounting accounts only.
    if (action === 'get_exec_dashboard' && user.role !== 'executive' && user.role !== 'admin' && user.role !== 'accounting') {
      return sendJson(res, 403, { ok: false, error: 'Not available for this account.' });
    }

    const fn = typeof action === 'string' && Object.hasOwn(actions, action) ? actions[action] : null;
    if (!fn) return sendJson(res, 400, { ok: false, error: 'Unknown action: ' + action });

    const out = await fn(input, makeAuth(user), query);
    return sendJson(res, 200, out);
  } catch (e) {
    if (e instanceof HttpError) return sendJson(res, e.status, e.body);
    console.error(e);
    return sendJson(res, 500, { ok: false, error: 'Server error: ' + (e?.message || 'unknown') });
  }
}