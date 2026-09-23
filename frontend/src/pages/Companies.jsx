import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { peso } from '../utils';
import { useAuth } from '../AuthContext';

const BLANK = { name: '', code: '', account_type: 'COMPANY', status: 'ACTIVE', contact_person: '', contact_number: '', email_address: '', remarks: '', branch: '' };

export default function Companies() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState(null);
  const [branches, setBranches] = useState([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null); // null = list, {} = add, {...} = edit
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);

  function load() {
    api.getCompanies().then((r) => setCompanies(r.data));
    if (user?.is_admin) api.getBranches().then((r) => setBranches(r.data.branches));
  }
  useEffect(load, [user]);

  const filtered = useMemo(() => {
    if (!companies) return [];
    const q = search.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter((c) =>
      [c.name, c.code, c.contact_person, c.branch].filter(Boolean).join(' ').toLowerCase().includes(q)
    );
  }, [companies, search]);

  function startAdd() { setForm(BLANK); setEditing({}); }
  function startEdit(c) { setForm({ ...BLANK, ...c }); setEditing(c); }

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) { setFlash({ type: 'error', msg: 'Company name is required.' }); return; }
    setBusy(true);
    try {
      if (editing?.id) {
        await api.updateCompany(form);
        setFlash({ type: 'success', msg: `Company "${form.name}" updated.` });
      } else {
        await api.createCompany(form);
        setFlash({ type: 'success', msg: `Company "${form.name}" added.` });
      }
      setEditing(null);
      load();
    } catch (e2) {
      setFlash({ type: 'error', msg: e2.message });
    }
    setBusy(false);
  }

  async function changeStatus(c, status) {
    setCompanies((prev) => prev.map((x) => (x.id === c.id ? { ...x, status } : x)));
    try {
      await api.updateCompanyStatus(c.id, status);
    } catch (e2) {
      setFlash({ type: 'error', msg: e2.message });
      load();
    }
  }

  async function remove(c) {
    if (!confirm(`Delete "${c.name}" and all its ledger entries? This cannot be undone.`)) return;
    try {
      await api.deleteCompany(c.id);
      setFlash({ type: 'success', msg: `Company "${c.name}" deleted.` });
      load();
    } catch (e2) {
      setFlash({ type: 'error', msg: e2.message });
    }
  }

  if (editing !== null) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>{editing?.id ? 'Edit Company' : 'Add Company'}</h1>
            <div className="subtitle">Company / HMO account details</div>
          </div>
          <button className="btn btn-secondary" onClick={() => setEditing(null)}>← Back to list</button>
        </div>
        <div className="panel">
          <form onSubmit={submit}>
            <div className="form-grid">
              <div className="form-group">
                <label>Company / HMO Name *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>Short Code</label>
                <input placeholder="e.g. ICR" value={form.code || ''} onChange={(e) => setForm({ ...form, code: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Company or HMO?</label>
                <select value={form.account_type} onChange={(e) => setForm({ ...form, account_type: e.target.value })}>
                  <option value="COMPANY">Company</option>
                  <option value="HMO">HMO</option>
                </select>
              </div>
              <div className="form-group">
                <label>Status</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                  <option value="BANKRUPT">BANKRUPT</option>
                </select>
              </div>
              <div className="form-group">
                <label>Contact Person</label>
                <input value={form.contact_person || ''} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Contact Number</label>
                <input value={form.contact_number || ''} onChange={(e) => setForm({ ...form, contact_number: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Email Address</label>
                <input type="email" value={form.email_address || ''} onChange={(e) => setForm({ ...form, email_address: e.target.value })} />
              </div>
              {user?.is_admin && (
                <div className="form-group">
                  <label>Branch</label>
                  <select value={form.branch || ''} onChange={(e) => setForm({ ...form, branch: e.target.value })}>
                    <option value="">Unassigned / Shared</option>
                    {branches.map((b) => <option key={b.username} value={b.username}>{b.full_name || b.username}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="form-group" style={{ marginTop: 14 }}>
              <label>Remarks</label>
              <textarea rows={3} value={form.remarks || ''} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
            </div>
            <div className="form-actions">
              <button className="btn" type="submit" disabled={busy}>{editing?.id ? 'Save Changes' : 'Add Company'}</button>
              <button className="btn btn-secondary" type="button" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Companies / HMOs</h1>
          <div className="subtitle">
            {companies ? companies.length : '…'} corporate accounts on file
            {user?.is_admin ? ' (all branches)' : ` — ${user?.full_name || user?.username} branch only`}
          </div>
        </div>
        <button className="btn" onClick={startAdd}>+ Add Company</button>
      </div>

      {flash && <div className={`flash flash-${flash.type}`}>{flash.msg}</div>}

      <div className="panel">
        <div className="table-toolbar">
          <div className="table-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.3-4.3" /></svg>
            <input placeholder="Search by name, code, contact…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <span className="table-toolbar-count">{filtered.length} match{filtered.length === 1 ? '' : 'es'}</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th><th>Name</th><th>Code</th><th>Type</th><th>Status</th>
                {user?.is_admin && <th>Branch</th>}
                <th className="text-right">Entries</th><th className="text-right">Outstanding</th><th>Contact</th><th></th>
              </tr>
            </thead>
            <tbody>
              {!companies && <tr><td colSpan={10} className="empty-state">Loading…</td></tr>}
              {companies && filtered.length === 0 && (
                <tr><td colSpan={10} className="empty-state">No companies yet. <a onClick={startAdd} style={{ cursor: 'pointer' }}>Add one</a>.</td></tr>
              )}
              {filtered.map((c, idx) => (
                <tr key={c.id}>
                  <td className="num" style={{ color: 'var(--slate)' }}>{idx + 1}</td>
                  <td><Link to={`/ledger?company_id=${c.id}`}>{c.name}</Link></td>
                  <td>{c.code || '—'}</td>
                  <td><span className={`badge ${c.account_type === 'HMO' ? 'badge-info' : 'badge-secondary'}`}>{c.account_type}</span></td>
                  <td>
                    <select
                      className="status-select"
                      value={c.status}
                      onChange={(e) => changeStatus(c, e.target.value)}
                    >
                      <option value="ACTIVE">ACTIVE</option>
                      <option value="INACTIVE">INACTIVE</option>
                      <option value="BANKRUPT">BANKRUPT</option>
                    </select>
                  </td>
                  {user?.is_admin && <td>{c.branch || '— shared —'}</td>}
                  <td className="text-right num">{c.entry_count}</td>
                  <td className="text-right num">{peso(c.outstanding)}</td>
                  <td>{c.contact_person || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => startEdit(c)}>Edit</button>{' '}
                    <button className="btn btn-danger btn-sm" onClick={() => remove(c)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
