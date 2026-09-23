import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { peso } from '../utils';

// Quick picks. Custom From/To boxes can express any other range.
const PRESETS = [
  { label: 'All', from: '', to: '' },
  { label: '1–30', from: '1', to: '30' },
  { label: '31–60', from: '31', to: '60' },
  { label: '61–90', from: '61', to: '90' },
  { label: '91 and up', from: '91', to: '' },
];

function describeRange(from, to) {
  const f = from !== '' ? Number(from) : null;
  const t = to !== '' ? Number(to) : null;
  if (f === null && t === null) return '';
  if (f !== null && t !== null) return `${Math.min(f, t)}–${Math.max(f, t)} days overdue`;
  if (f !== null) return `${f} days overdue or more`;
  return `up to ${t} days overdue`;
}

export default function Aging() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    const id = ++reqId.current;
    setBusy(true);
    const t = setTimeout(() => {
      api.getAging({ days_from: from, days_to: to })
        .then((r) => { if (id === reqId.current) { setData(r.data); setErr(''); } })
        .catch((e) => { if (id === reqId.current) setErr(e.message); })
        .finally(() => { if (id === reqId.current) setBusy(false); });
    }, 300);
    return () => clearTimeout(t);
  }, [from, to]);

  if (err && !data) return <div className="flash flash-error">{err}</div>;
  if (!data) return <div className="loading-state">Loading aging report…</div>;

  const rangeActive = from !== '' || to !== '';
  const rangeText = describeRange(from, to);
  const exportQs = rangeActive
    ? `&days_from=${encodeURIComponent(from)}&days_to=${encodeURIComponent(to)}`
    : '';

  const allLabels = Object.keys(data.buckets);
  // With a custom range on, drop columns that have nothing in them.
  const bucketLabels = rangeActive
    ? allLabels.filter((l) => data.buckets[l].count > 0)
    : allLabels;

  const matchCount = allLabels.reduce((s, l) => s + data.buckets[l].count, 0);
  const matchTotal = allLabels.reduce((s, l) => s + data.buckets[l].total, 0);

  const isPreset = (p) => p.from === from && p.to === to;
  function clear() { setFrom(''); setTo(''); }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Aging Report</h1>
          <div className="subtitle">Outstanding receivables grouped by days overdue (due date = explicit due date, or billing date + {data.grace_days} days)</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a className="btn btn-secondary" href={`/export_csv.php?type=aging${exportQs}`}>Export CSV</a>
          <a className="btn btn-secondary" href={`/export_xlsx.php?type=aging${exportQs}`}>Export XLSX</a>
        </div>
      </div>

      <div className="panel">
        <div className="range-filter">
          <div className="form-group">
            <label>Days overdue</label>
            <div className="range-inputs">
              <input
                type="number" min="0" inputMode="numeric" placeholder="From"
                aria-label="Days overdue, from" value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
              <span className="range-dash" aria-hidden="true">to</span>
              <input
                type="number" min="0" inputMode="numeric" placeholder="To"
                aria-label="Days overdue, to" value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Quick pick</label>
            <div className="chip-row">
              {PRESETS.map((p) => (
                <button
                  key={p.label} type="button"
                  className={`chip${isPreset(p) ? ' active' : ''}`}
                  aria-pressed={isPreset(p)}
                  onClick={() => { setFrom(p.from); setTo(p.to); }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {rangeActive && <button className="btn btn-secondary" onClick={clear}>Clear range</button>}
        </div>

        {rangeActive && (
          <div className="range-result" aria-live="polite">
            Showing <strong>{rangeText}</strong> — {matchCount} {matchCount === 1 ? 'entry' : 'entries'},{' '}
            <strong className="num">{peso(matchTotal)}</strong> outstanding{busy ? ' …' : ''}
          </div>
        )}
        {err && <div className="flash flash-error" style={{ marginTop: 14, marginBottom: 0 }}>{err}</div>}
      </div>

      <div className="kpi-grid">
        {allLabels.filter((l) => l !== 'N/A').map((label) => {
          const empty = rangeActive && data.buckets[label].count === 0;
          return (
            <div className={`kpi-card${empty ? ' is-dim' : ''}`} key={label}>
              <div className="kpi-label">{label}</div>
              <div className="kpi-value">{peso(data.buckets[label].total)}</div>
              <div className="kpi-sub">{data.buckets[label].count} {data.buckets[label].count === 1 ? 'entry' : 'entries'}</div>
            </div>
          );
        })}
      </div>

      <div className="panel">
        <h2>Outstanding balance by company and aging bucket</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Company</th>
                {bucketLabels.map((l) => <th key={l} className="text-right">{l}</th>)}
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.by_company.length === 0 && (
                <tr>
                  <td colSpan={bucketLabels.length + 2} className="empty-state">
                    {rangeActive ? `Nothing outstanding for ${rangeText}.` : 'No outstanding balances — everything is collected!'}
                  </td>
                </tr>
              )}
              {data.by_company.filter((row) => !rangeActive || row.total > 0).map((row) => (
                <tr key={row.company}>
                  <td>{row.company}</td>
                  {bucketLabels.map((l) => (
                    <td key={l} className={`text-right num${row[l] > 0 ? '' : ' zero'}`}>{row[l] > 0 ? peso(row[l]) : '—'}</td>
                  ))}
                  <td className="text-right num" style={{ fontWeight: 700 }}>{peso(row.total)}</td>
                </tr>
              ))}
            </tbody>
            {data.by_company.length > 0 && (
              <tfoot>
                <tr>
                  <td>Grand total</td>
                  {bucketLabels.map((l) => <td key={l} className="text-right num">{peso(data.buckets[l].total)}</td>)}
                  <td className="text-right num">
                    {peso(bucketLabels.reduce((s, l) => s + data.buckets[l].total, 0))}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}