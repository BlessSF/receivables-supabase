import { Fragment, useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';

const ROLE_LABEL = { admin: 'Admin', accounting: 'Accounting', staff: 'Staff', branch: 'Branch', executive: 'Executive' };
const ROLE_BADGE = { admin: 'badge-info', accounting: 'badge-info', staff: 'badge-success', branch: 'badge-secondary', executive: 'badge-warning' };
const MANAGED = ['staff', 'accounting']; // roles that can be edited / deleted on this page

const PAGE_LABEL = {
  '/': 'Dashboard', '/summary': 'Summary', '/reports-by-month': 'Reports by Month', '/companies': 'Companies', '/hmos': 'HMOs',
  '/company-charges': 'Company Charges', '/billing': 'Billing', '/ledger': 'Ledger', '/aging': 'Aging Report',
  '/past-due': 'Past Due', '/soa-tracker': 'SOA Tracker', '/monitoring': 'Monitoring',
  '/payables/cash-position': 'Cash Position', '/payables/main': 'Main', '/payables/running': 'Running Payables',
  '/payables/record': 'Payment Record', '/payables/titles': 'Account Titles',
};
const ACCESS_GROUPS = [
  { module: 'Receivables', groups: [
    { label: 'Overview', pages: ['/', '/summary', '/reports-by-month'] },
    { label: 'Accounts', pages: ['/companies', '/hmos', '/company-charges', '/billing', '/ledger'] },
    { label: 'Collections', pages: ['/aging', '/past-due', '/soa-tracker', '/monitoring'] },
  ] },
  { module: 'Payables', groups: [
    { label: 'Cash', pages: ['/payables/cash-position', '/payables/main'] },
    { label: 'Payables', pages: ['/payables/running', '/payables/record'] },
    { label: 'Setup', pages: ['/payables/titles'] },
  ] },
];
const ACCESS_ROLES = [['accounting', 'Accounting'], ['staff', 'Staff'], ['executive', 'Executive'], ['branch', 'Branch']];
const isPayPage = (p) => p.startsWith('/payables');

/** Which sidebar pages each role can open, in both Receivables and Payables. Only Admin and Executive see this. */
function SidebarAccess() {
  const { refreshUser } = useAuth();
  const [d, setD] = useState(null);
  const [saved, setSaved] = useState({});
  const [access, setAccess] = useState({});
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getNavAccess().then((r) => { setD(r.data); setAccess(r.data.access); setSaved(r.data.access); }).catch((e) => setMsg({ type: 'error', msg: e.message }));
  }, []);

  const norm = (a) => JSON.stringify(ACCESS_ROLES.map(([r]) => [...(a[r] || [])].sort()));
  const dirty = d && norm(access) !== norm(saved);

  const baseOf = (role) => (d.base[role] || []).filter((p) => p !== '/');
  function toggle(role, path) {
    setMsg(null);
    setAccess((a) => {
      const cur = a[role] || [];
      return { ...a, [role]: cur.includes(path) ? cur.filter((p) => p !== path) : [...cur, path] };
    });
  }
  function setAll(role, on) {
    setMsg(null);
    setAccess((a) => ({ ...a, [role]: on ? ['/', ...baseOf(role)] : ['/'] }));
  }
  function resetDefault() {
    setMsg(null);
    const next = {};
    ACCESS_ROLES.forEach(([r]) => { next[r] = ['/', ...baseOf(r).filter((p) => !isPayPage(p))]; });
    setAccess(next);
  }
  async function save() {
    setBusy(true); setMsg(null);
    try {
      const r = await api.saveNavAccess(access);
      setAccess(r.data.access); setSaved(r.data.access);
      setMsg({ type: 'success', msg: 'Saved. People see the change the next time they open or refresh the page.' });
      refreshUser();
    } catch (ex) { setMsg({ type: 'error', msg: ex.message }); }
    setBusy(false);
  }

  if (!d) return msg ? <div className={`flash flash-${msg.type}`}>{msg.msg}</div> : null;
  return (
    <div className="panel sa-panel">
      <div className="sa-head">
        <div>
          <h2>Sidebar access</h2>
          <p className="sa-sub">Choose which pages each role can see and open, in Receivables and in Payables. Admin always has everything. A dash (—) means that role can never use that page. Payables starts switched off for everyone except Admin.</p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={resetDefault}>Reset to default</button>
      </div>

      {msg && <div className={`flash flash-${msg.type}`} style={{ margin: '0 24px 14px' }}>{msg.msg}</div>}

      <div className="sa-scroll">
        <table className="sa-table">
          <thead>
            <tr>
              <th className="sa-page-col">Page</th>
              {ACCESS_ROLES.map(([r, l]) => {
                const base = baseOf(r);
                const on = base.filter((p) => (access[r] || []).includes(p)).length;
                return (
                  <th key={r} className="sa-role-col">
                    <div className="sa-role-name">{l}</div>
                    <div className="sa-role-count">{on} of {base.length} pages</div>
                    <div className="sa-role-links">
                      <button type="button" onClick={() => setAll(r, true)}>All</button>
                      <span>·</span>
                      <button type="button" onClick={() => setAll(r, false)}>None</button>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          {ACCESS_GROUPS.map((m) => (
            <tbody key={m.module}>
              <tr className={'sa-module-row' + (m.module === 'Payables' ? ' pay' : '')}>
                <td colSpan={ACCESS_ROLES.length + 1}><span className="sa-module-dot" />{m.module}</td>
              </tr>
              {m.groups.map((g) => (
                <Fragment key={m.module + g.label}>
                  <tr className="sa-group-row"><td colSpan={ACCESS_ROLES.length + 1}>{g.label}</td></tr>
                  {g.pages.map((path) => (
                    <tr key={path} className="sa-row">
                      <td className="sa-page">{PAGE_LABEL[path] || path}</td>
                      {ACCESS_ROLES.map(([r, l]) => {
                        const inBase = path === '/' || (d.base[r] || []).includes(path);
                        const locked = path === '/';
                        const checked = locked || (access[r] || []).includes(path);
                        return (
                          <td key={r} className="sa-cell">
                            {!inBase ? <span className="sa-none" title={`${l} cannot use this page`}>—</span> : (
                              <label className={'sa-switch' + (locked ? ' locked' : '')} title={locked ? 'The dashboard is always on' : ''}>
                                <input type="checkbox" checked={checked} disabled={locked} onChange={() => toggle(r, path)} aria-label={`${PAGE_LABEL[path]} for ${l}`} />
                                <span className="sa-track"><span className="sa-thumb" /></span>
                              </label>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      <div className="sa-foot">
        <span className={'sa-state' + (dirty ? ' dirty' : '')}>{dirty ? 'You have unsaved changes' : 'All changes saved'}</span>
        <button className="btn" onClick={save} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save sidebar access'}</button>
      </div>
    </div>
  );
}

function PasswordInput({ value, onChange, placeholder, autoComplete = 'new-password' }) {
  const [show, setShow] = useState(false);
  return (
    <div className="field-password">
      <input
        type={show ? 'text' : 'password'}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" className="reveal-btn" onClick={() => setShow((s) => !s)}>{show ? 'Hide' : 'Show'}</button>
    </div>
  );
}

export default function Users() {
  const { user } = useAuth();
  const [users, setUsers] = useState(null);
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState(null);

  // create form
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('staff');
  const [busy, setBusy] = useState(false);

  // edit row
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editPass, setEditPass] = useState('');

  const load = useCallback(() => {
    api.getUsers().then((r) => setUsers(r.data)).catch((e) => setErr(e.message));
  }, []);
  useEffect(load, [load]);

  async function onCreate(e) {
    e.preventDefault();
    setBusy(true);
    setFlash(null);
    try {
      const r = await api.createUser({ full_name: fullName, username, password, role });
      setFlash({ type: 'success', msg: r.message });
      setFullName(''); setUsername(''); setPassword('');
      load();
    } catch (ex) {
      setFlash({ type: 'error', msg: ex.message });
    }
    setBusy(false);
  }

  function startEdit(u) {
    setEditId(u.id);
    setEditName(u.full_name || '');
    setEditPass('');
    setFlash(null);
  }

  async function saveEdit(u) {
    setFlash(null);
    try {
      const r = await api.updateUser({ id: u.id, full_name: editName, password: editPass });
      setFlash({ type: 'success', msg: r.message });
      setEditId(null);
      load();
    } catch (ex) {
      setFlash({ type: 'error', msg: ex.message });
    }
  }

  async function remove(u) {
    if (!window.confirm(`Delete the account "${u.username}"? They will be logged out and can no longer sign in.`)) return;
    setFlash(null);
    try {
      const r = await api.deleteUser(u.id);
      setFlash({ type: 'success', msg: r.message });
      load();
    } catch (ex) {
      setFlash({ type: 'error', msg: ex.message });
    }
  }

  if (!user?.is_admin && !user?.is_executive) return <div className="flash flash-error">Only an admin or executive can open Users.</div>;
  if (err) return <div className="flash flash-error">{err}</div>;
  if (!users) return <div className="loading-state">Loading users…</div>;

  const staffCount = users.filter((u) => u.role === 'staff').length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Users</h1>
          <div className="subtitle">Create Admin, Accounting or Staff accounts. Accounting can use everything in Receivables except Users, Branches, Settings and Payables. Staff can see every company's ledger, the dashboard and Reports by Month, and can edit only Payment Date, Check Ref and Paid.</div>
        </div>
      </div>

      {flash && <div className={`flash flash-${flash.type}`}>{flash.msg}</div>}

      <div className="panel">
        <h2>Add a user</h2>
        <form onSubmit={onCreate}>
          <div className="form-grid">
            <div className="form-group">
              <label>Full name</label>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Maria Santos" />
            </div>
            <div className="form-group">
              <label>Username</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="e.g. maria"
                required
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <PasswordInput value={password} onChange={setPassword} placeholder="At least 6 characters" />
            </div>
            <div className="form-group">
              <label>Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="staff">Staff</option>
                <option value="accounting">Accounting</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <button className="btn" type="submit" disabled={busy || !username.trim() || !password}>{busy ? 'Creating…' : '+ Create user'}</button>
          </div>
        </form>
      </div>

      <div className="panel">
        <h2>All users <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--slate)' }}>· {staffCount} staff · {users.filter((u) => u.role === 'accounting').length} accounting</span></h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Name</th><th>Username</th><th>Role</th><th className="text-right">Actions</th></tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isStaffRow = MANAGED.includes(u.role);
                const editing = editId === u.id;
                return (
                  <tr key={u.id}>
                    <td>
                      {editing
                        ? <input value={editName} onChange={(e) => setEditName(e.target.value)} />
                        : (u.full_name || '—')}
                    </td>
                    <td><strong>{u.username}</strong></td>
                    <td><span className={`badge ${ROLE_BADGE[u.role] || 'badge-secondary'}`}>{ROLE_LABEL[u.role] || u.role}</span></td>
                    <td className="text-right">
                      {!isStaffRow && <span style={{ fontSize: 12.5, color: 'var(--slate)' }}>Managed outside this page</span>}
                      {isStaffRow && editing && (
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
                          <div style={{ minWidth: 190 }}>
                            <PasswordInput value={editPass} onChange={setEditPass} placeholder="New password (optional)" />
                          </div>
                          <button className="btn btn-sm" onClick={() => saveEdit(u)}>Save</button>
                          <button className="btn btn-secondary btn-sm" onClick={() => setEditId(null)}>Cancel</button>
                        </div>
                      )}
                      {isStaffRow && !editing && (
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          <button className="btn btn-secondary btn-sm" onClick={() => startEdit(u)}>Edit / reset password</button>
                          <button className="btn btn-danger btn-sm" onClick={() => remove(u)}>Delete</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <SidebarAccess />
    </div>
  );
}