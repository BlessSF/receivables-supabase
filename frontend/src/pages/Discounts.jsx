import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { peso } from '../utils';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// "2026-11" -> "November 2026", "2026-11-27" -> "November 27, 2026", "2026" -> "2026"
function seriesLabel(key, group) {
  if (group === 'year' || !/^\d{4}/.test(key)) return key;
  const [y, m, d] = key.split('-');
  return group === 'month' ? `${MONTH_NAMES[Number(m) - 1]} ${y}` : `${MONTH_NAMES[Number(m) - 1]} ${Number(d)}, ${y}`;
}

export default function Discounts() {
  const [group, setGroup] = useState('month');
  const [type, setType] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let live = true;
    api.getDiscounts({ group, type, from, to }).then((r) => { if (live) { setData(r.data); setErr(''); } }).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [group, type, from, to]);

  const preset = (kind) => {
    const now = new Date();
    if (kind === 'today') { setFrom(ymd(now)); setTo(ymd(now)); setGroup('day'); }
    else if (kind === 'month') { setFrom(ymd(new Date(now.getFullYear(), now.getMonth(), 1))); setTo(ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0))); setGroup('day'); }
    else if (kind === 'year') { setFrom(`${now.getFullYear()}-01-01`); setTo(`${now.getFullYear()}-12-31`); setGroup('month'); }
    else { setFrom(''); setTo(''); setGroup('month'); }
  };
  const maxSeries = useMemo(() => Math.max(1, ...(data?.series || []).map((x) => x.total)), [data]);

  if (err) return <div className="flash flash-error">{err}</div>;
  if (!data) return <div className="loading-state">Loading discounts…</div>;

  const CompanyTable = ({ title, rows, total }) => (
    <div className="panel">
      <h2>{title} <span className="disc-total">{peso(total)}</span></h2>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Name</th><th className="text-right">Entries</th><th className="text-right">Total Discount</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={3} className="empty-state">No discounts for this filter.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link className="rep-link" to={`/ledger?company_id=${r.id}`} title="Open this account's ledger">{r.name}</Link></td>
                <td className="text-right num">{r.entries}</td>
                <td className="text-right num" style={{ fontWeight: 600 }}>{peso(r.total)}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && <tfoot><tr><td><strong>Total</strong></td><td className="text-right num">{rows.reduce((t, r) => t + r.entries, 0)}</td><td className="text-right num"><strong>{peso(total)}</strong></td></tr></tfoot>}
        </table>
      </div>
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Discounts</h1>
          <div className="subtitle">Discounts given, per HMO and per company charge, by day, month or year</div>
        </div>
      </div>

      <div className="panel disc-filters">
        <div className="disc-seg" role="group" aria-label="Group by">
          {[['day', 'Every day'], ['month', 'Every month'], ['year', 'Every year']].map(([k, label]) => (
            <button key={k} type="button" className={group === k ? 'on' : ''} onClick={() => setGroup(k)}>{label}</button>
          ))}
        </div>
        <label>From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label>Show
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="all">HMOs and Company Charges</option>
            <option value="hmo">HMOs only</option>
            <option value="charge">Company Charges only</option>
          </select>
        </label>
        <div className="disc-presets">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => preset('today')}>Today</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => preset('month')}>This month</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => preset('year')}>This year</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => preset('all')}>All time</button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card accent-red"><div className="kpi-label">Total Discount</div><div className="kpi-value">{peso(data.total)}</div><div className="kpi-sub">{data.count} entr{data.count === 1 ? 'y' : 'ies'} with a discount</div></div>
        <div className="kpi-card"><div className="kpi-label">HMOs</div><div className="kpi-value">{peso(data.hmo_total)}</div></div>
        <div className="kpi-card"><div className="kpi-label">Company Charges</div><div className="kpi-value">{peso(data.charge_total)}</div></div>
      </div>

      <div className="panel">
        <h2>{group === 'day' ? 'Discount per day' : group === 'month' ? 'Discount per month' : 'Discount per year'}</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>{group === 'day' ? 'Day' : group === 'month' ? 'Month' : 'Year'}</th><th>&nbsp;</th><th className="text-right">Total Discount</th></tr></thead>
            <tbody>
              {data.series.length === 0 && <tr><td colSpan={3} className="empty-state">No discounts for this filter.</td></tr>}
              {data.series.map((x) => (
                <tr key={x.key}>
                  <td>{seriesLabel(x.key, data.group)}</td>
                  <td style={{ width: '45%' }}><div className="disc-bar"><span style={{ width: `${Math.max(2, (x.total / maxSeries) * 100)}%` }} /></div></td>
                  <td className="text-right num" style={{ fontWeight: 600 }}>{peso(x.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {type !== 'charge' && <CompanyTable title="HMOs" rows={data.hmos} total={data.hmo_total} />}
      {type !== 'hmo' && <CompanyTable title="Company Charges" rows={data.charges} total={data.charge_total} />}
      <div className="subtitle" style={{ color: 'var(--slate)', margin: '4px 2px 18px' }}>A discount is counted on the entry's payment date (its billing date while nothing is paid yet).</div>
    </div>
  );
}