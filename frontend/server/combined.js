// "Both branches": one HMO's billings from this system and from the other branch's database, side by side (read only).
import { all } from './db.js';
import { peerConfigured, peerRead } from './db.js';
import { toFloat } from './php.js';
import { coveredLabel } from './dates.js';
import { getSetting, setSetting } from './lib.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const ymdOf = (v) => { const m = String(v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : ''; };
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();

export const selfName = () => String(process.env.SELF_NAME || '').trim() || 'This system';
export const peerName = () => String(process.env.PEER_NAME || '').trim() || 'Other branch';

/** Only accounts that can see every branch may use this page. */
export function combinedAllowed(auth) {
  return auth.isAdmin() || auth.isAccounting();
}

async function namesFrom(q) {
  return q(`SELECT name FROM companies WHERE account_type = 'HMO' ORDER BY UPPER(name)`);
}

async function rowsFrom(q, name, from, to) {
  const rows = await q(
    `SELECT l.id, l.billing_date, l.soa_number, l.period_from, l.period_to, l.period_date,
            l.amount, l.receivable_amount, l.paid_amount, l.balance, c.name AS company_name
     FROM ledger_entries l JOIN companies c ON c.id = l.company_id
     WHERE c.account_type = 'HMO' AND UPPER(TRIM(c.name)) = ?
     ORDER BY l.billing_date, l.id`, [norm(name)]);
  return rows
    .filter((r) => { const d = ymdOf(r.billing_date); return (!from || (d && d >= from)) && (!to || (d && d <= to)); })
    .map((r) => ({
      id: r.id,
      billing_date: ymdOf(r.billing_date) || String(r.billing_date ?? ''),
      covered: coveredLabel(r),
      soa_number: r.soa_number || '',
      amount: r2(toFloat(r.amount)),
      receivable: r2(toFloat(r.receivable_amount)),
      paid: r2(toFloat(r.paid_amount)),
      balance: r2(toFloat(r.balance)),
    }));
}

const totalOf = (rows) => ({
  count: rows.length,
  amount: r2(rows.reduce((t, r) => t + r.amount, 0)),
  receivable: r2(rows.reduce((t, r) => t + r.receivable, 0)),
  paid: r2(rows.reduce((t, r) => t + r.paid, 0)),
  balance: r2(rows.reduce((t, r) => t + r.balance, 0)),
});

/** HMOs an admin hid from this page (saved as upper-case names; the picker and the report skip them). */
export async function excludedHmos() {
  try { const a = JSON.parse(await getSetting('combined_excluded', '[]')); return Array.isArray(a) ? a.map(norm).filter(Boolean) : []; } catch { return []; }
}
export async function isExcludedHmo(name) { return (await excludedHmos()).includes(norm(name)); }
export async function saveExcludedHmos(names) {
  const list = [...new Set((Array.isArray(names) ? names : []).map((n) => norm(String(n).slice(0, 200))).filter(Boolean))].slice(0, 500);
  await setSetting('combined_excluded', JSON.stringify(list));
  return list;
}

/** HMO names found in either database (for the picker). Admin also gets the hidden ones (flagged) so they can be un-hidden. */
export async function combinedNames(isAdmin = false) {
  const own = (await namesFrom((sql, p) => all(sql, p))).map((r) => r.name);
  let other = [];
  let peerError = '';
  if (peerConfigured()) {
    try { other = (await peerRead((q) => namesFrom(q))).map((r) => r.name); } catch (e) { peerError = 'Could not reach the other branch database.'; console.error('peer names', e?.message); }
  }
  const map = new Map();
  for (const n of own) { const k = norm(n); map.set(k, { name: n, self: true, peer: false }); }
  for (const n of other) { const k = norm(n); const cur = map.get(k); if (cur) cur.peer = true; else map.set(k, { name: n, self: false, peer: true }); }
  const hidden = new Set(await excludedHmos());
  let names = [...map.entries()].map(([k, v]) => ({ ...v, excluded: hidden.has(k) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  if (!isAdmin) names = names.filter((n) => !n.excluded);
  return { self_name: selfName(), peer_name: peerName(), peer_connected: peerConfigured(), peer_error: peerError, names, can_edit: !!isAdmin };
}

/** One HMO, both branches. from / to = billing date range (YYYY-MM-DD, optional). */
export async function combinedReport(name, from, to) {
  const f = /^\d{4}-\d{2}-\d{2}$/.test(from || '') ? from : '';
  const t = /^\d{4}-\d{2}-\d{2}$/.test(to || '') ? to : '';
  const mine = await rowsFrom((sql, p) => all(sql, p), name, f, t);
  let theirs = [];
  let peerError = '';
  if (peerConfigured()) {
    try { theirs = await peerRead((q) => rowsFrom(q, name, f, t)); } catch (e) { peerError = 'Could not read the other branch database right now.'; console.error('peer report', e?.message); }
  }
  const a = totalOf(mine), b = totalOf(theirs);
  // each branch has its own total; the two are not added together
  return {
    name, from: f, to: t,
    peer_connected: peerConfigured(), peer_error: peerError,
    branches: [
      { label: selfName(), rows: mine, total: a },
      { label: peerName(), rows: theirs, total: b },
    ],
  };
}