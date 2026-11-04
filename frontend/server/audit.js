// Audit log: who did what in the system. Admin and Executive can read it (Audit log page); nobody can edit it.
// The table is created by this file the first time it is needed (no SQL to run).
// Every change that works (add / edit / delete / paid / released / cleared / settings / users ...) writes one line.
// Writing the log can never make the real action fail.
import { all, one, scalar, exec } from './db.js';
import { getSetting } from './lib.js';

let ready = null;
export function ensureAuditTable() {
  if (!ready) {
    ready = (async () => {
      await exec(`CREATE TABLE IF NOT EXISTS audit_log (
        id BIGSERIAL PRIMARY KEY,
        at TIMESTAMPTZ NOT NULL DEFAULT now(),
        user_id BIGINT NULL,
        username TEXT NOT NULL DEFAULT '',
        full_name TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT '',
        area TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        ip TEXT NULL
      )`);
      await exec('CREATE INDEX IF NOT EXISTS audit_log_at_idx ON audit_log (at DESC)');
      await exec("DELETE FROM audit_log WHERE at < now() - interval '800 days'");
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

const peso = (n) => `₱${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (v) => Number(v) || 0;
const q = (s) => `"${String(s ?? '').trim()}"`;
const idsOf = (v) => (Array.isArray(v) ? v : []).map((x) => Math.trunc(Number(x))).filter((x) => x > 0).slice(0, 500);

const FIELD_LABEL = {
  billing_date: 'Billing date', period_date: 'Period', covered_period: 'Covered period', soa_number: 'SOA number', amount: 'Amount',
  tax_withheld: 'Tax withheld', surcharge: 'Surcharge', rebate: 'Rebate', payment_date: 'Payment date', check_ref: 'Check ref',
  check_date: 'Check date', paid_amount: 'Paid', due_date: 'Due date', remarks: 'Remarks', deduction_remarks: 'Deduction remarks',
  payment_method: 'Payment method', payment_method_bank: 'Bank', payment_method_other: 'Other method',
};
const MONEY_FIELDS = new Set(['amount', 'tax_withheld', 'surcharge', 'rebate', 'paid_amount']);
const shown = (field, v) => (v === null || v === undefined || v === '' ? 'empty' : MONEY_FIELDS.has(field) ? peso(v) : String(v));

const ledgerWho = async (id) => {
  const r = await one('SELECT company_name, soa_number, amount FROM ledger_entries WHERE id = ?', [id]);
  if (!r) return '';
  return `${r.company_name || 'company'}${r.soa_number ? ` · SOA ${r.soa_number}` : ''}`;
};
const companyName = async (id) => (id ? (await scalar('SELECT name FROM companies WHERE id = ?', [id])) || '' : '');
const payableLine = (r) => (r ? `${q(r.payee)} ${peso(r.amount)}` : 'a payable');
const payableRow = async (id) => one('SELECT payee, amount, status, release_status FROM running_payables WHERE id = ?', [id]);
const userRow = async (id) => one('SELECT username, full_name, role FROM users WHERE id = ?', [id]);

/**
 * action -> { area, kind, before(input), text(input, out, before) }
 * kind is the colour of the tag: add | edit | delete | paid | release | clear | setting | user | login
 * before() is read first, while the old data still exists (so a delete can say what was deleted).
 */
const RULES = {
  // ---------------------------------------------------------------- Payables
  save_payable: {
    area: 'Running Payables', kind: (i) => (i.id ? 'edit' : 'add'),
    before: async (i) => (i.id ? payableRow(num(i.id)) : null),
    text: (i, o, b) => (i.id
      ? `Edited payable ${q(i.payee)} ${peso(i.amount)}${b && (b.payee !== String(i.payee || '').trim() || num(b.amount) !== num(i.amount)) ? ` (was ${payableLine(b)})` : ''}`
      : `Added payable ${q(i.payee)} ${peso(i.amount)}`),
  },
  add_payables_bulk: {
    area: (i) => (i.released === true ? 'Main' : 'Payment Record'), kind: 'add',
    text: (i, o) => {
      const items = Array.isArray(i.items) ? i.items : [];
      const total = items.reduce((t, x) => t + num(x?.amount), 0);
      const first = items.slice(0, 3).map((x) => `${String(x?.payee || '').trim()} ${peso(x?.amount)}`).join(', ');
      return `${i.released === true ? 'Pasted' : 'Saved'} ${items.length} ${items.length === 1 ? 'payable' : 'payables'} (${peso(total)})${i.released === true ? ' as Paid and Released' : ''}: ${first}${items.length > 3 ? ', …' : ''}`;
    },
  },
  set_payable_status: {
    skipIfNoBefore: true,
    area: 'Running Payables', kind: (i) => (i.status === 'Paid' ? 'paid' : 'edit'),
    before: async (i) => payableRow(num(i.id)),
    text: (i, o, b) => `Marked ${payableLine(b)} as ${i.status === 'Paid' ? 'Paid' : 'Unpaid'}${b?.status ? ` (was ${b.status})` : ''}`,
  },
  set_payable_release: {
    skipIfNoBefore: true,
    area: 'Running Payables', kind: 'release',
    before: async (i) => payableRow(num(i.id)),
    text: (i, o, b) => `Marked ${payableLine(b)} as ${i.release_status === 'Released' ? 'Released' : 'Pending Release'}${b?.release_status ? ` (was ${b.release_status})` : ''}`,
  },
  clear_released_payable: {
    skipIfNoBefore: true,
    area: 'Main', kind: 'clear', skip: (i, o) => /already cleared/i.test(o?.message || ''),
    before: async (i) => payableRow(num(i.id)),
    text: (i, o, b) => `Cleared check ${payableLine(b)}`,
  },
  delete_payable: {
    skipIfNoBefore: true,
    area: 'Running Payables', kind: 'delete',
    before: async (i) => payableRow(num(i.id)),
    text: (i, o, b) => `Deleted payable ${payableLine(b)}${b?.status ? ` · ${b.status}${b.status === 'Paid' ? ` / ${b.release_status}` : ''}` : ''}`,
  },
  clear_payables: {
    area: 'Running Payables', kind: 'delete',
    before: async (i) => {
      const ids = idsOf(i.ids);
      if (!ids.length) return { n: 0, total: 0, names: [] };
      const rows = await all('SELECT payee, amount FROM running_payables WHERE id = ANY(?::bigint[])', [ids]);
      return { n: rows.length, total: rows.reduce((t, r) => t + num(r.amount), 0), names: rows.slice(0, 4).map((r) => r.payee) };
    },
    text: (i, o, b) => `Cleared ALL: deleted ${b?.n ?? idsOf(i.ids).length} payables (${peso(b?.total)})${b?.names?.length ? ` e.g. ${b.names.join(', ')}${b.n > b.names.length ? ', …' : ''}` : ''}`,
  },
  save_main_fund: {
    area: 'Main', kind: 'edit',
    before: async () => { try { return JSON.parse(await getSetting('main_fund', '{}')) || {}; } catch { return {}; } },
    text: (i, o, b) => {
      const n = o?.data || {};
      const out = [];
      const money = (k, label) => { if (num(b?.[k]) !== num(n[k])) out.push(`${label} ${peso(b?.[k])} → ${peso(n[k])}`); };
      money('passbook', 'Passbook'); money('deposit', 'Deposit in transit'); money('aub', 'AUB');
      (n.pull || []).forEach((p, idx) => { const old = b?.pull?.[idx]; if (num(old?.amount) !== num(p.amount)) out.push(`${p.label || 'Pull out'} ${peso(old?.amount)} → ${peso(p.amount)}`); });
      const oldChecks = new Map((b?.checks || []).map((c) => [c.id, c]));
      const newChecks = new Map((n.checks || []).map((c) => [c.id, c]));
      for (const [id, c] of newChecks) {
        const old = oldChecks.get(id);
        if (!old) out.push(`added check ${q(c.name)} ${peso(c.amount)}`);
        else if (num(old.amount) !== num(c.amount) || old.name !== c.name) out.push(`edited check ${q(old.name)} ${peso(old.amount)} → ${q(c.name)} ${peso(c.amount)}`);
      }
      for (const [id, c] of oldChecks) if (!newChecks.has(id)) out.push(`removed check ${q(c.name)} ${peso(c.amount)}`);
      return out.length ? `Main: ${out.slice(0, 6).join('; ')}${out.length > 6 ? `; +${out.length - 6} more` : ''}` : 'Main: saved (no figure changed)';
    },
  },
  save_cash_position: { area: 'Cash Position', kind: 'edit', text: () => 'Updated the Cash Position (future payments list)' },
  save_account_titles: { area: 'Account Titles', kind: 'setting', text: () => 'Changed the account titles' },

  // ---------------------------------------------------------------- Ledger / payments
  inline_update_ledger: {
    area: 'Ledger', kind: 'edit',
    before: async (i) => {
      const field = String(i.field ?? '');
      if (!FIELD_LABEL[field]) return null;
      const r = await one(`SELECT company_name, soa_number, "${field}" AS v FROM ledger_entries WHERE id = ?`, [num(i.id)]);
      return r ? { who: `${r.company_name || 'company'}${r.soa_number ? ` · SOA ${r.soa_number}` : ''}`, v: r.v } : null;
    },
    text: (i, o, b) => {
      const f = String(i.field ?? '');
      return `${b?.who || 'Ledger row'}: ${FIELD_LABEL[f] || f} ${shown(f, b?.v instanceof Date ? b.v.toISOString().slice(0, 10) : b?.v)} → ${shown(f, i.value)}`;
    },
  },
  quick_add_ledger: { area: 'Ledger', kind: 'add', before: async (i) => companyName(num(i.company_id)), text: (i, o, b) => `Added a new ledger row for ${b || 'a company'}` },
  delete_ledger: {
    area: 'Ledger', kind: 'delete',
    before: async (i) => { const r = await one('SELECT company_name, soa_number, amount, billing_date::text AS d FROM ledger_entries WHERE id = ?', [num(i.id)]); return r; },
    text: (i, o, b) => `Deleted ledger row ${b ? `${b.company_name || ''}${b.soa_number ? ` · SOA ${b.soa_number}` : ''} · ${peso(b.amount)}${b.d ? ` · billed ${b.d}` : ''}` : `#${i.id}`}`,
  },
  charge_entry_to_company: { area: 'Ledger', kind: 'edit', before: async (i) => ledgerWho(num(i.id)), text: (i, o, b) => `Charged ledger row to the company: ${b}` },
  return_entry_to_hmo: { area: 'Ledger', kind: 'edit', before: async (i) => ledgerWho(num(i.id)), text: (i, o, b) => `Returned ledger row to the HMO: ${b}` },
  add_payment: {
    area: 'Ledger', kind: 'paid',
    before: async (i) => ledgerWho(num(i.ledger_entry_id)),
    text: (i, o, b) => `Added payment ${peso(i.amount)}${i.payment_date ? ` dated ${i.payment_date}` : ''}${i.check_ref ? ` · ref ${i.check_ref}` : ''} · ${b}`,
  },
  update_payment: {
    area: 'Ledger', kind: 'edit',
    before: async (i) => {
      const p = await one('SELECT ledger_entry_id, amount, payment_date::text AS d, check_ref FROM ledger_payments WHERE id = ?', [num(i.id)]);
      return p ? { ...p, who: await ledgerWho(num(p.ledger_entry_id)) } : null;
    },
    text: (i, o, b) => `Edited payment ${b ? `${peso(b.amount)} → ${peso(i.amount)}` : peso(i.amount)}${b?.d !== (i.payment_date || null) && i.payment_date ? ` · date ${b?.d || 'empty'} → ${i.payment_date}` : ''} · ${b?.who || ''}`,
  },
  delete_payment: {
    area: 'Ledger', kind: 'delete',
    before: async (i) => {
      const p = await one('SELECT ledger_entry_id, amount, payment_date::text AS d, check_ref FROM ledger_payments WHERE id = ?', [num(i.id)]);
      return p ? { ...p, who: await ledgerWho(num(p.ledger_entry_id)) } : null;
    },
    text: (i, o, b) => `Deleted payment ${b ? `${peso(b.amount)}${b.d ? ` dated ${b.d}` : ''}${b.check_ref ? ` · ref ${b.check_ref}` : ''} · ${b.who}` : `#${i.id}`}`,
  },

  // ---------------------------------------------------------------- Billing
  save_billing: {
    area: 'Billing', kind: (i) => (i.id ? 'edit' : 'add'),
    text: (i) => `${i.id ? 'Edited' : 'Saved'} billing transaction ${peso(i.amount)}${i.patient_name ? ` · ${i.patient_name}` : ''}${i.soa_number ? ` · SOA ${String(i.soa_number).toUpperCase()}` : ''}`,
  },
  post_billing: {
    area: 'Billing', kind: 'add',
    before: async (i) => one('SELECT amount, patient_name, soa_number FROM billing_transactions WHERE id = ?', [num(i.id)]),
    text: (i, o, b) => `Posted billing ${b ? `${peso(b.amount)}${b.patient_name ? ` · ${b.patient_name}` : ''}${b.soa_number ? ` · SOA ${b.soa_number}` : ''}` : `#${i.id}`} to the ledger`,
  },
  void_billing: {
    area: 'Billing', kind: 'delete',
    before: async (i) => one('SELECT amount, patient_name, soa_number, status FROM billing_transactions WHERE id = ?', [num(i.id)]),
    text: (i, o, b) => `Voided billing ${b ? `${peso(b.amount)}${b.patient_name ? ` · ${b.patient_name}` : ''}${b.soa_number ? ` · SOA ${b.soa_number}` : ''} (was ${b.status})` : `#${i.id}`}`,
  },

  // ---------------------------------------------------------------- SOA tracker
  soa_generate: { area: 'SOA Tracker', kind: 'add', text: (i) => `Added SOA number ${String(i.soa_number || '').toUpperCase()}` },
  soa_update_entry: { area: 'SOA Tracker', kind: 'edit', before: async (i) => scalar('SELECT soa_number FROM soa_tracker WHERE id = ?', [num(i.id)]), text: (i, o, b) => `Edited SOA entry ${b || `#${i.id}`}` },
  soa_delete: { area: 'SOA Tracker', kind: 'delete', before: async (i) => scalar('SELECT soa_number FROM soa_tracker WHERE id = ?', [num(i.id)]), text: (i, o, b) => `Deleted SOA entry ${b || `#${i.id}`}` },

  // ---------------------------------------------------------------- Companies / HMOs / monitoring
  create_company: { area: 'Companies', kind: 'add', text: (i) => `Added company ${q(i.name)}` },
  update_company: { area: 'Companies', kind: 'edit', text: (i) => `Edited company ${q(i.name)}` },
  delete_company: { area: 'Companies', kind: 'delete', before: async (i) => companyName(num(i.id)), text: (i, o, b) => `Deleted company ${q(b)} and its ledger rows` },
  update_company_status: { area: 'Companies', kind: 'edit', before: async (i) => companyName(num(i.id)), text: (i, o, b) => `Set ${q(b)} to ${i.status}` },
  add_hmo_partner: { area: 'HMOs', kind: 'add', text: () => 'Added an HMO partner' },
  remove_hmo_partner: { area: 'HMOs', kind: 'delete', text: () => 'Removed an HMO partner' },
  create_monitoring: { area: 'Monitoring', kind: 'add', before: async (i) => companyName(num(i.company_id)), text: (i, o, b) => `Added monitoring entry for ${b} ${peso(i.amount)}` },
  update_monitoring: { area: 'Monitoring', kind: 'edit', before: async (i) => companyName(num(i.company_id)), text: (i, o, b) => `Edited monitoring entry for ${b} ${peso(i.amount)}` },
  delete_monitoring: { area: 'Monitoring', kind: 'delete', text: (i) => `Deleted monitoring entry #${i.id}` },

  restore_deleted: {
    area: 'Recently deleted', kind: 'restore',
    before: async (i) => scalar('SELECT label FROM deleted_items WHERE id = ?', [num(i.id)]),
    text: (i, o, b) => `Restored from Recently deleted: ${b || `#${i.id}`}`,
  },

  // ---------------------------------------------------------------- Settings / users
  save_branch_sites: { area: 'Settings', kind: 'setting', text: () => 'Changed the branch sites' },
  save_aging_setting: { area: 'Settings', kind: 'setting', text: () => 'Changed the aging / grace setting' },
  save_covered_period_setting: { area: 'Settings', kind: 'setting', text: () => 'Changed the covered period setting' },
  save_covered_period_rules: { area: 'Settings', kind: 'setting', text: () => 'Changed the covered period rules' },
  save_tax_setting: { area: 'Settings', kind: 'setting', text: () => 'Changed the tax withheld setting' },
  save_nav_access: { area: 'Settings', kind: 'setting', text: () => 'Changed the sidebar access of the roles' },
  create_user: { area: 'Users', kind: 'user', text: (i) => `Created user ${q(i.username)} (${i.role || 'staff'})` },
  update_user: { area: 'Users', kind: 'user', before: async (i) => userRow(num(i.id)), text: (i, o, b) => `Edited user ${q(b?.username || `#${i.id}`)}${i.password ? ' · password changed' : ''}` },
  delete_user: { area: 'Users', kind: 'user', before: async (i) => userRow(num(i.id)), text: (i, o, b) => `Deleted user ${q(b?.username || `#${i.id}`)} (${b?.role || ''})` },
  change_user_role: { area: 'Users', kind: 'user', before: async (i) => userRow(num(i.id)), text: (i, o, b) => `Changed role of ${q(b?.username || `#${i.id}`)}: ${b?.role || '?'} → ${i.role}` },
};

export const isAudited = (action) => Object.hasOwn(RULES, action);

/** Read what an action is about to change (before it runs). Never throws. */
export async function auditBefore(action, input) {
  const rule = RULES[action];
  if (!rule?.before) return null;
  try { return await rule.before(input); } catch { return null; }
}

/** Write one line. Never throws. */
export async function auditWrite(user, action, input, out, before, ip) {
  try {
    const rule = RULES[action];
    if (!rule) return;
    await ensureAuditTable();
    if (rule.skipIfNoBefore && !before) return; // the row did not exist: nothing really changed
    if (rule.skip && rule.skip(input, out)) return;
    const pick = (v) => (typeof v === 'function' ? v(input) : v);
    let summary;
    try { summary = rule.text(input, out, before); } catch { summary = action; }
    await exec(
      'INSERT INTO audit_log (user_id, username, full_name, role, area, kind, action, summary, ip) VALUES (?,?,?,?,?,?,?,?,?)',
      [user.id ?? null, user.username || '', user.full_name || '', user.role || '', pick(rule.area), pick(rule.kind), action, String(summary).slice(0, 600), ip || null]);
  } catch (e) { console.error('audit failed:', e?.message); }
}

/** Sign-ins (success or failed). */
export async function auditLogin(username, ok, user, ip) {
  try {
    await ensureAuditTable();
    await exec(
      'INSERT INTO audit_log (user_id, username, full_name, role, area, kind, action, summary, ip) VALUES (?,?,?,?,?,?,?,?,?)',
      [user?.id ?? null, ok ? user.username : String(username || '').slice(0, 60), ok ? user.full_name || '' : '', ok ? user.role : '', 'Sign in', ok ? 'login' : 'failed',
        ok ? 'login' : 'login_failed', ok ? 'Signed in' : `Failed sign-in attempt for ${q(String(username || '').slice(0, 60))}`, ip || null]);
  } catch (e) { console.error('audit login failed:', e?.message); }
}

const AREAS_ORDER = ['Running Payables', 'Main', 'Payment Record', 'Cash Position', 'Account Titles', 'Ledger', 'Billing', 'SOA Tracker', 'Companies', 'HMOs', 'Monitoring', 'Settings', 'Users', 'Recently deleted', 'Sign in'];

/** Page of the log for the Audit page. */
export async function readAudit({ user = '', area = '', kind = '', from = '', to = '', search = '', before = 0, limit = 100 }) {
  await ensureAuditTable();
  const where = []; const p = [];
  if (user) { where.push('username = ?'); p.push(user); }
  if (area) { where.push('area = ?'); p.push(area); }
  if (kind) { where.push('kind = ?'); p.push(kind); }
  // days are in Philippine time, like the rest of the system
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { where.push("(at AT TIME ZONE 'Asia/Manila')::date >= ?::date"); p.push(from); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { where.push("(at AT TIME ZONE 'Asia/Manila')::date <= ?::date"); p.push(to); }
  if (search) { where.push("(summary ILIKE ? OR username ILIKE ? OR full_name ILIKE ?)"); const s = `%${search.replace(/[%_]/g, '')}%`; p.push(s, s, s); }
  if (before > 0) { where.push('id < ?'); p.push(before); }
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 300);
  const rows = await all(
    `SELECT id, to_char(at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD"T"HH24:MI:SS') AS at, username, full_name, role, area, kind, action, summary, ip
     FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ${lim + 1}`, p);
  const more = rows.length > lim;
  const users = (await all('SELECT username, MAX(role) AS role, MAX(full_name) AS full_name FROM audit_log GROUP BY username ORDER BY username')).map((u) => ({ username: u.username, role: u.role, full_name: u.full_name }));
  const areas = (await all('SELECT DISTINCT area FROM audit_log')).map((r) => r.area).sort((a, b) => (AREAS_ORDER.indexOf(a) + 1 || 99) - (AREAS_ORDER.indexOf(b) + 1 || 99));
  return { rows: rows.slice(0, lim), more, users, areas };
}