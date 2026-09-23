import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { fdate } from '../utils';

export default function SoaTracker() {
  const [data, setData] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [prefix, setPrefix] = useState('SN-C');
  const [form, setForm] = useState({ soa_number: '', company_id: '', status: 'UNUSED' });
  const [flash, setFlash] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);

  // "Find a Number" lookup
  const [checkNumber, setCheckNumber] = useState('');
  const [checkResult, setCheckResult] = useState(null);
  const [checking, setChecking] = useState(false);

  function load(p = prefix) {
    api.getSoaTracker(p).then((r) => {
      setData(r.data);
      setForm((f) => ({ ...f, soa_number: r.data.suggested }));
    });
  }
  useEffect(() => { api.getCompanies().then((r) => setCompanies(r.data)); load(); }, []); // eslint-disable-line

  async function generate(e) {
    e.preventDefault();
    try {
      await api.soaGenerate(form);
      setFlash({ type: 'success', msg: `Saved SOA number: ${form.soa_number}` });
      load();
    } catch (e2) {
      setFlash({ type: 'error', msg: e2.message });
    }
  }

  function startEdit(entry) {
    setEditingId(entry.id);
    setEditDraft({ id: entry.id, soa_number: entry.soa_number, company_id: entry.company_id || '', status: entry.status || 'UNUSED' });
  }

  async function saveEdit() {
    try {
      await api.soaUpdateEntry({ ...editDraft, company_id: editDraft.company_id || null });
      setFlash({ type: 'success', msg: 'SOA entry updated.' });
      setEditingId(null);
      load();
    } catch (e2) {
      setFlash({ type: 'error', msg: e2.message });
    }
  }

  async function runCheck(e) {
    e.preventDefault();
    if (!checkNumber.trim()) { setCheckResult(null); return; }
    setChecking(true);
    try {
      const r = await api.soaCheck(checkNumber.trim().toUpperCase());
      setCheckResult(r.data);
    } catch (e2) {
      setFlash({ type: 'error', msg: e2.message });
    }
    setChecking(false);
  }

  if (!data) return <div className="loading-state">Loading SOA tracker…</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>SOA Number Tracker</h1>
          <div className="subtitle">Central log of Statement-of-Account numbers issued, so numbers are never reused or skipped</div>
        </div>
      </div>

      {flash && <div className={`flash flash-${flash.type}`}>{flash.msg}</div>}

      <div className="panel">
        <h2>Generate Next SOA Number</h2>
        <p style={{ fontSize: 12.5, color: 'var(--slate)', margin: '-6px 0 14px' }}>
          Auto-suggests the next number for a prefix — starts at {prefix}00001 the first time it's used, then keeps counting up.
          Assign it to a company, then edit the number itself if you need to (add a letter like A, B, C for a supplementary copy, or type any number you like).
        </p>

        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 14 }}>
          <div className="form-group" style={{ width: 140 }}>
            <label>Prefix</label>
            <input value={prefix} onChange={(e) => { setPrefix(e.target.value); load(e.target.value); }} />
          </div>
          <span style={{ fontSize: 12, color: 'var(--slate)' }}>Suggested next: <strong className="mono">{data.suggested}</strong></span>
        </div>

        <form onSubmit={generate} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ minWidth: 220 }}>
            <label>Assign to Company (optional)</label>
            <select value={form.company_id} onChange={(e) => setForm({ ...form, company_id: e.target.value })}>
              <option value="">— Unassigned —</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ minWidth: 180 }}>
            <label>SOA Number</label>
            <input style={{ textTransform: 'uppercase', fontWeight: 600 }} value={form.soa_number} onChange={(e) => setForm({ ...form, soa_number: e.target.value })} />
          </div>
          <div className="form-group" style={{ minWidth: 130 }}>
            <label>Status</label>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="UNUSED">Unused</option>
              <option value="USED">Used</option>
            </select>
          </div>
          <button className="btn" type="submit">Generate</button>
        </form>
      </div>

      <div className="panel">
        <h2>Find a Number</h2>
        <p style={{ fontSize: 12.5, color: 'var(--slate)', margin: '-6px 0 14px' }}>
          Checks both this log <strong>and</strong> the actual ledger entries directly for an exact number — useful when the Issued list below says
          "Unused" but saving that number still gets rejected as already in use.
        </p>
        <form onSubmit={runCheck} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ minWidth: 220 }}>
            <label>SOA Number</label>
            <input style={{ textTransform: 'uppercase' }} placeholder="e.g. SN-C01236" value={checkNumber} onChange={(e) => setCheckNumber(e.target.value)} />
          </div>
          <button className="btn btn-secondary btn-sm" type="submit" disabled={checking}>{checking ? 'Checking…' : 'Check'}</button>
        </form>

        {checkResult && (
          <div style={{ marginTop: 18 }}>
            <h3 style={{ fontSize: 14, marginBottom: 8 }}>In the SOA Tracker log</h3>
            {checkResult.tracker.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--slate)' }}>No tracker row for "{checkNumber}".</div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Company</th><th>Status</th><th>Issued Date</th><th></th></tr></thead>
                  <tbody>
                    {checkResult.tracker.map((r) => (
                      <tr key={r.id}>
                        <td>{r.company_name || '—'}</td>
                        <td><span className={`badge ${r.status === 'USED' ? 'badge-info' : 'badge-secondary'}`}>{r.status === 'USED' ? 'Used' : 'Unused'}</span></td>
                        <td>{fdate(r.issued_date, { month: 'short', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                        <td><button className="btn btn-secondary btn-sm" onClick={() => startEdit(r)}>Edit</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <h3 style={{ fontSize: 14, margin: '16px 0 8px' }}>Typed directly into a ledger entry</h3>
            {checkResult.ledger.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--slate)' }}>No ledger entry has "{checkNumber}" as its SOA number.</div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Company</th><th>Billing Date</th><th></th></tr></thead>
                  <tbody>
                    {checkResult.ledger.map((r) => (
                      <tr key={r.id}>
                        <td>{r.company_name || '—'}</td>
                        <td>{fdate(r.billing_date)}</td>
                        <td>{r.company_id && <Link to={`/ledger?company_id=${r.company_id}`} className="btn btn-secondary btn-sm">Open Ledger</Link>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {checkResult.tracker.length === 0 && checkResult.ledger.length === 0 && (
              <div style={{ fontSize: 12.5, color: 'var(--slate)', marginTop: 8 }}>
                This number isn't held anywhere — it should be free to use. If saving it still fails, double check for extra spaces or a mismatched prefix.
              </div>
            )}
          </div>
        )}
      </div>

      {editingId && editDraft && (
        <div className="panel" style={{ border: '2px solid var(--teal)' }}>
          <h2>Edit SOA Entry — {editDraft.soa_number}</h2>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ minWidth: 180 }}>
              <label>SOA Number</label>
              <input style={{ textTransform: 'uppercase', fontWeight: 600 }} value={editDraft.soa_number} onChange={(e) => setEditDraft({ ...editDraft, soa_number: e.target.value })} />
            </div>
            <div className="form-group" style={{ minWidth: 220 }}>
              <label>Assign to Company</label>
              <select value={editDraft.company_id} onChange={(e) => setEditDraft({ ...editDraft, company_id: e.target.value })}>
                <option value="">— Unassigned —</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ minWidth: 130 }}>
              <label>Status</label>
              <select value={editDraft.status} onChange={(e) => setEditDraft({ ...editDraft, status: e.target.value })}>
                <option value="UNUSED">Unused</option>
                <option value="USED">Used</option>
              </select>
            </div>
            <button className="btn" onClick={saveEdit}>Save Changes</button>
            <button className="btn btn-secondary" onClick={() => setEditingId(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="panel">
        <h2>Issued SOA Numbers</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>SOA Number</th><th>Company</th><th>Status</th><th>Issued Date</th><th></th></tr></thead>
            <tbody>
              {data.entries.length === 0 && <tr><td colSpan={5} className="empty-state">No SOA numbers issued yet.</td></tr>}
              {data.entries.map((entry) => (
                <tr key={entry.id}>
                  <td><strong>{entry.soa_number}</strong></td>
                  <td>{entry.company_name || '—'}</td>
                  <td><span className={`badge ${entry.status === 'USED' ? 'badge-info' : 'badge-secondary'}`}>{entry.status === 'USED' ? 'Used' : 'Unused'}</span></td>
                  <td>{fdate(entry.issued_date, { month: 'short', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                  <td><button className="btn btn-secondary btn-sm" onClick={() => startEdit(entry)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
