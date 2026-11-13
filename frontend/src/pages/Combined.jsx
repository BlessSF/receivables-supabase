import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { peso, fdate } from '../utils';
import LongDateInput from '../LongDateInput';

// One HMO, both branches: this system's billings and the other branch's, side by side, each branch with its own total. View only.
export default function Combined() {
  const [meta, setMeta] = useState(null); // { self_name, peer_name, peer_connected, names }
  const [name, setName] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [showSet, setShowSet] = useState(false); // admin: "Hidden HMOs" settings panel
  const [hidden, setHidden] = useState([]); // names ticked as hidden
  const [filter, setFilter] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    api.getCombinedNames().then((r) => setMeta(r.data)).catch((e) => setErr(e.message));
  }, []);

  useEffect(() => {
    if (!name) { setData(null); return undefined; }
    let live = true;
    setBusy(true); setErr('');
    api.getCombinedHmo(name, from, to)
      .then((r) => { if (live) setData(r.data); })
      .catch((e) => { if (live) setErr(e.message); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [name, from, to]);

  const exportHref = useMemo(() => {
    const q = new URLSearchParams({ type: 'combined', name });
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    return `/export_xlsx.php?${q.toString()}`;
  }, [name, from, to]);

  function openSettings() {
    setHidden(meta.names.filter((n) => n.excluded).map((n) => n.name)); setFilter(''); setNote(''); setShowSet(true);
  }
  async function saveHidden() {
    setErr(''); setNote('');
    try {
      await api.saveCombinedExcluded(hidden);
      const r = await api.getCombinedNames(); setMeta(r.data);
      if (hidden.some((h) => h.toUpperCase().replace(/\s+/g, ' ').trim() === name.toUpperCase().replace(/\s+/g, ' ').trim())) setName('');
      setNote('Saved.'); setTimeout(() => setNote(''), 2200);
    } catch (e) { setErr(e.message); }
  }

  if (!meta && !err) return <div className="loading-state">Loading…</div>;
  if (!meta) return <div className="flash flash-error">{err}</div>;

  const visible = meta.names.filter((n) => !n.excluded);
  const hiddenCount = meta.names.filter((n) => n.excluded).length;
  const where = (n) => (n.self && n.peer ? '' : n.self ? ` (${meta.self_name} only)` : ` (${meta.peer_name} only)`);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>HMO · Both Branches</h1>
          <div className="subtitle">{meta.self_name} and {meta.peer_name} billings for one HMO, shown separately (the two are not added together). View only: to change an entry, use that branch's own Ledger.</div>
        </div>
        <div className="cb-actions">
          {meta.can_edit && <button type="button" className="btn btn-secondary" onClick={() => (showSet ? setShowSet(false) : openSettings())}>Hidden HMOs{hiddenCount ? ` (${hiddenCount})` : ''}</button>}
          {name && <a className="btn btn-secondary" href={exportHref}>Export XLSX</a>}
        </div>
      </div>

      {!meta.peer_connected && (
        <div className="flash flash-warning" role="status">
          {meta.peer_name} is not connected yet, so only {meta.self_name} is shown. An admin needs to add the other branch's database link (PEER_DATABASE_URL) in the hosting settings.
        </div>
      )}
      {meta.peer_error && <div className="flash flash-warning" role="status">{meta.peer_error} Only {meta.self_name} is shown for now.</div>}
      {err && <div className="flash flash-error">{err}</div>}

      {meta.can_edit && showSet && (
        <div className="panel cb-excl">
          <div className="cb-excl-head">
            <div>
              <h2>Hidden HMOs</h2>
              <p>Choose the HMOs you do not want on this page. They disappear from the list and the Excel export. Only admins can change this; nothing else in the system is affected.</p>
            </div>
            <span className={`cb-excl-count${hidden.length ? ' on' : ''}`}>{hidden.length} hidden</span>
          </div>
          <div className="cb-excl-tools">
            <div className="cb-excl-find">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
              <input type="text" placeholder="Search HMO…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Search HMO" />
            </div>
            {hidden.length > 0 && <button type="button" className="cb-excl-link" onClick={() => setHidden([])}>Show all again</button>}
          </div>
          <div className="cb-excl-list">
            {meta.names.filter((n) => !filter || n.name.toLowerCase().includes(filter.toLowerCase())).map((n) => {
              const on = hidden.includes(n.name);
              return (
                <label key={n.name} className={`cb-excl-item${on ? ' on' : ''}`}>
                  <input type="checkbox" checked={on}
                    onChange={(e) => setHidden((h) => (e.target.checked ? [...h, n.name] : h.filter((x) => x !== n.name)))} />
                  <span className="cb-excl-name">{n.name}</span>
                  <span className="cb-excl-tag">{on ? 'Hidden' : 'Shown'}</span>
                </label>
              );
            })}
            {meta.names.filter((n) => !filter || n.name.toLowerCase().includes(filter.toLowerCase())).length === 0 && <div className="cb-excl-empty">No HMO matches “{filter}”.</div>}
          </div>
          <div className="cb-excl-foot">
            <button type="button" className="btn btn-primary" onClick={saveHidden}>Save changes</button>
            <button type="button" className="btn btn-secondary" onClick={() => setShowSet(false)}>Close</button>
            <span className="cb-excl-note">{note}</span>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="range-filter">
          <div className="form-group">
            <label htmlFor="cb-hmo">HMO</label>
            <select id="cb-hmo" value={name} onChange={(e) => setName(e.target.value)}>
              <option value="">Choose an HMO…</option>
              {visible.map((n) => <option key={n.name} value={n.name}>{n.name}{where(n)}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Billing date from</label>
            <LongDateInput value={from} onChange={setFrom} ariaLabel="Billing date from" placeholder="Any" />
          </div>
          <div className="form-group">
            <label>to</label>
            <LongDateInput value={to} onChange={setTo} ariaLabel="Billing date to" placeholder="Any" />
          </div>
          {(from || to) && <div className="form-group"><label>&nbsp;</label><button type="button" className="btn btn-secondary" onClick={() => { setFrom(''); setTo(''); }}>Clear dates</button></div>}
        </div>
      </div>

      {!name && <div className="panel"><div className="empty-state">Choose an HMO to see its billings from both branches.</div></div>}
      {name && busy && !data && <div className="loading-state">Loading…</div>}

      {name && data && (
        <>
          <div className="kpi-grid">
            {data.branches.map((b, bi) => (
              <div key={bi} className="kpi-card accent-red">
                <div className="kpi-label">{b.label} · balance</div>
                <div className="kpi-value">{peso(b.total.balance)}</div>
                <div className="kpi-sub">Billed {peso(b.total.amount)} · Paid {peso(b.total.paid)} · {b.total.count} billing{b.total.count === 1 ? '' : 's'}</div>
              </div>
            ))}
          </div>

          <div className="panel" style={{ opacity: busy ? 0.6 : 1 }}>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Billing date</th><th>Covered period</th><th>SOA #</th>
                    <th className="text-right">Amount</th><th className="text-right">Receivable</th><th className="text-right">Paid</th><th className="text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.branches.map((b, bi) => (
                    <BranchRows key={bi} b={b} offline={bi === 1 && !data.peer_connected} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="cb-note">Amount is the billed amount. Receivable is the Amount after Tax W/H, surcharge and rebate. Balance = Receivable − Paid.</div>
          </div>
        </>
      )}
    </div>
  );
}

function BranchRows({ b, offline }) {
  return (
    <>
      <tr className="cb-branch"><td colSpan={7}>{b.label}{offline ? ' · not connected' : ''}</td></tr>
      {b.rows.length === 0 && <tr><td colSpan={7} className="cb-none">{offline ? 'Not connected yet.' : 'No billings for this HMO in this branch.'}</td></tr>}
      {b.rows.map((r) => (
        <tr key={r.id}>
          <td>{r.billing_date ? fdate(r.billing_date) : ''}</td>
          <td>{r.covered}</td>
          <td>{r.soa_number}</td>
          <td className="text-right">{peso(r.amount)}</td>
          <td className="text-right">{peso(r.receivable)}</td>
          <td className="text-right">{peso(r.paid)}</td>
          <td className="text-right">{peso(r.balance)}</td>
        </tr>
      ))}
      <tr className="cb-sub">
        <td colSpan={3}>{b.label} total · {b.total.count} billing{b.total.count === 1 ? '' : 's'}</td>
        <td className="text-right">{peso(b.total.amount)}</td>
        <td className="text-right">{peso(b.total.receivable)}</td>
        <td className="text-right">{peso(b.total.paid)}</td>
        <td className="text-right">{peso(b.total.balance)}</td>
      </tr>
    </>
  );
}