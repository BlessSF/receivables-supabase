import { IconOpen, IconEdit, IconTrash } from '../icons';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { peso, isStaff } from '../utils';
import { useAuth } from '../AuthContext';

// "Company Charges": the companies that get charged directly (instead of through an HMO).
// Each one is its own account with its own ledger -- the name may match an HMO's name.
const BLANK = { name: '', code: '', account_type: 'CHARGE', status: 'ACTIVE', contact_person: '', contact_number: '', email_address: '', remarks: '', branch: '' };

export default function CompanyCharges() {
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin;
  const staff = isStaff(user); // staff can look but not add / edit
  const [rows, setRows] = useState(null);
  const [branches, setBranches] = useState([]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(null); // null = hidden, object = add/edit
  const [flash, setFlash] = useState(null);
  const [busy, setBusy] = useState(false);

  function load() {
    api.getCompanies()
      .then((r) => setRows(r.data.filter((c) => c.account_type === 'CHARGE')))
      .catch((e) => setFlash({ type: 'error', msg: e.message }));
  }
  useEffect(() => {
    load();
    if (isAdmin) api.getBranches().then((r) => setBranches(r.data.branches || []));
  }, [isAdmin]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((c) => [c.name, c.code, c.contact_person].filter(Boolean).join(' ').toLowerCase().includes(q));
  }, [rows, search]);

  const totalOutstanding = useMemo(() => (rows || []).reduce((s, c) => s + (Number(c.outstanding) || 0), 0), [rows]);
  const stats = useMemo(() => {
    const r = rows || [];
    return {
      accounts: r.length,
      active: r.filter((c) => c.status === 'ACTIVE').length,
      withBalance: r.filter((c) => (Number(c.outstanding) || 0) > 0.009).length,
      entries: r.reduce((s, c) => s + (Number(c.entry_count) || 0), 0),
    };
  }, [rows]);
  const setF = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) { setFlash({ type: 'error', msg: 'Company name is required.' }); return; }
    setBusy(true);
    try {
      const payload = { ...form, account_type: 'CHARGE' };
      if (form.id) await api.updateCompany(payload); else await api.createCompany(payload);
      setFlash({ type: 'success', msg: `"${form.name}" ${form.id ? 'updated' : 'added'}.` });
      setForm(null);
      load();
    } catch (err) {
      setFlash({ type: 'error', msg: err.message });
    }
    setBusy(false);
  }

  async function remove(c) {
    if (!confirm(`Delete "${c.name}" and all its ledger entries? This cannot be undone.`)) return;
    try {
      await api.deleteCompany(c.id);
      setFlash({ type: 'success', msg: `"${c.name}" deleted.` });
      load();
    } catch (err) {
      setFlash({ type: 'error', msg: err.message });
    }
  }

  if (form) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>{form.id ? 'Edit Company Charge' : 'Add Company Charge'}</h1>
            <div className="subtitle">A company that is charged directly. It gets its own ledger, and its name can be the same as an HMO.</div>
          </div>
          <button className="btn btn-secondary btn-sm back-link" onClick={() => setForm(null)}>← Back</button>
        </div>
        {flash && <div className={`flash flash-${flash.type}`}>{flash.msg}</div>}
        <div className="panel">
          <form onSubmit={submit}>
            <div className="form-grid">
              <div className="form-group"><label>Company name *</label><input required value={form.name} onChange={setF('name')} /></div>
              <div className="form-group"><label>Short code</label><input value={form.code || ''} onChange={setF('code')} /></div>
              <div className="form-group">
                <label>Status</label>
                <select value={form.status} onChange={setF('status')}>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                  <option value="BANKRUPT">BANKRUPT</option>
                </select>
              </div>
              <div className="form-group"><label>Contact person</label><input value={form.contact_person || ''} onChange={setF('contact_person')} /></div>
              <div className="form-group"><label>Contact number</label><input value={form.contact_number || ''} onChange={setF('contact_number')} /></div>
              <div className="form-group"><label>Email</label><input type="email" value={form.email_address || ''} onChange={setF('email_address')} /></div>
              {isAdmin && (
                <div className="form-group">
                  <label>Branch</label>
                  <select value={form.branch || ''} onChange={setF('branch')}>
                    <option value="">Unassigned / Shared</option>
                    {branches.map((b) => <option key={b.username} value={b.username}>{b.full_name || b.username}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="form-group" style={{ marginTop: 14 }}>
              <label>Remarks</label>
              <textarea rows={3} value={form.remarks || ''} onChange={setF('remarks')} />
            </div>
            <div className="form-actions">
              <button className="btn" type="submit" disabled={busy}>{form.id ? 'Save Changes' : 'Add Company Charge'}</button>
              <button className="btn btn-secondary" type="button" onClick={() => setForm(null)}>Cancel</button>
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
          <h1>Company Charges</h1>
          <div className="subtitle">Companies that are charged directly. Each has its own ledger, and the name can match an HMO.</div>
        </div>
        {!staff && <button className="btn" onClick={() => { setFlash(null); setForm({ ...BLANK }); }}>+ Add Company Charge</button>}
      </div>
      {flash && <div className={`flash flash-${flash.type}`}>{flash.msg}</div>}

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Charged companies</div>
          <div className="kpi-value">{rows ? stats.accounts : '…'}</div>
          <div className="kpi-sub">{rows ? `${stats.active} active` : 'on file'}</div>
        </div>
        <div className="kpi-card accent-red">
          <div className="kpi-label">Unpaid, charged directly</div>
          <div className="kpi-value">{peso(totalOutstanding)}</div>
          <div className="kpi-sub">from posted charges</div>
        </div>
        <div className="kpi-card accent-amber">
          <div className="kpi-label">Accounts with a balance</div>
          <div className="kpi-value">{rows ? stats.withBalance : '…'}</div>
          <div className="kpi-sub">still unpaid</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Ledger entries</div>
          <div className="kpi-value">{rows ? stats.entries : '…'}</div>
          <div className="kpi-sub">across all accounts</div>
        </div>
      </div>

      <div className="panel">
        <div className="table-toolbar">
          <input className="table-search" placeholder="Search company name, code, contact…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <span className="table-toolbar-count">{filtered ? `${filtered.length} account${filtered.length === 1 ? '' : 's'}` : ''}</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Company</th><th>Status</th><th>Contact</th>
                <th className="text-right">Ledger entries</th><th className="text-right">Ledger balance</th><th></th>
              </tr>
            </thead>
            <tbody>
              {!filtered && <tr><td colSpan={6} className="empty-state">Loading…</td></tr>}
              {filtered && filtered.length === 0 && (
                <tr><td colSpan={6} className="empty-state">
                  {rows.length ? 'No accounts match your search.' : `No company charges yet.${staff ? '' : ' Click "+ Add Company Charge" to add one.'}`}
                </td></tr>
              )}
              {filtered && filtered.map((c) => (
                <tr key={c.id}>
                  <td><Link to={`/ledger?company_id=${c.id}`}>{c.name}</Link>{c.code ? <span style={{ color: 'var(--slate)' }}> · {c.code}</span> : null}</td>
                  <td><span className={`badge ${c.status === 'ACTIVE' ? 'badge-success' : 'badge-secondary'}`}>{c.status}</span></td>
                  <td>{[c.contact_person, c.contact_number].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="text-right num">{c.entry_count}</td>
                  <td className="text-right num"><Link to={`/ledger?company_id=${c.id}`}>{peso(c.outstanding)}</Link></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <Link className="btn btn-secondary btn-sm icon-btn" to={`/ledger?company_id=${c.id}`} title="Open" aria-label="Open"><IconOpen /></Link>
                    {!staff && <>
                      <button className="btn btn-secondary btn-sm icon-btn" title="Edit" aria-label="Edit" onClick={() => { setFlash(null); setForm({ ...BLANK, ...c }); }}><IconEdit /></button>
                      <button className="btn btn-danger btn-sm icon-btn" title="Delete" aria-label="Delete" onClick={() => remove(c)}><IconTrash /></button></>}
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