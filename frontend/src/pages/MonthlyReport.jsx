import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { MONTHS, money, peso, isExecutive } from '../utils';

// Same layout as the monthly Excel sheet:
//   Company | OVERDUE | DUE FOR <month> | DUE FOR <next month>
// each block showing SOA number, month (period) and remaining balance.
const TERMS = [0, 1, 2, 3, 4, 5, 6];

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function Block({ item, readOnly, companyId }) {
  if (!item) return (<><td /><td /><td /></>);
  return (
    <>
      <td className="rep-center">
        {item.soa_number
          ? (readOnly
            ? item.soa_number
            : <Link className="rep-link" to={`/ledger?company_id=${companyId}&entry=${item.id}`} title="Open this entry in the Ledger">{item.soa_number}</Link>)
          : <span className="zero">—</span>}
      </td>
      <td className="rep-center">{item.period || <span className="zero">—</span>}</td>
      <td className="text-right num">{money(item.balance)}</td>
    </>
  );
}

export default function MonthlyReport() {
  const { user } = useAuth();
  const readOnly = isExecutive(user);
  const [month, setMonth] = useState(currentMonth);
  const [terms, setTerms] = useState(3);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setBusy(true);
    api.getMonthlyReport({ month, terms })
      .then((r) => { if (live) { setData(r.data); setErr(''); } })
      .catch((e) => { if (live) setErr(e.message); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [month, terms]);

  const [yy, mm] = month.split('-').map(Number);
  const years = useMemo(() => {
    const now = new Date().getFullYear();
    const lo = Math.min(now - 3, yy);
    const hi = Math.max(now + 2, yy);
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  }, [yy]);
  const setPart = (y, m) => setMonth(`${y}-${String(m).padStart(2, '0')}`);

  if (err && !data) return <div className="flash flash-error">{err}</div>;
  if (!data) return <div className="loading-state">Loading report…</div>;

  const blocks = [
    { key: 'overdue', title: 'OVERDUE', cls: 'rep-red', total: 'OVERDUE TOTAL' },
    { key: 'due1', title: `DUE FOR ${data.month_name.toUpperCase()} ${data.month.slice(0, 4)}`, cls: 'rep-blue', total: `${data.month_name.toUpperCase()} DUE TOTAL:` },
    { key: 'due2', title: `DUE FOR ${data.next_name.toUpperCase()} ${data.next_month.slice(0, 4)}`, cls: 'rep-blue', total: `${data.next_name.toUpperCase()} DUE TOTAL:` },
  ];
  const exportHref = `/export_xlsx.php?type=monthly&month=${month}&terms=${terms}`;
  const empty = data.companies.length === 0;

  return (
    <div className="report-page">
      <div className="page-header">
        <div>
          <h1>Reports by Month</h1>
          <div className="subtitle">
            Unpaid balances per company: what is overdue and what falls due in the two months you pick.
            An entry is due on its own Due Date if it has one, otherwise {terms === 0 ? 'in its Period Date month' : `${terms} month${terms === 1 ? '' : 's'} after its Period Date`}.
          </div>
        </div>
        <div className="report-actions" style={{ display: 'flex', gap: 8 }}>
          <a className="btn btn-secondary" href={exportHref}>Export XLSX</a>
          <button type="button" className="btn btn-secondary" onClick={() => window.print()}>Print</button>
        </div>
      </div>

      <div className="panel report-filters">
        <div className="filter-bar">
          <div className="form-group">
            <label htmlFor="rep-month">Report month</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <select id="rep-month" value={mm} onChange={(e) => setPart(yy, Number(e.target.value))} aria-label="Month">
                {MONTHS.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
              </select>
              <select value={yy} onChange={(e) => setPart(Number(e.target.value), mm)} aria-label="Year" style={{ minWidth: 90 }}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="rep-terms">Payment terms</label>
            <select id="rep-terms" value={terms} onChange={(e) => setTerms(Number(e.target.value))}>
              {TERMS.map((t) => <option key={t} value={t}>{t === 0 ? 'Due in the Period month' : `Due ${t} month${t === 1 ? '' : 's'} after the Period`}</option>)}
            </select>
          </div>
          {busy && <span className="table-toolbar-count" style={{ alignSelf: 'center' }}>Updating…</span>}
        </div>
      </div>

      {err && <div className="flash flash-error">{err}</div>}
      {data.no_period.count > 0 && (
        <div className="flash report-warn">
          <strong>{data.no_period.count} unpaid entr{data.no_period.count === 1 ? 'y' : 'ies'} ({peso(data.no_period.total)}) {data.no_period.count === 1 ? 'is' : 'are'} not in this report</strong>
          {' '}because {data.no_period.count === 1 ? 'it has' : 'they have'} no Period Date{readOnly ? '.' : ' yet. Choose the month in the Ledger\u2019s Period Date column and they will appear here.'}
        </div>
      )}

      <div className="panel report-panel">
        <div className="report-scroll">
          <table className="report-table">
            <colgroup>
              <col className="rep-col-company" />
              {blocks.map((b, i) => (
                <Fragment key={b.key}>
                  <col className="rep-col-soa" /><col className="rep-col-month" /><col className="rep-col-bal" />
                  {i < blocks.length - 1 && <col className="rep-col-gap" />}
                </Fragment>
              ))}
            </colgroup>
            <thead>
              <tr>
                <th rowSpan={2} className="rep-company-head">COMPANY</th>
                {blocks.map((b, i) => (
                  <Fragment key={b.key}>
                    <th colSpan={3} className={`rep-band ${b.cls}`}>{b.title}</th>
                    {i < blocks.length - 1 && <th rowSpan={2} className="rep-gap" />}
                  </Fragment>
                ))}
              </tr>
              <tr className="rep-sub">
                {blocks.map((b) => (
                  <Fragment key={b.key}><th>SOA NUMBER</th><th>MONTH</th><th className="text-right">REMAINING BALANCE</th></Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {empty && (
                <tr><td colSpan={12} className="empty-state">Nothing is overdue or due in {data.month_label} or {data.next_label}.</td></tr>
              )}
              {data.companies.map((c) => {
                const n = Math.max(1, c.overdue.length, c.due1.length, c.due2.length);
                return Array.from({ length: n }, (_, i) => (
                  <tr key={`${c.company_id}-${i}`} className={i === 0 ? 'rep-first' : ''}>
                    {i === 0 && (
                      <td rowSpan={n} className="rep-company">
                        {readOnly ? c.company : <Link className="rep-link" to={`/ledger?company_id=${c.company_id}`} title="Open this company's ledger">{c.company}</Link>}
                      </td>
                    )}
                    {blocks.map((b, bi) => (
                      <Fragment key={b.key}>
                        <Block item={c[b.key][i]} readOnly={readOnly} companyId={c.company_id} />
                        {bi < blocks.length - 1 && <td className="rep-gap" />}
                      </Fragment>
                    ))}
                  </tr>
                ));
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="rep-foot-space" />
                {blocks.map((b, i) => (
                  <Fragment key={b.key}>
                    <td colSpan={2} className={`rep-total ${b.cls}`}>{b.total}</td>
                    <td className={`rep-total rep-total-amt text-right num ${b.cls}`}>{money(data.totals[b.key])}</td>
                    {i < blocks.length - 1 && <td className="rep-gap" />}
                  </Fragment>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="report-foot">
          <div>
            <div className="report-prepared-label">Prepared by</div>
            <div className="report-prepared-name">{user?.full_name || user?.username}</div>
          </div>
          {data.later.count > 0 && (
            <div className="report-later">
              Not shown: {data.later.count} entr{data.later.count === 1 ? 'y' : 'ies'} ({peso(data.later.total)}) due after {data.next_label}.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}