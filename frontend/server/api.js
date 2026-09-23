// JSON API -- port of backend/api.php.
// Same actions, same request fields, same response shapes, so the React
// pages work unchanged. All requests hit /api.php?action=xxx (the
// vercel.json rewrite sends that path to this code).

import { all, one, scalar, exec, insertId } from './db.js';
import { HttpError, jsonExit, getQuery, getJsonBody, sendJson } from './http.js';
import { readSession, sessionCookie, clearCookie, attemptLogin, makeAuth } from './auth.js';
import { toInt, toFloat, trim, truthy, elvis, round } from './php.js';
import { todayYmd } from './dates.js';
import {
  daysOverdue, agingBucket, agingRangeFromRequest, agingInRange, makeImplicitDue, dueOf,
  agingGraceDays, taxWithheldPercent, setSetting, soaNumberConflicts, recordSoaNumberUsed,
  nextSoaNumber, branchWhere, branchWhereStandalone, canAccessCompany, syncLedgerCompanyNames,
} from './lib.js';

const PAYMENT_METHODS = ['Cash', 'Card', 'Check'];
const PAYMENT_BANKS = ['Metrobank', 'BPI', 'PBB', 'Maya', 'Other'];
const STATUSES = ['ACTIVE', 'INACTIVE', 'BANKRUPT'];

const isSet = (v) => v !== undefined && v !== null;
const sum = (rows, key) => rows.reduce((t, r) => t + toFloat(r[key]), 0);

function userPayload(u) {
  if (!u) return null;
  return { id: u.id, username: u.username, full_name: u.full_name, role: u.role, is_admin: u.role === 'admin' };
}

