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

/**
 * What each HMO shows on this page (set by an admin). Saved as { "HMO NAME": "self" | "peer" | "none" }:
 * self = only this branch, peer = only the other branch, none = hidden. An HMO not listed shows both branches.
 * (An older saved list of hidden names is read as "none".)
 */
const SCOPES = ['self', 'peer', 'none'];
export async function hmoScopes() {
  const out = {};
  try {
    const v = JSON.parse(await getSetting('combined_scope', 'null'));
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, m] of Object.entries(v)) if (SCOPES.includes(m)) out[norm(k)] = m;
  } catch { /* none saved */ }
  try {
    const old = JSON.parse(await getSetting('combined_excluded', '[]'));
    if (Array.isArray(old)) for (const k of old) if (norm(k) && !out[norm(k)]) out[norm(k)] = 'none';
  } catch { /* ignore */ }
  return out;
}
export async function hmoScope(name) { return (await hmoScopes())[norm(name)] || 'both'; }
export async function isExcludedHmo(name) { return (await hmoScope(name)) === 'none'; }
export async function saveHmoScopes(scopes) {
  const out = {};
  if (scopes && typeof scopes === 'object' && !Array.isArray(scopes)) {
    for (const [k, m] of Object.entries(scopes).slice(0, 1000)) { const key = norm(String(k).slice(0, 200)); if (key && SCOPES.includes(m)) out[key] = m; }
  }
  await setSetting('combined_scope', JSON.stringify(out));
  await setSetting('combined_excluded', '[]'); // the old list is now part of the scopes above
  return out;
}

/** HMO names found in either database (for the picker). Admin gets every HMO with its scope so it can be changed; others only get what is shown. */
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
  const scopes = await hmoScopes();
  let names = [...map.entries()].map(([k, v]) => ({ ...v, scope: scopes[k] || 'both', excluded: scopes[k] === 'none' }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  if (!isAdmin) names = names.filter((n) => n.scope !== 'none' && !(n.scope === 'self' && !n.self) && !(n.scope === 'peer' && !n.peer));
  return { self_name: selfName(), peer_name: peerName(), peer_connected: peerConfigured(), peer_error: peerError, names, can_edit: !!isAdmin };
}

/** One HMO, both branches. from / to = billing date range (YYYY-MM-DD, optional). */
export async function combinedReport(name, from, to) {
  const f = /^\d{4}-\d{2}-\d{2}$/.test(from || '') ? from : '';
  const t = /^\d{4}-\d{2}-\d{2}$/.test(to || '') ? to : '';
  const scope = await hmoScope(name);
  const mine = scope === 'peer' ? [] : await rowsFrom((sql, p) => all(sql, p), name, f, t);
  let theirs = [];
  let peerError = '';
  if (peerConfigured() && scope !== 'self') {
    try { theirs = await peerRead((q) => rowsFrom(q, name, f, t)); } catch (e) { peerError = 'Could not read the other branch database right now.'; console.error('peer report', e?.message); }
  }
  const a = totalOf(mine), b = totalOf(theirs);
  // each branch has its own total; the two are not added together
  return {
    name, from: f, to: t, scope,
    peer_connected: peerConfigured(), peer_error: peerError,
    branches: [
      { label: selfName(), peer: false, rows: mine, total: a },
      { label: peerName(), peer: true, rows: theirs, total: b },
    ].filter((br) => (scope === 'self' ? !br.peer : scope === 'peer' ? br.peer : true)),
  };
}