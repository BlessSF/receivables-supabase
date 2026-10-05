import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { fdate } from '../utils';

const BLANK = { full_name: '', birthdate: '', sex: '', contact_number: '', email_address: '', company_id: '', branch: '', notes: '' };

function ageOf(birthdate) {
  if (!birthdate) return null;
  const b = new Date(birthdate + 'T00:00:00');
  if (isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) age--;
  return age >= 0 ? age : null;
}

export default function Patients() {
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin;
  const [patients, setPatients] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [branches, setBranches] = useState([]);
  const [form, setForm] = useState(null); // null = hidden, {} = add, {...} = edit
  const [flash, setFlash] = useState(null);
  const [search, setSearch] = useState('');

  function load() { api.getPatients().then((r) => setPatients(r.data)); }
  useEffect(() => {
    load();
    api.getCompanies().then((r) => setCompanies(r.data));
    if (isAdmin) api.getBranches().then((r) => setBranches(r.data.branches || []));
  }, [isAdmin]);

  const shown = useMemo(() => {
    if (!patients) return null;
    const q = search.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter((p) => `${p.full_name} ${p.contact_number || ''} ${p.company_name || ''}`.toLowerCase().includes(q));
  }, [patients, search]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    try {
      const r = form.id ? await api.updatePatient(form) : await api.createPatient(form);
      setFlash({ type: 'success', msg: r.message });
      setForm(null);
      load();
    } catch (err) {
      setFlash({ type: 'error', msg: err.message });
    }
  }

  async function remove(p) {
    if (!confirm(`Delete patient "${p.full_name}"?`)) return;
    try {
      const r = await api.deletePatient(p.id);
      setFlash({ type: 'success', msg: r.message });
      load();
    } catch (err) {
      setFlash({ type: 'error', msg: err.message });
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Patients</h1>
          <div className="subtitle">People who book appointments at the clinic</div>
        </div>
        <button className="btn" onClick={() => { setFlash(null); setForm({ ...BLANK }); }}>+ Add Patient</button>
      </div>

      {flash && <div className={`flash flash-${flash.type}`}>{flash.msg}</div>}

      {form && (
        <div className="panel">
          <h2>{form.id ? 'Edit' : 'Add'} Patient</h2>
          <form onSubmit={submit}>
            <div className="form-grid">
              <div className="form-group">
                <label>Full name *</label>
                <input required value={form.full_name} onChange={set('full_name')} />
              </div>
              <div className="form-group">
                <label>Birthdate</label>
                <input type="date" value={form.birthdate || ''} onChange={set('birthdate')} />
              </div>
              <div className="form-group">
                <label>Sex</label>
                <select value={form.sex || ''} onChange={set('sex')}>
                  <option value="">—</option>
                  <option>Male</option>
                  <option>Female</option>
                </select>
              </div>
              <div className="form-group">
                <label>Contact number</label>
                <input value={form.contact_number || ''} onChange={set('contact_number')} />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input type="email" value={form.email_address || ''} onChange={set('email_address')} />
              </div>
              <div className="form-group">
                <label>Company / HMO (who pays)</label>
                <select value={form.company_id || ''} onChange={set('company_id')}>
                  <option value="">Self-pay / none</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              {isAdmin && (
                <div className="form-group">
                  <label>Branch</label>
                  <select value={form.branch || ''} onChange={set('branch')}>
                    <option value="">None</option>
                    {branches.map((b) => <option key={b.username} value={b.username}>{b.full_name || b.username}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="form-group" style={{ marginTop: 14 }}>
              <label>Notes</label>
              <textarea rows={2} value={form.notes || ''} onChange={set('notes')} />
            </div>
            <div className="form-actions">
              <button className="btn" type="submit">Save</button>
              <button className="btn btn-secondary" type="button" onClick={() => setForm(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="panel">
        <div className="table-toolbar">
          <input className="table-search" placeholder="Search name, contact, or company…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <span className="table-toolbar-count">{shown ? `${shown.length} patient${shown.length === 1 ? '' : 's'}` : ''}</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Name</th><th>Age</th><th>Sex</th><th>Contact</th><th>Company / HMO</th>{isAdmin && <th>Branch</th>}<th className="text-right">Visits</th><th></th></tr>
            </thead>
            <tbody>
              {!shown && <tr><td colSpan={isAdmin ? 8 : 7} className="empty-state">Loading…</td></tr>}
              {shown && shown.length === 0 && (
                <tr><td colSpan={isAdmin ? 8 : 7} className="empty-state">{patients.length ? 'No patients match your search.' : 'No patients yet. Add the first one to start booking appointments.'}</td></tr>
              )}
              {shown && shown.map((p) => {
                const age = ageOf(p.birthdate);
                return (
                  <tr key={p.id}>
                    <td title={p.birthdate ? `Born ${fdate(p.birthdate)}` : undefined}>{p.full_name}</td>
                    <td>{age ?? '—'}</td>
                    <td>{p.sex || '—'}</td>
                    <td>{p.contact_number || '—'}</td>
                    <td>{p.company_name || 'Self-pay'}</td>
                    {isAdmin && <td>{p.branch || '—'}</td>}
                    <td className="text-right num">{p.appointment_count}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => { setFlash(null); setForm({ ...p, birthdate: p.birthdate || '' }); }}>Edit</button>{' '}
                      <button className="btn btn-danger btn-sm" onClick={() => remove(p)}>Delete</button>
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