function recalcRow(d) {
  const amount = toFloat(d.amount);
  const tax = toFloat(d.tax_withheld);
  const surcharge = toFloat(d.surcharge);
  const rebate = toFloat(d.rebate);
  const paid = toFloat(d.paid_amount);
  const receivable = amount - tax + surcharge - rebate;
  const balance = amount - paid; // Balance = Amount - Paid
  return [receivable, balance];
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

  // ---------------------------------------------------------------- SUMMARY
  async get_summary(input, auth) {
    const companyId = isSet(input.company_id) && input.company_id !== '' ? toInt(input.company_id) : null;
    if (companyId) await requireCompanyAccess(auth, companyId);
    const bucketFilterMap = {
      not_yet_due: 'Not Yet Due', '0-30': '0-30 days', '31-60': '31-60 days', '61-90': '61-90 days', over90: 'Over 90 days',
    };
    let agingFilter = input.aging ?? '';
    if (typeof agingFilter !== 'string' || !Object.hasOwn(bucketFilterMap, agingFilter)) agingFilter = '';
    const showAll = truthy(input.show_all);
    const searchQuery = trim(input.q ?? '');

    let sql = 'SELECT l.*, c.name as company_name FROM ledger_entries l JOIN companies c ON c.id = l.company_id';
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
    if (auth.isAdmin()) {
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
    let sql = 'SELECT l.*, c.name as company_name, c.status as company_status FROM ledger_entries l JOIN companies c ON c.id = l.company_id';
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

    const agingTally = {};
    for (const r of entries) {
      if (toFloat(r.balance) <= 0) continue;
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
        `SELECT c.id, c.name, c.status, COUNT(l.id) as entry_count, COALESCE(SUM(l.balance),0) as outstanding
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
      aging_tally: Object.keys(agingTally).length ? agingTally : [],
      company_summary: companySummary,
    } };
  },

  async quick_add_ledger(input, auth) {
    const cid = toInt(input.company_id);
    await requireCompanyAccess(auth, cid);
    const cName = await scalar('SELECT name FROM companies WHERE id = ?', [cid]);
    const id = await insertId(
      `INSERT INTO ledger_entries (company_id, company_name, billing_date, amount, tax_withheld, surcharge, rebate, paid_amount, receivable_amount, balance)
       VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 0)`,
      [cid, cName || null, todayYmd()]
    );
    return { ok: true, id };
  },

  async inline_update_ledger(input, auth) {
    const allowed = ['billing_date', 'soa_number', 'amount', 'tax_withheld', 'surcharge', 'rebate',
      'payment_date', 'check_ref', 'check_date', 'paid_amount', 'due_date', 'remarks', 'deduction_remarks',
      'payment_method', 'payment_method_bank', 'payment_method_other'];
    const id = toInt(input.id);
    const field = input.field ?? '';
    let value = input.value ?? null;

    if (!id || !allowed.includes(field)) jsonExit({ ok: false, error: 'Invalid field.' }, 400);

    const row = await one('SELECT * FROM ledger_entries WHERE id = ?', [id]);
    if (!row) jsonExit({ ok: false, error: 'Entry not found.' }, 404);
    await requireCompanyAccess(auth, toInt(row.company_id));

    if (['amount', 'tax_withheld', 'surcharge', 'rebate', 'paid_amount'].includes(field)) {
      value = value === '' || value === null ? 0 : toFloat(value);
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

    if (field === 'soa_number' && value && (await soaNumberConflicts(value, id))) {
      jsonExit({ ok: false, error: `SOA number "${value}" is already in use. Add a letter like A or B for a supplementary copy, or use a different number.` }, 409);
    }

    row[field] = value;
    const [receivable, balance] = recalcRow(row);

    // `field` is checked against the allow-list above, so it's safe to put in the SQL.
    await exec(
      `UPDATE ledger_entries SET ${field} = ?, receivable_amount = ?, balance = ?, updated_at = (now() AT TIME ZONE 'Asia/Manila') WHERE id = ?`,
      [value, receivable, balance, id]
    );

    if (field === 'soa_number') {
      if (value) {
        await recordSoaNumberUsed(value, row.company_id, id);
      } else {
        await exec("UPDATE soa_tracker SET ledger_entry_id = NULL, status = 'UNUSED' WHERE ledger_entry_id = ?", [id]);
      }
    }

    const due = await makeImplicitDue();
    return {
      ok: true,
      receivable_amount: receivable,
      balance,
      deduction: balance,
      aging_bucket: agingBucket(daysOverdue(dueOf(row, due))),
    };
  },

  async delete_ledger(input, auth) {
    const id = toInt(input.id);
    const cid = await scalar('SELECT company_id FROM ledger_entries WHERE id=?', [id]);
    if (!cid) jsonExit({ ok: false, error: 'Entry not found.' }, 404);
    await requireCompanyAccess(auth, toInt(cid));
    await exec('DELETE FROM ledger_entries WHERE id=?', [id]);
    return { ok: true, message: 'Ledger entry deleted.' };
  },

  async get_settings() {
    return { ok: true, data: { aging_grace_days: await agingGraceDays(), tax_withheld_percent: await taxWithheldPercent() } };
  },

  async save_aging_setting(input) {
    const days = Math.max(0, toInt(input.aging_grace_days));
    await setSetting('aging_grace_days', String(days));
    return { ok: true, message: `Aging now starts ${days} day${days === 1 ? '' : 's'} after billing.` };
  },

  async save_tax_setting(input, auth) {
    let percent = isSet(input.tax_withheld_percent) ? toFloat(input.tax_withheld_percent) : 2;
    percent = Math.max(0, Math.min(100, percent));
    await setSetting('tax_withheld_percent', String(percent));

    let recalcCount = 0;
    const cid = isSet(input.company_id) ? toInt(input.company_id) : null;
    if (truthy(input.recalc_existing) && cid && (await canAccessCompany(auth, cid))) {
      const rows = await all('SELECT id, amount, surcharge, rebate, paid_amount, receivable_amount FROM ledger_entries WHERE company_id = ?', [cid]);
      for (const r of rows) {
        const amount = toFloat(r.amount);
        const tax = round((amount * percent) / 100, 2);
        const receivable = amount - tax + toFloat(r.surcharge) - toFloat(r.rebate);
        let paid = toFloat(r.paid_amount);
        if (Math.abs(paid - toFloat(r.receivable_amount)) < 0.01) paid = receivable;
        const balance = amount - paid;
        await exec(
          "UPDATE ledger_entries SET tax_withheld = ?, receivable_amount = ?, paid_amount = ?, balance = ?, updated_at = (now() AT TIME ZONE 'Asia/Manila') WHERE id = ?",
          [tax, receivable, paid, balance, r.id]
        );
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

  // ---------------------------------------------------------------- SOA TRACKER
  async get_soa_tracker(input, auth) {
    const prefix = elvis(trim(input.prefix ?? 'SN-C'), 'SN-C');
    const suggested = await nextSoaNumber(prefix);
    const [bw, bp] = branchWhere(auth, 'c');
    const entries = await all(
      `SELECT t.*, c.name as company_name
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

  async soa_check(input) {
    const number = trim(input.number ?? '').toUpperCase();
    if (number === '') return { ok: true, data: { tracker: [], ledger: [] } };
    const tracker = await all('SELECT t.*, c.name as company_name FROM soa_tracker t LEFT JOIN companies c ON c.id = t.company_id WHERE UPPER(t.soa_number) = ?', [number]);
    const ledger = await all('SELECT l.*, c.name as company_name FROM ledger_entries l JOIN companies c ON c.id = l.company_id WHERE UPPER(l.soa_number) = ?', [number]);
    return { ok: true, data: { tracker, ledger } };
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
};

async function saveCompany(input, auth, action) {
  const name = trim(input.name ?? '');
  const code = trim(input.code ?? '');
  const status = STATUSES.includes(input.status ?? '') ? input.status : 'ACTIVE';
  const accountType = (input.account_type ?? 'COMPANY') === 'HMO' ? 'HMO' : 'COMPANY';
  const contact = trim(input.contact_person ?? '');
  const number = trim(input.contact_number ?? '');
  const email = trim(input.email_address ?? '');
  const remarks = trim(input.remarks ?? '');
  const branch = auth.isAdmin() ? elvis(trim(input.branch ?? ''), null) : auth.branch();

  if (name === '') jsonExit({ ok: false, error: 'Company name is required.' }, 400);

  try {
    if (action === 'create_company') {
      const id = await insertId(
        'INSERT INTO companies (name, code, status, account_type, branch, contact_person, contact_number, email_address, remarks) VALUES (?,?,?,?,?,?,?,?,?)',
        [name, code, status, accountType, branch, contact, number, email, remarks]
      );
      return { ok: true, id, message: `Company "${name}" added.` };
    }
    const editId = toInt(input.id);
    await requireCompanyAccess(auth, editId);
    await exec(
      'UPDATE companies SET name=?, code=?, status=?, account_type=?, branch=?, contact_person=?, contact_number=?, email_address=?, remarks=? WHERE id=?',
      [name, code, status, accountType, branch, contact, number, email, remarks, editId]
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

    // ---- public (no login needed)
    if (action === 'login') {
      const u = await attemptLogin(trim(input.username ?? ''), String(input.password ?? ''));
      if (u) return sendJson(res, 200, { ok: true, user: userPayload(u) }, { 'Set-Cookie': sessionCookie(req, u) });
      return sendJson(res, 401, { ok: false, error: 'Invalid username or password.' });
    }
    if (action === 'me') return sendJson(res, 200, { ok: true, user: userPayload(user) });
    if (action === 'logout') return sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearCookie(req) });

    // ---- everything else needs a login
    if (!user) return sendJson(res, 401, { ok: false, error: 'Not logged in.' });

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
