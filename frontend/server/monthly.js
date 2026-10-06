// "Reports by Month": every unpaid ledger entry, grouped by company, split into
//   OVERDUE | DUE FOR <month> | DUE FOR <next month>
// the same layout as the monthly Excel sheet.
//
// When is an entry due?
//   1. its own Due Date, if one was typed in; otherwise
//   2. its Period Date + the payment terms (default 3 months), e.g. a June
//      bill with 3-month terms is due in September.
// Entries due before the chosen month are OVERDUE.
import { all } from './db.js';
import { jsonExit } from './http.js';
import { toFloat, toInt } from './php.js';
import { parseDate, monthKey, currentMonthKey, addMonthsKey, monthLabel, monthName, periodLabel } from './dates.js';
import { branchWhere } from './lib.js';

export const DEFAULT_TERMS_MONTHS = 3;

/** Reads ?month=YYYY-MM and ?terms=N from the request, with safe defaults. */
export function readMonthlyParams(query) {
  const raw = String(query.month ?? '');
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : currentMonthKey();
  const terms = query.terms === undefined || query.terms === '' ? DEFAULT_TERMS_MONTHS : toInt(query.terms);
  return { month, terms: Math.max(0, Math.min(12, terms)) };
}

export async function buildMonthlyReport(auth, query) {
  const { month, terms } = readMonthlyParams(query);
  const next = addMonthsKey(month, 1);
  const [bw, bp] = branchWhere(auth, 'c');

  let rows;
  try {
    rows = await all(
      `SELECT l.id, l.company_id, l.soa_number, l.period_date, l.due_date, l.balance, c.name AS company_name
       FROM ledger_entries l JOIN companies c ON c.id = l.company_id
       WHERE l.balance > 0.009 ${bw}
       ORDER BY UPPER(c.name) COLLATE "C" ASC, l.period_date ASC NULLS LAST, UPPER(l.soa_number) COLLATE "C" ASC NULLS LAST, l.id ASC`, bp);
  } catch (e) {
    if (e?.code === '42703') { // undefined_column: the migration hasn't been run yet
      jsonExit({ ok: false, error: 'The database does not have the Period Date column yet. In Supabase, open SQL Editor and run database/add_period_date.sql once, then reload this page.' }, 500);
    }
    throw e;
  }

  const companies = new Map();
  const totals = { overdue: 0, due1: 0, due2: 0 };
  const noPeriod = { count: 0, total: 0 }; // open balances we can't place in a month
  const later = { count: 0, total: 0 };    // due after the two months shown

  for (const r of rows) {
    const balance = toFloat(r.balance);
    const periodKey = monthKey(r.period_date);
    const explicitDue = r.due_date ? parseDate(r.due_date) : null;
    let dueKey = null;
    if (explicitDue !== null) dueKey = monthKey(r.due_date);
    else if (periodKey) dueKey = addMonthsKey(periodKey, terms);

    if (!dueKey) { noPeriod.count++; noPeriod.total += balance; continue; }

    let block;
    if (dueKey < month) block = 'overdue';
    else if (dueKey === month) block = 'due1';
    else if (dueKey === next) block = 'due2';
    else { later.count++; later.total += balance; continue; }

    let c = companies.get(r.company_id);
    if (!c) {
      c = { company_id: toInt(r.company_id), company: r.company_name, overdue: [], due1: [], due2: [] };
      companies.set(r.company_id, c);
    }
    c[block].push({ id: toInt(r.id), soa_number: r.soa_number || '', period: periodLabel(r.period_date), balance });
    totals[block] += balance;
  }

  return {
    month, next_month: next, terms,
    month_name: monthName(month), month_label: monthLabel(month),
    next_name: monthName(next), next_label: monthLabel(next),
    companies: [...companies.values()],
    totals,
    no_period: noPeriod,
    later,
  };
}