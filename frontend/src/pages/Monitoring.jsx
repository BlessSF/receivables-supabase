import { useEffect, useState } from 'react';
import { api } from '../api';
import { peso, fdate } from '../utils';

const BLANK = { company_id: '', expected_date: '', amount: '', remaining_balance: '', due_date: '', remarks: '' };

export default function Monitoring() {
  const [entries, setEntries] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [form, setForm] = useState(null); // null = hidden, {} = add, {...} = edit
  const [flash, setFlash] = useState(null);

  function load() { api.getMonitoring().then((r) => setEntries(r.data)); }
  useEffect(() => { api.getCompanies().then((r) => setCompanies(r.data)); load(); }, []);

  async function submit(e) {
    e.preventDefault();
    try {
      if (form.id) {
        await api.updateMonitoring(form);
        setFlash({ type: 'success', msg: 'Monitoring entry updated.' });
      } else {
        await api.createMonitoring(form);
        setFlash({ type: 'success', msg: 'Monitoring entry added.' });
      }
      setForm(null);
      load();
    } catch (e2) {
      setFlash({ type: 'error', msg: e2.message });
    }
  }

  async function remove(id) {
    if (!confirm('Delete this monitoring entry?')) return;
    await api.deleteMonitoring(id);
    load();
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Collection Monitoring</h1>
          <div className="subtitle">Expected collection dates and amounts</div>
        </div>
        <button className="btn" onClick={() => setForm({ ...BLANK })}>+ Add Entry</button>
      </div>

      {flash && <div className={`flash flash-${flash.type}`}>{flash.msg}</div>}

      {form && (
        <div className="panel">
          <h2>{form.id ? 'Edit' : 'Add'} Monitoring Entry</h2>
          <form onSubmit={submit}>
            <div className="form-grid">
              <div className="form-group">
                <label>Company *</label>
                <select required value={form.company_id} onChange={(e) => setForm({ ...form, company_id: e.target.value })}>
                  <option value="">Choose…</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Expected Date</label>
                <input type="date" value={form.expected_date || ''} onChange={(e) => setForm({ ...form, expected_date: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Amount</label>
                <input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Remaining Balance</label>
                <input type="number" step="0.01" value={form.remaining_balance} onChange={(e) => setForm({ ...form, remaining_balance: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Due Date</label>
                <input type="date" value={form.due_date || ''} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
              </div>
            </div>
            <div className="form-group" style={{ marginTop: 14 }}>
              <label>Remarks</label>
              <textarea rows={2} value={form.remarks || ''} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
            </div>
            <div className="form-actions">
              <button className="btn" type="submit">Save</button>
              <button className="btn btn-secondary" type="button" onClick={() => setForm(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="panel">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Company</th><th>Expected Date</th><th className="text-right">Amount</th><th className="text-right">Remaining</th><th>Due Date</th><th>Remarks</th><th></th></tr>
            </thead>
            <tbody>
              {!entries && <tr><td colSpan={7} className="empty-state">Loading…</td></tr>}
              {entries && entries.length === 0 && <tr><td colSpan={7} className="empty-state">No monitoring entries yet.</td></tr>}
              {entries && entries.map((r) => (
                <tr key={r.id}>
                  <td>{r.company_name}</td>
                  <td>{fdate(r.expected_date)}</td>
                  <td className="text-right num">{peso(r.amount)}</td>
                  <td className="text-right num">{peso(r.remaining_balance)}</td>
                  <td>{fdate(r.due_date)}</td>
                  <td>{r.remarks || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => setForm({ ...r })}>Edit</button>{' '}
                    <button className="btn btn-danger btn-sm" onClick={() => remove(r.id)}>Delete</button>
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
