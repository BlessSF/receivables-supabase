import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { peso, fdate } from '../utils';

function todayLocal() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

const blank = () => ({
  id: null, txn_date: todayLocal(), patient_name: '', service: '', amount: '',
  hmo_id: '', company_id: '', bill_to: 'HMO', remarks: '',
});

const STATUS_BADGE = { OPEN: 'badge-warning', POSTED: 'badge-success', VOID: 'badge-secondary' };

export default function Billing() {
  const [rows, setRows] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState(null); // null = hidden
  const [filter, setFilter] = useState('OPEN');
  const [flash, setFlash] = useState(null);
  const [busy, setBusy] = useState(false);
  const [partnerMap, setPartnerMap] = useState({}); // hmo id -> [company ids]
  const [params, setParams] = useSearchParams();

  function load() { api.getBilling().then((r) => setRows(r.data)).catch((e) => setFlash({ type: 'error', msg: e.message })); }
  useEffect(() => {
    load();
    api.getCompanies().then((r) => setAccounts(r.data));
    api.getHmoPartners().then((r) => {
      const m = {};
      r.data.forEach((p) => { (m[p.hmo_id] = m[p.hmo_id] || []).push(Number(p.company_id)); });
      setPartnerMap(m);
    }).catch(() => {});
    // Arrived from the HMOs page ("+ New Charge"): open a transaction with that HMO already chosen.
    const pre = params.get('hmo_id');
    if (pre) {
      setForm({ ...blank(), hmo_id: pre });
      setParams({}, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hmos = useMemo(() => accounts.filter((a) => a.account_type === 'HMO'), [accounts]);
  const companies = useMemo(() => accounts.filter((a) => a.account_type !== 'HMO'), [accounts]);

  const shown = useMemo(() => {
    if (!rows) return null;
    return filter === 'ALL' ? rows : rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  const counts = useMemo(() => {
    const c = { OPEN: 0, POSTED: 0, VOID: 0 };
    (rows || []).forEach((r) => { c[r.status] = (c[r.status] || 0) + 1; });
    return c;
  }, [rows]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  // When an HMO is chosen, its partner companies are listed first in the Company dropdown.
  const partnerIds = new Set(form && form.hmo_id ? (partnerMap[Number(form.hmo_id)] || []) : []);
  const partnerList = companies.filter((c) => partnerIds.has(c.id));
  const otherList = companies.filter((c) => !partnerIds.has(c.id));

  async function save(andPost) {
    if (!form.hmo_id && !form.company_id) { setFlash({ type: 'error', msg: 'Choose an HMO, a company, or both.' }); return; }
    if (andPost && !(Number(form.amount) > 0)) { setFlash({ type: 'error', msg: 'Enter an amount greater than zero to post.' }); return; }
    setBusy(true);
    try {
      const r = await api.saveBilling(form);
      let msg = r.message;
      if (andPost) {
        const p = await api.postBilling(r.id);
        msg = p.message;
      }
      setFlash({ type: 'success', msg });
      setForm(null);
      load();
    } catch (e) {
      setFlash({ type: 'error', msg: e.message });
      load();
    }
    setBusy(false);
  }

  async function post(r) {
    const target = r.bill_to === 'COMPANY' ? r.company_name : r.hmo_name;
    if (!confirm(`Post ${peso(r.amount)} to ${target}'s ledger?`)) return;
    try {
      const res = await api.postBilling(r.id);
      setFlash({ type: 'success', msg: res.message });
      load();
    } catch (e) { setFlash({ type: 'error', msg: e.message }); }
  }

  async function voidTxn(r) {
    const extra = r.status === 'POSTED' ? ' Its charge will be removed from the ledger.' : '';
    if (!confirm(`Void this transaction?${extra}`)) return;
    try {
      const res = await api.voidBilling(r.id);
      setFlash({ type: 'success', msg: res.message });
      load();
    } catch (e) { setFlash({ type: 'error', msg: e.message }); }
  }

  function edit(r) {
    setFlash(null);
    setForm({
      id: r.id, txn_date: r.txn_date || todayLocal(), patient_name: r.patient_name || '', service: r.service || '',
      amount: r.amount, hmo_id: r.hmo_id || '', company_id: r.company_id || '', bill_to: r.bill_to || 'HMO', remarks: r.remarks || '',
    });
  }

  const billedName = (r) => (r.bill_to === 'COMPANY' ? r.company_name : r.hmo_name) || '—';
  const billedId = (r) => (r.bill_to === 'COMPANY' ? r.company_id : r.hmo_id);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Billing</h1>
          <div className="subtitle">Open a transaction, pick the HMO and company, then post it to the ledger</div>
        </div>
        <button className="btn" onClick={() => { setFlash(null); setForm(blank()); }}>+ New Transaction</button>
      </div>

      {flash && <div className={`flash flash-${flash.type}`}>{flash.msg}</div>}

      {form && (
        <div className="panel">
          <h2>{form.id ? `Edit Transaction #${form.id}` : 'Open a Transaction'}</h2>
          <form onSubmit={(e) => { e.preventDefault(); save(false); }}>
            <div className="form-grid">
              <div className="form-group">
                <label>Date</label>
                <input type="date" value={form.txn_date} onChange={set('txn_date')} />
              </div>
              <div className="form-group">
                <label>Patient name</label>
                <input value={form.patient_name} onChange={set('patient_name')} />
              </div>
              <div className="form-group">
                <label>Service / description</label>
                <input value={form.service} onChange={set('service')} />
              </div>
              <div className="form-group">
                <label>Amount (₱)</label>
                <input type="number" step="0.01" min="0" value={form.amount} onChange={set('amount')} />
              </div>
              <div className="form-group">
                <label>HMO</label>
                <select value={form.hmo_id} onChange={set('hmo_id')}>
                  <option value="">— None —</option>
                  {hmos.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Company</label>
                <select value={form.company_id} onChange={set('company_id')}>
                  <option value="">— None —</option>
                  {partnerList.length > 0 && (
                    <optgroup label="Partner companies of this HMO">
                      {partnerList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </optgroup>
                  )}
                  {partnerList.length > 0
                    ? <optgroup label="Other companies">{otherList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
                    : companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Charge to</label>
                <select value={form.bill_to} onChange={set('bill_to')}>
                  <option value="HMO">The HMO</option>
                  <option value="COMPANY">The company</option>
                </select>
              </div>
            </div>
            {hmos.length === 0 && (
              <div className="subtitle" style={{ marginTop: 10 }}>
                No HMO accounts yet. Open Companies, edit each partner HMO and set "Company or HMO?" to HMO.
              </div>
            )}
            <div className="form-group" style={{ marginTop: 14 }}>
              <label>Remarks</label>
              <textarea rows={2} value={form.remarks} onChange={set('remarks')} />
            </div>
            <div className="form-actions">
              <button className="btn" type="button" disabled={busy} onClick={() => save(true)}>Save &amp; Post to Ledger</button>
              <button className="btn btn-secondary" type="submit" disabled={busy}>Save (keep open)</button>
              <button className="btn btn-secondary" type="button" onClick={() => setForm(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="panel">
        <div className="table-toolbar">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[['OPEN', 'Open'], ['POSTED', 'Posted'], ['VOID', 'Voided'], ['ALL', 'All']].map(([k, label]) => (
              <button key={k} className={`btn btn-sm ${filter === k ? '' : 'btn-secondary'}`} onClick={() => setFilter(k)}>
                {label}{k !== 'ALL' && rows ? ` (${counts[k] || 0})` : ''}
              </button>
            ))}
          </div>
          <span className="table-toolbar-count">{shown ? `${shown.length} transaction${shown.length === 1 ? '' : 's'}` : ''}</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th><th>Date</th><th>Patient</th><th>Service</th><th>HMO</th><th>Company</th>
                <th>Charged to</th><th className="text-right">Amount</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {!shown && <tr><td colSpan={10} className="empty-state">Loading…</td></tr>}
              {shown && shown.length === 0 && (
                <tr><td colSpan={10} className="empty-state">
                  {filter === 'OPEN' ? 'No open transactions. Click "+ New Transaction" to open one.' : 'Nothing here.'}
                </td></tr>
              )}
              {shown && shown.map((r) => (
                <tr key={r.id}>
                  <td className="num">{r.id}</td>
                  <td>{fdate(r.txn_date)}</td>
                  <td>{r.patient_name || '—'}</td>
                  <td>{r.service || '—'}</td>
                  <td>{r.hmo_name || '—'}</td>
                  <td>{r.company_name || '—'}</td>
                  <td>
                    <span className={`badge ${r.bill_to === 'COMPANY' ? 'badge-secondary' : 'badge-info'}`}>{r.bill_to === 'COMPANY' ? 'Company' : 'HMO'}</span>{' '}
                    {r.status === 'POSTED' && r.ledger_entry_id
                      ? <Link to={`/ledger?company_id=${billedId(r)}&entry=${r.ledger_entry_id}`}>{billedName(r)}</Link>
                      : billedName(r)}
                  </td>
                  <td className="text-right num">{peso(r.amount)}</td>
                  <td><span className={`badge ${STATUS_BADGE[r.status] || 'badge-secondary'}`}>{r.status}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {r.status === 'OPEN' && <>
                      <button className="btn btn-sm" onClick={() => post(r)}>Post</button>{' '}
                      <button className="btn btn-secondary btn-sm" onClick={() => edit(r)}>Edit</button>{' '}
                    </>}
                    {r.status !== 'VOID' && <button className="btn btn-danger btn-sm" onClick={() => voidTxn(r)}>Void</button>}
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