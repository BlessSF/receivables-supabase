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
  const [onlyWith, setOnlyWith] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let live = true;
    api.getDiscounts({ group, type: 'all', from, to }).then((r) => { if (live) { setData(r.data); setErr(''); } }).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [group, from, to]);

  const preset = (kind) => {
    const now = new Date();
    if (kind === 'today') { setFrom(ymd(now)); setTo(ymd(now)); setGroup('day'); }
    else if (kind === 'month') { setFrom(ymd(new Date(now.getFullYear(), now.getMonth(), 1))); setTo(ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0))); setGroup('day'); }
    else if (kind === 'year') { setFrom(`${now.getFullYear()}-01-01`); setTo(`${now.getFullYear()}-12-31`); setGroup('month'); }
    else { setFrom(''); setTo(''); setGroup('month'); }
  };
  const activePreset = (() => {
    const now = new Date();
    if (!from && !to) return 'all';
    if (from === ymd(now) && to === ymd(now)) return 'today';
    if (from === ymd(new Date(now.getFullYear(), now.getMonth(), 1)) && to === ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0))) return 'month';
    if (from === `${now.getFullYear()}-01-01` && to === `${now.getFullYear()}-12-31`) return 'year';
    return '';
  })();
  const maxSeries = useMemo(() => Math.max(1, ...(data?.series || []).map((x) => x.total)), [data]);

  if (err) return <div className="flash flash-error">{err}</div>;
  if (!data) return <div className="loading-state">Loading discounts…</div>;

  const pct = (v, total) => (total > 0 ? Math.round((v / total) * 1000) / 10 : 0);
  const CompanyTable = ({ title, rows: all, total, kind }) => {
    const rows = onlyWith ? all.filter((r) => r.total > 0) : all;
    const withDisc = all.filter((r) => r.total > 0).length;
    return (
    <div className="panel disc-panel">
      <div className={`disc-ph ${kind}`}><div><h2>{title}</h2><span>{withDisc} of {all.length} with a discount</span></div><strong className="num">{peso(total)}</strong></div>
      {rows.length === 0 ? <div className="disc-none">{all.length === 0 ? 'None yet.' : 'No discounts for this filter.'}</div> : (
        <div className="table-wrap">
          <table className="data-table disc-table">
            <thead><tr><th>Name</th><th className="text-right">Entries</th><th className="text-right">Share</th><th className="text-right">Total Discount</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.total > 0 ? '' : 'disc-zero'}>
                  <td><Link className="rep-link" to={`/ledger?company_id=${r.id}`} title="Open this account's ledger">{r.name}</Link></td>
                  <td className="text-right num">{r.entries}</td>
                  <td className="text-right num disc-share">{r.total > 0 ? <span>{pct(r.total, total)}%</span> : <em>—</em>}</td>
                  <td className="text-right num disc-amt">{peso(r.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td>Total</td><td className="text-right num">{rows.reduce((t, r) => t + r.entries, 0)}</td><td /><td className="text-right num disc-amt">{peso(total)}</td></tr></tfoot>
          </table>
        </div>
      )}
    </div>
    );
  };

  const periodName = group === 'day' ? 'day' : group === 'month' ? 'month' : 'year';
  return (
    <div className="disc-page">
      <div className="page-header">
        <div>
          <h1>Discounts</h1>
          <div className="subtitle">Discounts given, per HMO and per company charge, by day, month or year</div>
        </div>
      </div>

      <div className="disc-filters">
        <div className="disc-seg" role="group" aria-label="Group by">
          {[['day', 'Day'], ['month', 'Month'], ['year', 'Year']].map(([k, label]) => (
            <button key={k} type="button" className={group === k ? 'on' : ''} onClick={() => setGroup(k)}>{label}</button>
          ))}
        </div>
        <label><span>From</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label><span>To</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="disc-check"><input type="checkbox" checked={onlyWith} onChange={(e) => setOnlyWith(e.target.checked)} /><span>Only those with a discount</span></label>
        <div className="disc-presets" role="group" aria-label="Quick range">
          {[['today', 'Today'], ['month', 'This month'], ['year', 'This year'], ['all', 'All time']].map(([k, label]) => (
            <button key={k} type="button" className={activePreset === k ? 'on' : ''} onClick={() => preset(k)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="disc-kpis">
        <div className="disc-kpi main">
          <span>Total discount</span>
          <strong>{peso(data.total)}</strong>
          <small>{data.count} entr{data.count === 1 ? 'y' : 'ies'} with a discount</small>
        </div>
        <div className="disc-kpi">
          <span>HMOs</span>
          <strong>{peso(data.hmo_total)}</strong>
          <small>{pct(data.hmo_total, data.total)}% of the total</small>
        </div>
        <div className="disc-kpi">
          <span>Company Charges</span>
          <strong>{peso(data.charge_total)}</strong>
          <small>{pct(data.charge_total, data.total)}% of the total</small>
        </div>
      </div>

      <div className="disc-accounts">
        <CompanyTable title="HMOs" kind="hmo" rows={data.hmos} total={data.hmo_total} />
        <CompanyTable title="Company Charges" kind="charge" rows={data.charges} total={data.charge_total} />
      </div>
      <div className="disc-period-wrap">
        <div className="panel disc-panel">
          <div className="disc-ph"><h2>By {periodName}</h2><span>{data.series.length} {periodName}{data.series.length === 1 ? '' : 's'}</span></div>
          {data.series.length === 0 ? <div className="disc-none">No discounts for this filter.</div> : (
            <div className="table-wrap">
              <table className="data-table disc-table">
                <thead><tr><th>{periodName[0].toUpperCase() + periodName.slice(1)}</th><th className="text-right">Total Discount</th></tr></thead>
                <tbody>
                  {data.series.map((x) => (
                    <tr key={x.key}>
                      <td>
                        <div className="disc-period">{seriesLabel(x.key, data.group)}</div>
                        <div className="disc-bar"><span style={{ width: `${Math.max(2, (x.total / maxSeries) * 100)}%` }} /></div>
                      </td>
                      <td className="text-right num disc-amt">{peso(x.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      <p className="disc-note">A discount is counted on the entry's payment date (its billing date while nothing is paid yet).</p>
    </div>
  );
}