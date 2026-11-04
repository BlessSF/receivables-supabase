// "Recently deleted" (undo for deletes), Payables and Receivables.
// Before a delete runs, the rows it is about to remove (with everything that goes with them) are copied into
// deleted_items. "Restore" puts them back exactly as they were, with the same ids. Copies are kept 30 days.
// The table creates itself the first time it is needed (no SQL to run). Saving a copy can never block a delete.
import { all, one, exec, transaction } from './db.js';

export const KEEP_DAYS = 30;
let ready = null;
export function ensureRecycleTable() {
  if (!ready) {
    ready = (async () => {
      await exec(`CREATE TABLE IF NOT EXISTS deleted_items (
        id BIGSERIAL PRIMARY KEY,
        deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        by_id BIGINT NULL,
        by_user TEXT NOT NULL DEFAULT '',
        by_name TEXT NOT NULL DEFAULT '',
        by_role TEXT NOT NULL DEFAULT '',
        area TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT '',
        label TEXT NOT NULL DEFAULT '',
        detail TEXT NOT NULL DEFAULT '',
        n INT NOT NULL DEFAULT 1,
        company_id BIGINT NULL,
        data JSONB NOT NULL,
        restored_at TIMESTAMPTZ NULL,
        restored_by TEXT NULL
      )`);
      await exec('CREATE INDEX IF NOT EXISTS deleted_items_at_idx ON deleted_items (deleted_at DESC)');
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}
async function purge() {
  await exec(`DELETE FROM deleted_items WHERE deleted_at < now() - interval '${KEEP_DAYS} days'`);
}

// Only these tables can be written back (the stored copy is data, never trusted as SQL).
const TABLES = new Set(['running_payables', 'companies', 'ledger_entries', 'ledger_payments', 'billing_transactions', 'soa_tracker', 'monitoring_entries', 'hmo_partners']);
const IDENT = /^[a-z_][a-z0-9_]*$/i;
const qi = (s) => { if (!IDENT.test(s)) throw new Error('bad name'); return `"${s}"`; };
const peso = (n) => `₱${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (v) => Number(v) || 0;
const idList = (v) => [...new Set((Array.isArray(v) ? v : []).map((x) => Math.trunc(Number(x))).filter((x) => x > 0))];

// ---------------------------------------------------------------- reading what a delete will remove
let fkCache = null;
async function fks() {
  if (!fkCache) {
    fkCache = await all(
      `SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent, a.attname AS col, c.confdeltype AS del
       FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
       WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1 AND c.connamespace = 'public'::regnamespace`);
  }
  return fkCache;
}

/** Collector: steps = what to put back, in order. */
function newPlan() { return { steps: [], seen: new Set(), relinkWanted: [], upsertKeys: new Set() }; }
const key = (table, id) => `${table}:${id}`;

/** Copies rows of `table` matching `where` (and every row that would be deleted with them by a cascade). */
async function collect(plan, table, where, params) {
  if (!TABLES.has(table)) return [];
  const rows = (await all(`SELECT to_jsonb(t) AS j FROM ${qi(table)} t WHERE ${where}`, params)).map((r) => r.j)
    .filter((j) => j.id === undefined || !plan.seen.has(key(table, j.id)));
  if (!rows.length) return [];
  plan.steps.push({ op: 'insert', table, rows });
  const ids = [];
  for (const j of rows) if (j.id !== undefined) { plan.seen.add(key(table, j.id)); ids.push(j.id); }
  if (ids.length) {
    for (const f of await fks()) {
      if (f.parent !== table) continue;
      if (f.del === 'c') await collect(plan, f.child, `${qi(f.col)} = ANY(?::bigint[])`, [ids]);
      else if (f.del === 'n') plan.relinkWanted.push({ table: f.child, col: f.col, ids });
    }
  }
  return rows;
}

/** Rows that stay but would lose their link (ON DELETE SET NULL): remember the old link so it can be put back. */
async function finishPlan(plan) {
  const out = [];
  for (const w of plan.relinkWanted) {
    if (!TABLES.has(w.table)) continue;
    const rows = await all(`SELECT id, ${qi(w.col)} AS v FROM ${qi(w.table)} WHERE ${qi(w.col)} = ANY(?::bigint[])`, [w.ids]);
    const pairs = rows.filter((r) => !plan.seen.has(key(w.table, r.id)) && !plan.upsertKeys.has(key(w.table, r.id))).map((r) => [Number(r.id), Number(r.v)]);
    if (pairs.length) out.push({ op: 'relink', table: w.table, col: w.col, type: 'bigint', pairs });
  }
  plan.steps.push(...out);
  return plan.steps;
}

const total = (rows, f) => rows.reduce((t, r) => t + num(r[f]), 0);
const dateOnly = (v) => (v ? String(v).slice(0, 10) : '');

/**
 * What to save before each kind of delete. Returns null when there is nothing to save.
 * -> { area, kind, label, detail, n, company_id, steps, hook? }
 */
const CAPTURE = {
  async delete_payable(i) {
    const plan = newPlan();
    const rows = await collect(plan, 'running_payables', 'id = ?', [Math.trunc(num(i.id))]);
    if (!rows.length) return null;
    const r = rows[0];
    return { area: 'Payables', kind: 'payable', label: `${String(r.payee || '').trim()} · ${peso(r.amount)}`,
      detail: [r.check_date ? `Check date ${dateOnly(r.check_date)}` : '', r.status, r.status === 'Paid' ? r.release_status : ''].filter(Boolean).join(' · '), n: 1, steps: plan.steps };
  },
  async clear_payables(i) {
    const ids = idList(i.ids);
    if (!ids.length) return null;
    const plan = newPlan();
    const rows = await collect(plan, 'running_payables', 'id = ANY(?::bigint[])', [ids]);
    if (!rows.length) return null;
    const names = rows.slice(0, 4).map((r) => String(r.payee || '').trim()).join(', ');
    return { area: 'Payables', kind: 'payables', label: `${rows.length} ${rows.length === 1 ? 'payable' : 'payables'} · ${peso(total(rows, 'amount'))}`,
      detail: `${names}${rows.length > 4 ? ', …' : ''}`, n: rows.length, steps: plan.steps };
  },
  async delete_ledger(i) {
    const plan = newPlan();
    const rows = await collect(plan, 'ledger_entries', 'id = ?', [Math.trunc(num(i.id))]);
    if (!rows.length) return null;
    const e = rows[0];
    await collect(plan, 'billing_transactions', 'ledger_entry_id = ?', [e.id]);
    const soa = await all('SELECT to_jsonb(t) AS j FROM soa_tracker t WHERE ledger_entry_id = ?', [e.id]);
    if (soa.length) { plan.steps.push({ op: 'upsert', table: 'soa_tracker', rows: soa.map((r) => r.j) }); soa.forEach((r) => plan.upsertKeys.add(key('soa_tracker', r.j.id))); }
    const pays = plan.steps.filter((s) => s.table === 'ledger_payments').reduce((t, s) => t + s.rows.length, 0);
    await finishPlan(plan);
    return { area: 'Receivables', kind: 'ledger', company_id: num(e.company_id) || null, n: 1,
      label: `Ledger entry · ${e.company_name || 'company'}${e.soa_number ? ` · SOA ${e.soa_number}` : ''}`,
      detail: [e.billing_date ? `Billed ${dateOnly(e.billing_date)}` : '', `Amount ${peso(e.amount)}`, pays ? `${pays} ${pays === 1 ? 'payment' : 'payments'}` : ''].filter(Boolean).join(' · '), steps: plan.steps };
  },
  async delete_payment(i) {
    const plan = newPlan();
    const rows = await collect(plan, 'ledger_payments', 'id = ?', [Math.trunc(num(i.id))]);
    if (!rows.length) return null;
    const p = rows[0];
    const e = await one('SELECT company_id, company_name, soa_number FROM ledger_entries WHERE id = ?', [p.ledger_entry_id]);
    return { area: 'Receivables', kind: 'payment', company_id: num(e?.company_id) || null, n: 1, hook: { sync_entry: Number(p.ledger_entry_id) },
      label: `Payment ${peso(p.amount)} · ${e?.company_name || 'company'}${e?.soa_number ? ` · SOA ${e.soa_number}` : ''}`,
      detail: [p.payment_date ? `Paid ${dateOnly(p.payment_date)}` : '', p.check_ref ? `Ref ${p.check_ref}` : ''].filter(Boolean).join(' · '), steps: plan.steps };
  },
  async delete_company(i) {
    const plan = newPlan();
    const rows = await collect(plan, 'companies', 'id = ?', [Math.trunc(num(i.id))]);
    if (!rows.length) return null;
    const c = rows[0];
    const entryIds = plan.steps.filter((s) => s.table === 'ledger_entries').flatMap((s) => s.rows.map((r) => r.id));
    if (entryIds.length) {
      await collect(plan, 'billing_transactions', 'ledger_entry_id = ANY(?::bigint[])', [entryIds]);
      const soa = await all('SELECT to_jsonb(t) AS j FROM soa_tracker t WHERE ledger_entry_id = ANY(?::bigint[])', [entryIds]);
      if (soa.length) { plan.steps.push({ op: 'upsert', table: 'soa_tracker', rows: soa.map((r) => r.j) }); soa.forEach((r) => plan.upsertKeys.add(key('soa_tracker', r.j.id))); }
    }
    await finishPlan(plan);
    const count = (t) => plan.steps.filter((s) => s.table === t && s.op === 'insert').reduce((n, s) => n + s.rows.length, 0);
    return { area: 'Receivables', kind: 'company', company_id: Number(c.id), n: 1,
      label: `Company · ${c.name}`,
      detail: [`${count('ledger_entries')} ledger ${count('ledger_entries') === 1 ? 'entry' : 'entries'}`, count('ledger_payments') ? `${count('ledger_payments')} ${count('ledger_payments') === 1 ? 'payment' : 'payments'}` : '', count('monitoring_entries') ? `${count('monitoring_entries')} monitoring` : ''].filter(Boolean).join(' · '), steps: plan.steps };
  },
  async delete_monitoring(i) {
    const plan = newPlan();
    const rows = await collect(plan, 'monitoring_entries', 'id = ?', [Math.trunc(num(i.id))]);
    if (!rows.length) return null;
    const m = rows[0];
    const name = await one('SELECT name FROM companies WHERE id = ?', [m.company_id]);
    return { area: 'Receivables', kind: 'monitoring', company_id: num(m.company_id) || null, n: 1,
      label: `Monitoring · ${name?.name || 'company'}${m.amount !== undefined ? ` · ${peso(m.amount)}` : ''}`, detail: '', steps: plan.steps };
  },
  async soa_delete(i) {
    const plan = newPlan();
    const rows = await collect(plan, 'soa_tracker', 'id = ?', [Math.trunc(num(i.id))]);
    if (!rows.length) return null;
    const t = rows[0];
    if (i.clear_ledger === true || i.clear_ledger === 1 || i.clear_ledger === '1' || i.clear_ledger === 'true') {
      const used = await all('SELECT id, soa_number AS v FROM ledger_entries WHERE UPPER(soa_number) = UPPER(?)', [t.soa_number]);
      if (used.length) plan.steps.push({ op: 'relink', table: 'ledger_entries', col: 'soa_number', type: 'text', pairs: used.map((r) => [Number(r.id), String(r.v)]) });
    }
    return { area: 'Receivables', kind: 'soa', company_id: num(t.company_id) || null, n: 1, label: `SOA number · ${t.soa_number}`, detail: '', steps: plan.steps };
  },
};

export const isRecyclable = (action) => Object.hasOwn(CAPTURE, action);

/** Read what a delete is about to remove (never throws; null = nothing to save). */
export async function captureDelete(action, input) {
  try { return await CAPTURE[action](input); } catch (e) { console.error('recycle capture failed:', e?.message); return null; }
}

/** Store the copy after the delete worked. Returns the new id (or 0). Never throws. */
export async function saveDeleted(user, snap) {
  try {
    await ensureRecycleTable();
    await purge();
    const r = await one(
      `INSERT INTO deleted_items (by_id, by_user, by_name, by_role, area, kind, label, detail, n, company_id, data)
       VALUES (?,?,?,?,?,?,?,?,?,?,?::jsonb) RETURNING id`,
      [user.id ?? null, user.username || '', user.full_name || '', user.role || '', snap.area, snap.kind, snap.label.slice(0, 300), (snap.detail || '').slice(0, 300), snap.n || 1, snap.company_id || null,
        JSON.stringify({ steps: snap.steps, hook: snap.hook || null })]);
    return Number(r?.id) || 0;
  } catch (e) { console.error('recycle save failed:', e?.message); return 0; }
}

// ---------------------------------------------------------------- listing and restoring

/** viewer: { id, role }. Admin and Executive see everything; an Accounting user sees what they deleted themselves. */
export async function listDeleted(viewer) {
  await ensureRecycleTable();
  await purge();
  const own = viewer.role !== 'admin' && viewer.role !== 'executive';
  const rows = await all(
    `SELECT id, to_char(deleted_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD"T"HH24:MI:SS') AS at, by_user, by_name, by_role, area, kind, label, detail, n,
            GREATEST(0, CEIL(EXTRACT(EPOCH FROM (deleted_at + interval '${KEEP_DAYS} days' - now())) / 86400))::int AS days_left
     FROM deleted_items WHERE restored_at IS NULL ${own ? 'AND by_id = ?' : ''} ORDER BY id DESC LIMIT 300`, own ? [viewer.id] : []);
  return rows;
}

export async function loadItem(id) {
  await ensureRecycleTable();
  return one('SELECT * FROM deleted_items WHERE id = ? AND restored_at IS NULL', [id]);
}

async function putBack(client, step) {
  if (!TABLES.has(step.table)) throw new Error('Unknown table in the saved copy.');
  const t = qi(step.table);
  if (step.op === 'relink') {
    const type = step.type === 'text' ? 'text' : 'bigint';
    const col = qi(step.col);
    const data = JSON.stringify(step.pairs.map(([id, v]) => ({ id, v: String(v) })));
    await client.query(
      `UPDATE ${t} AS t SET ${col} = x.v::${type} FROM jsonb_to_recordset($1::jsonb) AS x(id bigint, v text) WHERE t.id = x.id AND t.${col} IS NULL`, [data]);
    return;
  }
  const rows = step.rows || [];
  if (!rows.length) return;
  const cols = Object.keys(rows[0]).filter((c) => IDENT.test(c));
  const list = cols.map(qi).join(', ');
  const json = JSON.stringify(rows);
  if (step.op === 'upsert') {
    const sets = cols.filter((c) => c !== 'id').map((c) => `${qi(c)} = EXCLUDED.${qi(c)}`).join(', ');
    await client.query(`INSERT INTO ${t} (${list}) SELECT ${list} FROM jsonb_populate_recordset(NULL::${t}, $1::jsonb) ON CONFLICT (id) DO UPDATE SET ${sets}`, [json]);
    return;
  }
  const res = await client.query(`INSERT INTO ${t} (${list}) SELECT ${list} FROM jsonb_populate_recordset(NULL::${t}, $1::jsonb) ON CONFLICT DO NOTHING`, [json]);
  if (res.rowCount < rows.length) throw new Error('Some of it already exists again (same id or same unique name/number), so it cannot be put back.');
}

/** Puts the saved rows back in one go (all or nothing). Returns the saved hook, if any. */
export async function restoreItem(item, who) {
  const data = typeof item.data === 'string' ? JSON.parse(item.data) : item.data;
  await transaction(async (client) => {
    for (const step of data.steps || []) await putBack(client, step);
    const r = await client.query('UPDATE deleted_items SET restored_at = now(), restored_by = $2 WHERE id = $1 AND restored_at IS NULL', [item.id, who || '']);
    if (!r.rowCount) throw new Error('Already restored.');
  });
  return data.hook || null;
}