import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { peso, fdate } from '../utils';
import MoneyInput from '../MoneyInput';
import TitleNameSelect from '../TitleNameSelect';
import LongDateInput from '../LongDateInput';

const ymdLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const blankRow = (date = '') => ({ k: Math.random().toString(36).slice(2), check_date: date, payee: '', category: 'Other', title_name: '', amount: '', status: 'Unpaid', note: '' });
const isEmpty = (r) => !r.payee.trim() && !r.amount;

export default function PaymentRecord() {
  const [rows, setRows] = useState(() => [blankRow(ymdLocal()), blankRow(ymdLocal()), blankRow(ymdLocal())]);
  const [categories, setCategories] = useState([]);
  const [titleNames, setTitleNames] = useState({});
  const [recent, setRecent] = useState(null);
  const [flash, setFlash] = useState(null);
  const [busy, setBusy] = useState(false);

  function loadRecent() {
    return api.getPayables().then((r) => {
      setCategories(r.categories || []);
      setTitleNames(r.title_names || {});
      setRecent([...r.data].sort((a, b) => b.id - a.id).slice(0, 8));
    }).catch((e) => { setFlash({ type: 'error', msg: e.message }); setRecent([]); });
  }
  useEffect(() => { loadRecent(); }, []);

  const set = (k, patch) => setRows((cur) => cur.map((r) => (r.k === k ? { ...r, ...patch } : r)));
  const filled = rows.filter((r) => !isEmpty(r));
  const total = filled.reduce((t, r) => t + (Number(r.amount) || 0), 0);

  function addRow() { setRows((cur) => [...cur, blankRow(cur[cur.length - 1]?.check_date || ymdLocal())]); }
  function removeRow(k) { setRows((cur) => (cur.length > 1 ? cur.filter((r) => r.k !== k) : cur)); }

  async function save() {
    if (!filled.length) { setFlash({ type: 'error', msg: 'Type at least one payee and amount.' }); return; }
    setBusy(true); setFlash(null);
    try {
      const r = await api.addPayablesBulk(filled.map(({ k, ...rest }) => rest)); // eslint-disable-line no-unused-vars
      setFlash({ type: 'success', msg: r.message });
      setRows([blankRow(ymdLocal()), blankRow(ymdLocal()), blankRow(ymdLocal())]);
      loadRecent();
    } catch (e) { setFlash({ type: 'error', msg: e.message }); }
    setBusy(false);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Payment Record</h1>
          <div className="subtitle">Type in the payables you need to release. Saving adds them to Running Payables.</div>
        </div>
        <Link className="btn btn-secondary" to="/payables/running">View Running Payables</Link>
      </div>

      {flash && <div className={`flash flash-${flash.type}`}>{flash.msg}</div>}

      <div className="panel">
        <div className="table-wrap">
          <table className="data-table rec-table">
            <thead>
              <tr>
                <th>Check date</th>
                <th>Payee</th>
                <th>Account title <Link className="pay-link-btn" to="/payables/titles">Manage</Link></th>
                <th>Name / company</th>
                <th className="text-right">Amount</th>
                <th>Status</th>
                <th>Note</th>
                <th aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.k}>
                  <td style={{ minWidth: 190 }}><LongDateInput value={r.check_date} onChange={(v) => set(r.k, { check_date: v })} /></td>
                  <td style={{ minWidth: 220 }}><input className="rec-input" value={r.payee} onChange={(e) => set(r.k, { payee: e.target.value })} placeholder="Payee name" /></td>
                  <td>
                    <select className="select-inline rec-input" value={r.category} onChange={(e) => set(r.k, { category: e.target.value, title_name: '' })}>
                      {[...new Set([...categories, r.category])].map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td style={{ minWidth: 200 }}><TitleNameSelect className="select-inline rec-input" category={r.category} value={r.title_name} onChange={(v) => set(r.k, { title_name: v })} titleNames={titleNames} /></td>
                  <td style={{ minWidth: 130 }}><MoneyInput className="rec-input rec-amount" value={r.amount} onChange={(v) => set(r.k, { amount: v })} placeholder="0.00" /></td>
                  <td>
                    <select className="select-inline rec-input" value={r.status} onChange={(e) => set(r.k, { status: e.target.value })}>
                      <option>Unpaid</option><option>Paid</option>
                    </select>
                  </td>
                  <td style={{ minWidth: 160 }}><input className="rec-input" value={r.note} onChange={(e) => set(r.k, { note: e.target.value })} placeholder="Optional" /></td>
                  <td><button type="button" className="btn btn-secondary btn-sm btn-icon" onClick={() => removeRow(r.k)} aria-label="Remove row" title="Remove row">×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="rec-footer">
          <button type="button" className="btn btn-secondary" onClick={addRow}>+ Add row</button>
          <div className="rec-total">{filled.length} {filled.length === 1 ? 'payable' : 'payables'} · <strong>{peso(total)}</strong></div>
          <button type="button" className="btn" disabled={busy || !filled.length} onClick={save}>{busy ? 'Saving…' : 'Save to Running Payables'}</button>
        </div>
      </div>


      <div className="panel">
        <h2>Recently added</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Check date</th><th>Payee</th><th>Account title</th><th>Name / company</th><th className="text-right">Amount</th><th>Status</th></tr></thead>
            <tbody>
              {recent === null && <tr><td colSpan={6} className="empty-state">Loading…</td></tr>}
              {recent && recent.length === 0 && <tr><td colSpan={6} className="empty-state">Nothing recorded yet.</td></tr>}
              {(recent || []).map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{r.check_date ? fdate(r.check_date) : '—'}</td>
                  <td><strong>{r.payee}</strong></td>
                  <td><span className="pay-cat">{r.category}</span></td>
                  <td>{r.title_name || '—'}</td>
                  <td className="num text-right">{peso(r.amount)}</td>
                  <td><span className={`badge ${r.status === 'Paid' ? 'badge-success' : 'badge-warning'}`}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}