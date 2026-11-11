import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { peso, fdate } from '../utils';
import LongDateInput from '../LongDateInput';

// One HMO, both branches: this system's billings and the other branch's, side by side, with a combined total. View only.
export default function Combined() {
  const [meta, setMeta] = useState(null); // { self_name, peer_name, peer_connected, names }
  const [name, setName] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

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

  if (!meta && !err) return <div className="loading-state">Loading…</div>;
  if (!meta) return <div className="flash flash-error">{err}</div>;

  const where = (n) => (n.self && n.peer ? '' : n.self ? ` (${meta.self_name} only)` : ` (${meta.peer_name} only)`);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>HMO · Both Branches</h1>
          <div className="subtitle">{meta.self_name} and {meta.peer_name} billings for one HMO, with a combined total. View only: to change an entry, use that branch's own Ledger.</div>
        </div>
        {name && <a className="btn btn-secondary" href={exportHref}>Export XLSX</a>}
      </div>

      {!meta.peer_connected && (
        <div className="flash flash-warning" role="status">
          {meta.peer_name} is not connected yet, so only {meta.self_name} is shown. An admin needs to add the other branch's database link (PEER_DATABASE_URL) in the hosting settings.
        </div>
      )}
      {meta.peer_error && <div className="flash flash-warning" role="status">{meta.peer_error} Only {meta.self_name} is shown for now.</div>}
      {err && <div className="flash flash-error">{err}</div>}

      <div className="panel">
        <div className="range-filter">
          <div className="form-group">
            <label htmlFor="cb-hmo">HMO</label>
            <select id="cb-hmo" value={name} onChange={(e) => setName(e.target.value)}>
              <option value="">Choose an HMO…</option>
              {meta.names.map((n) => <option key={n.name} value={n.name}>{n.name}{where(n)}</option>)}
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
            <div className="kpi-card"><div className="kpi-label">Combined billed</div><div className="kpi-value">{peso(data.combined.amount)}</div><div className="kpi-sub">{data.combined.count} billing{data.combined.count === 1 ? '' : 's'}</div></div>
            <div className="kpi-card"><div className="kpi-label">Combined paid</div><div className="kpi-value">{peso(data.combined.paid)}</div><div className="kpi-sub">Receivable {peso(data.combined.receivable)}</div></div>
            <div className="kpi-card accent-red"><div className="kpi-label">Combined balance</div><div className="kpi-value">{peso(data.combined.balance)}</div><div className="kpi-sub">still unpaid</div></div>
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
                  <tr className="cb-grand">
                    <td colSpan={3}>{data.name} · both branches ({data.combined.count} billing{data.combined.count === 1 ? '' : 's'})</td>
                    <td className="text-right">{peso(data.combined.amount)}</td>
                    <td className="text-right">{peso(data.combined.receivable)}</td>
                    <td className="text-right">{peso(data.combined.paid)}</td>
                    <td className="text-right">{peso(data.combined.balance)}</td>
                  </tr>
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