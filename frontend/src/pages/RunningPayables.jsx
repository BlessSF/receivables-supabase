import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { peso, fdate, MONTHS } from '../utils';
import MoneyInput from '../MoneyInput';
import PayeeInput from '../PayeeInput';
import LongDateInput from '../LongDateInput';

const BLANK = { id: null, check_date: '', payee: '', category: 'Other', amount: '', status: 'Unpaid', note: '' };
const ymdLocal = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monthLabel = (key) => { const [y, m] = key.split('-'); return `${MONTHS[Number(m) - 1]} ${y}`; };
const sumOf = (rows) => rows.reduce((t, r) => t + (Number(r.amount) || 0), 0);

export default function RunningPayables() {
  const [rows, setRows] = useState(null);
  const [categories, setCategories] = useState([]);
  const [titleNames, setTitleNames] = useState({});
  const [flash, setFlash] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('All'); // All | Paid | Unpaid
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [month, setMonth] = useState('');

  function load() {
    return api.getPayables()
      .then((r) => { setRows(r.data); setCategories(r.categories || []); setTitleNames(r.title_names || {}); })
      .catch((e) => { setFlash({ type: 'error', msg: e.message }); setRows([]); });
  }
  useEffect(() => { load(); }, []);

  const today = ymdLocal();
  const in7 = (() => { const d = new Date(); d.setDate(d.getDate() + 7); return ymdLocal(d); })();

  const stats = useMemo(() => {
    const all = rows || [];
    const unpaid = all.filter((r) => r.status === 'Unpaid');
    const paid = all.filter((r) => r.status === 'Paid');
    const overdue = unpaid.filter((r) => r.check_date && r.check_date < today);
    const soon = unpaid.filter((r) => r.check_date && r.check_date >= today && r.check_date <= in7);
    return { unpaid, paid, overdue, soon };
  }, [rows, today, in7]);

  // Titles from the list, plus any still used by saved rows (e.g. a title that was removed later)
  const titleOptions = useMemo(() => [...new Set([...categories, ...(rows || []).map((r) => r.category)])], [categories, rows]);

  const months = useMemo(() => [...new Set((rows || []).filter((r) => r.check_date).map((r) => r.check_date.slice(0, 7)))].sort().reverse(), [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows || []).filter((r) =>
      (tab === 'All' || r.status === tab) &&
      (!cat || r.category === cat) &&
      (!month || (r.check_date || '').startsWith(month)) &&
      (!needle || r.payee.toLowerCase().includes(needle) || (r.note || '').toLowerCase().includes(needle)));
  }, [rows, tab, q, cat, month]);

  async function toggleStatus(r) {
    const next = r.status === 'Paid' ? 'Unpaid' : 'Paid';
    setRows((cur) => cur.map((x) => (x.id === r.id ? { ...x, status: next } : x))); // instant
    try { await api.setPayableStatus(r.id, next); }
    catch (e) { setFlash({ type: 'error', msg: e.message }); load(); }
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.savePayable(form);
      setFlash({ type: 'success', msg: r.message });
      setForm(null);
      await load();
    } catch (e2) { setFlash({ type: 'error', msg: e2.message }); }
    setBusy(false);
  }

  async function remove(r) {
    if (!confirm(`Delete "${r.payee}" (${peso(r.amount)})?`)) return;
    try { await api.deletePayable(r.id); setFlash({ type: 'success', msg: 'Payable deleted.' }); load(); }
    catch (e) { setFlash({ type: 'error', msg: e.message }); }
  }

  const tabs = [
    ['All', (rows || []).length],
    ['Paid', stats.paid.length],
    ['Unpaid', stats.unpaid.length],
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Running Payables</h1>
          <div className="subtitle">Every check and payable to release. The Unpaid total is your running payables figure.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn" onClick={() => { setFlash(null); setForm({ ...BLANK, check_date: today }); }}>+ Add payable</button>
        </div>
      </div>

      {flash && <div className={`flash flash-${flash.type}`}>{flash.msg}</div>}

      <div className="kpi-grid">
        <div className="kpi-card accent-red">
          <div className="kpi-label">Running payables (Unpaid)</div>
          <div className="kpi-value">{peso(sumOf(stats.unpaid))}</div>
          <div className="kpi-sub">{stats.unpaid.length} unpaid {stats.unpaid.length === 1 ? 'item' : 'items'}</div>
        </div>
        <div className="kpi-card accent-amber">
          <div className="kpi-label">Due in the next 7 days</div>
          <div className="kpi-value">{peso(sumOf(stats.soon))}</div>
          <div className="kpi-sub">{stats.soon.length} {stats.soon.length === 1 ? 'check' : 'checks'}</div>
        </div>
        <div className="kpi-card accent-red">
          <div className="kpi-label">Overdue</div>
          <div className="kpi-value">{peso(sumOf(stats.overdue))}</div>
          <div className="kpi-sub">{stats.overdue.length} past their check date</div>
        </div>
        <div className="kpi-card accent-green">
          <div className="kpi-label">Paid</div>
          <div className="kpi-value">{peso(sumOf(stats.paid))}</div>
          <div className="kpi-sub">{stats.paid.length} released</div>
        </div>
      </div>

      <div className="panel">
        <div className="table-toolbar">
          <div className="pay-tabs" role="tablist">
            {tabs.map(([name, n]) => (
              <button key={name} type="button" role="tab" aria-selected={tab === name} className={'pay-tab' + (tab === name ? ' active' : '')} onClick={() => setTab(name)}>
                {name} <span className="pay-tab-n">{n}</span>
              </button>
            ))}
          </div>
          <div className="pay-filters">
            <label className="table-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search payee or note…" />
            </label>
            <select className="select-inline" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Account title">
              <option value="">All account titles</option>
              {titleOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="select-inline" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
              <option value="">All months</option>
              {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table pay-table">
            <thead>
              <tr>
                <th>Check date</th>
                <th>Payee</th>
                <th>Account title</th>
                <th className="text-right">Amount</th>
                <th>Status</th>
                <th>Note</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows === null && <tr><td colSpan={7} className="empty-state">Loading…</td></tr>}
              {rows && shown.length === 0 && <tr><td colSpan={7} className="empty-state">{rows.length === 0 ? 'No payables yet. Click “+ Add payable” to start.' : 'Nothing matches these filters.'}</td></tr>}
              {shown.map((r) => {
                const overdue = r.status === 'Unpaid' && r.check_date && r.check_date < today;
                return (
                  <tr key={r.id} className={r.status === 'Paid' ? 'pay-row-paid' : ''}>
                    <td className="nowrap">
                      {r.check_date ? fdate(r.check_date) : '—'}
                      {overdue && <span className="badge badge-danger pay-overdue">Overdue</span>}
                    </td>
                    <td><strong>{r.payee}</strong></td>
                    <td><span className="pay-cat">{r.category}</span></td>
                    <td className="num text-right">{peso(r.amount)}</td>
                    <td>
                      <button type="button" className={`badge pay-status ${r.status === 'Paid' ? 'badge-success' : 'badge-warning'}`} onClick={() => toggleStatus(r)} title={r.status === 'Paid' ? 'Click to mark Unpaid' : 'Click to mark Paid'}>
                        {r.status}
                      </button>
                    </td>
                    <td className="pay-note">{r.note || ''}</td>
                    <td className="nowrap">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setFlash(null); setForm({ ...BLANK, ...r, amount: String(Number(r.amount)), note: r.note || '', check_date: r.check_date || '' }); }}>Edit</button>{' '}
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(r)}>Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {rows && shown.length > 0 && (
              <tfoot>
                <tr className="pay-total">
                  <td colSpan={3}>Total of {shown.length} shown</td>
                  <td className="num text-right">{peso(sumOf(shown))}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>


      {form && (
        <div className="pm-backdrop" onMouseDown={(ev) => { if (ev.target === ev.currentTarget && !busy) setForm(null); }}>
          <form className="pm-card settle-card pay-modal" onSubmit={submit}>
            <h3>{form.id ? 'Edit payable' : 'Add payable'}</h3>
            <div className="form-group"><label>Payee / name</label><PayeeInput autoFocus required value={form.payee} onChange={(v) => setForm({ ...form, payee: v })} category={form.category} titleNames={titleNames} placeholder="e.g. ALPHAONE MEDICAL AND LABORATORY SUPPLIES" /></div>
            <div className="form-grid">
              <div className="form-group"><label>Amount</label><MoneyInput required value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} placeholder="0.00" /></div>
              <div className="form-group"><label>Check date</label><LongDateInput value={form.check_date} onChange={(v) => setForm({ ...form, check_date: v })} /></div>
              <div className="form-group"><label>Account title</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {[...new Set([...categories, form.category])].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group"><label>Status</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  <option>Unpaid</option><option>Paid</option>
                </select>
              </div>
            </div>
            <div className="form-group"><label>Note (optional)</label><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. CASH, no check yet" /></div>
            <div className="settle-actions">
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setForm(null)}>Cancel</button>
              <button type="submit" className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}