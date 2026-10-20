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
  // "2026-all" = the "All months" view: the whole of that year (Jan - Dec) in one report
  const allYear = /^\d{4}-all$/.test(raw) ? Number(raw.slice(0, 4)) : null;
  const month = allYear ? `${allYear}-01` : /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : currentMonthKey();
  const terms = query.terms === undefined || query.terms === '' ? DEFAULT_TERMS_MONTHS : toInt(query.terms);
  return { month, terms: Math.max(0, Math.min(12, terms)), allYear };
}

export async function buildMonthlyReport(auth, query) {
  const { month, terms, allYear } = readMonthlyParams(query);
  const next = allYear ? `${allYear + 1}-01` : addMonthsKey(month, 1); // All months: "next" = everything after that year
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

  // The columns of the report: normally OVERDUE | this month | next month.
  // "All months": OVERDUE | January | ... | December | AFTER the year -- every month gets its own columns.
  const blockDefs = allYear
    ? [
      { key: 'overdue', title: `OVERDUE (BEFORE ${allYear})`, total: 'OVERDUE TOTAL', cls: 'rep-red' },
      ...Array.from({ length: 12 }, (_, i) => {
        const k = `${allYear}-${String(i + 1).padStart(2, '0')}`;
        return { key: `m${String(i + 1).padStart(2, '0')}`, title: `${monthName(k).toUpperCase()} ${allYear}`, total: `${monthName(k).toUpperCase()} TOTAL:`, cls: 'rep-blue' };
      }),
      { key: 'after', title: `AFTER ${allYear}`, total: `AFTER ${allYear} TOTAL:`, cls: 'rep-blue' },
    ]
    : [
      { key: 'overdue', title: 'OVERDUE', total: 'OVERDUE TOTAL', cls: 'rep-red' },
      { key: 'due1', title: `DUE FOR ${monthName(month).toUpperCase()} ${month.slice(0, 4)}`, total: `${monthName(month).toUpperCase()} DUE TOTAL:`, cls: 'rep-blue' },
      { key: 'due2', title: `DUE FOR ${monthName(next).toUpperCase()} ${next.slice(0, 4)}`, total: `${monthName(next).toUpperCase()} DUE TOTAL:`, cls: 'rep-blue' },
    ];
  const emptyBlocks = () => Object.fromEntries(blockDefs.map((d) => [d.key, []]));
  const companies = new Map();
  const totals = Object.fromEntries(blockDefs.map((d) => [d.key, 0]));
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
    if (allYear) {
      if (dueKey < month) block = 'overdue';           // due before the year starts
      else if (dueKey < next) block = `m${dueKey.slice(5, 7)}`; // its own month column, Jan - Dec
      else block = 'after';                            // due after the year
    } else if (dueKey < month) block = 'overdue';
    else if (dueKey === month) block = 'due1';
    else if (dueKey === next) block = 'due2';
    else { later.count++; later.total += balance; continue; }

    let c = companies.get(r.company_id);
    if (!c) {
      c = { company_id: toInt(r.company_id), company: r.company_name, ...emptyBlocks() };
      companies.set(r.company_id, c);
    }
    c[block].push({ id: toInt(r.id), soa_number: r.soa_number || '', period: periodLabel(r.period_date), balance });
    totals[block] += balance;
  }

  const titles = allYear
    ? { overdue: `OVERDUE (BEFORE ${allYear})`, due1: `DUE IN ${allYear} (JAN - DEC)`, due2: `DUE AFTER ${allYear}`,
      t_overdue: 'OVERDUE TOTAL', t_due1: `${allYear} DUE TOTAL:`, t_due2: `AFTER ${allYear} TOTAL:` }
    : { overdue: 'OVERDUE', due1: `DUE FOR ${monthName(month).toUpperCase()} ${month.slice(0, 4)}`, due2: `DUE FOR ${monthName(next).toUpperCase()} ${next.slice(0, 4)}`,
      t_overdue: 'OVERDUE TOTAL', t_due1: `${monthName(month).toUpperCase()} DUE TOTAL:`, t_due2: `${monthName(next).toUpperCase()} DUE TOTAL:` };

  return {
    all_year: allYear, titles, block_defs: blockDefs,
    month, next_month: next, terms,
    month_name: monthName(month), month_label: monthLabel(month),
    next_name: monthName(next), next_label: monthLabel(next),
    companies: [...companies.values()],
    totals,
    no_period: noPeriod,
    later,
  };
}