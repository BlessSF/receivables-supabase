import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';

const ROLE_LABEL = { admin: 'Admin', staff: 'Staff', branch: 'Branch', executive: 'Executive' };
const ROLE_BADGE = { admin: 'badge-info', staff: 'badge-success', branch: 'badge-secondary', executive: 'badge-warning' };

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
    if (!window.confirm(`Delete the staff account "${u.username}"? They will be logged out and can no longer sign in.`)) return;
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
          <div className="subtitle">Create Admin or Staff accounts. Staff can see every company's ledger, the dashboard and Reports by Month, and can edit only Payment Date, Check Ref and Paid.</div>
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
        <h2>All users <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--slate)' }}>· {staffCount} staff</span></h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Name</th><th>Username</th><th>Role</th><th className="text-right">Actions</th></tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isStaffRow = u.role === 'staff';
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
    </div>
  );
}