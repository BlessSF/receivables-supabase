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
  const [pickOpen, setPickOpen] = useState(true); // the "Select months" panel
  const [hidden, setHidden] = useState(() => new Set()); // All months: columns the user switched off (they are not shown, printed or exported)

  // Printing: whatever is selected is shrunk to fit one page width (landscape; A3 when it is too wide for A4)
  useEffect(() => {
    let style = null;
    const before = () => {
      const t = document.querySelector('.report-table');
      if (!t) return;
      t.style.zoom = '';
      const natural = t.scrollWidth;
      const A4 = 1050, A3 = 1500; // printable width in CSS px, landscape, 8mm margins
      const paper = natural * 0.5 > A4 ? 'A3' : 'A4';
      const avail = paper === 'A3' ? A3 : A4;
      t.style.zoom = String(Math.min(1, avail / natural));
      style = document.createElement('style');
      style.textContent = `@page { size: ${paper} landscape; margin: 8mm; }`;
      document.head.appendChild(style);
    };
    const after = () => {
      const t = document.querySelector('.report-table');
      if (t) t.style.zoom = '';
      if (style) { style.remove(); style = null; }
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after); after(); };
  }, []);

  useEffect(() => {
    let live = true;
    setBusy(true);
    api.getMonthlyReport({ month, terms })
      .then((r) => { if (live) { setData(r.data); setErr(''); } })
      .catch((e) => { if (live) setErr(e.message); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [month, terms]);

  const allMonths = month.endsWith('-all'); // "All months": the whole year in one report
  const [yy, mmRaw] = month.split('-');
  const mm = allMonths ? 0 : Number(mmRaw);
  const yyN = Number(yy);
  const years = useMemo(() => {
    const now = new Date().getFullYear();
    const lo = Math.min(now - 3, yyN);
    const hi = Math.max(now + 2, yyN);
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  }, [yyN]);
  const setPart = (y, m) => setMonth(m === 0 ? `${y}-all` : `${y}-${String(m).padStart(2, '0')}`);

  if (err && !data) return <div className="flash flash-error">{err}</div>;
  if (!data) return <div className="loading-state">Loading report…</div>;

  const allBlocks = data.block_defs; // OVERDUE | this month | next month -- or OVERDUE | Jan ... Dec | after, for All months
  const blocks = data.all_year ? allBlocks.filter((b) => !hidden.has(b.key)) : allBlocks;
  const shortName = (b) => (b.key === 'overdue' ? 'Overdue' : b.key === 'after' ? `After ${data.all_year}` : MONTHS[Number(b.key.slice(1)) - 1].slice(0, 3));
  const toggle = (key) => setHidden((h) => { const n = new Set(h); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const exportHref = `/export_xlsx.php?type=monthly&month=${month}&terms=${terms}${data.all_year && hidden.size ? `&cols=${blocks.map((b) => b.key).join(',')}` : ''}`;
  // With some months switched off, companies that have nothing in the remaining columns are left out
  const companies = data.all_year && hidden.size ? data.companies.filter((c) => blocks.some((b) => c[b.key].length)) : data.companies;
  const empty = companies.length === 0;

  return (
    <div className="report-page">
      <div className="page-header">
        <div>
          <h1>Reports by Month</h1>
          <div className="subtitle">
            Pick a month (Jan–Dec), or All months for the whole year: the report builds itself with what is overdue and who is due.
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
            <label htmlFor="rep-year">Year</label>
            <select id="rep-year" value={yyN} onChange={(e) => setPart(Number(e.target.value), mm)} aria-label="Year" style={{ minWidth: 100 }}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="rep-terms">Payment terms</label>
            <select id="rep-terms" value={terms} onChange={(e) => setTerms(Number(e.target.value))}>
              {TERMS.map((t) => <option key={t} value={t}>{t === 0 ? 'Due in the Period month' : `Due ${t} month${t === 1 ? '' : 's'} after the Period`}</option>)}
            </select>
          </div>
          <div className="form-group"><label>&nbsp;</label>
            <button type="button" className={`btn btn-secondary${data.all_year && pickOpen ? ' active' : ''}`} aria-expanded={!!data.all_year && pickOpen}
              onClick={() => { if (data.all_year) setPickOpen((o) => !o); else { setPickOpen(true); setPart(yyN, 0); } }}
              title="Choose which months are shown, printed and exported (switches to All months)">
              Select months{data.all_year ? ` (${allBlocks.length - hidden.size}/${allBlocks.length})` : ''}
            </button>
          </div>
          {busy && <span className="table-toolbar-count" style={{ alignSelf: 'center' }}>Updating…</span>}
        </div>
      </div>

      {err && <div className="flash flash-error">{err}</div>}

      <div className="month-chips report-chips" role="tablist" aria-label="Report month">
        <button type="button" role="tab" aria-selected={allMonths} className={allMonths ? 'on' : ''}
          title={`Everything unpaid that is due in ${yy} (Jan - Dec), plus what is overdue before it and what falls due after it`} onClick={() => setPart(yyN, 0)}>All months</button>
        {MONTHS.map((name, i) => (
          <button key={name} type="button" role="tab" aria-selected={mm === i + 1} className={mm === i + 1 ? 'on' : ''}
            title={`Who is overdue and who is due in ${name} ${yy}`} onClick={() => setPart(yyN, i + 1)}>
            {name.slice(0, 3)}
          </button>
        ))}
      </div>

      {data.all_year && pickOpen && (
        <div className="panel col-picker report-chips">
          <div className="col-picker-head">
            <strong>Months to show, print and export</strong>
            <span className="col-picker-links">
              <button type="button" className="link-btn" onClick={() => setHidden(new Set())}>All</button>
              <button type="button" className="link-btn" onClick={() => setHidden(new Set(allBlocks.map((b) => b.key)))}>None</button>
              <button type="button" className="link-btn" onClick={() => setPickOpen(false)}>Done</button>
            </span>
          </div>
          {blocks.length > 6 && <div className="col-picker-hint">Printing fits everything on one page width. With more than 6 columns the text gets small: tick fewer months for bigger print.</div>}
          <div className="month-chips">
            {allBlocks.map((b) => (
              <button key={b.key} type="button" aria-pressed={!hidden.has(b.key)} className={hidden.has(b.key) ? '' : 'on'} onClick={() => toggle(b.key)}
                title={b.title}>{shortName(b)}</button>
            ))}
          </div>
        </div>
      )}

      {data.no_period.count > 0 && (
        <div className="flash report-warn">
          <strong>{data.no_period.count} unpaid entr{data.no_period.count === 1 ? 'y' : 'ies'} ({peso(data.no_period.total)}) {data.no_period.count === 1 ? 'is' : 'are'} not in this report</strong>
          {' '}because {data.no_period.count === 1 ? 'it has' : 'they have'} no Period Date{readOnly ? '.' : ' yet. Choose the month in the Ledger\u2019s Period Date column and they will appear here.'}
        </div>
      )}

      <div className="panel report-panel">
        <div className="report-scroll table-wrap">
          {blocks.length === 0 ? <div className="empty-state">Pick at least one month above to show.</div> : <table className={`report-table${data.all_year ? ' report-wide' : ''}`}>
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
                  <Fragment key={b.key}><th>SOA NUMBER</th><th>COVERED PERIOD</th><th className="text-right">REMAINING BALANCE</th></Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {empty && (
                <tr><td colSpan={blocks.length * 4} className="empty-state">{data.all_year ? `Nothing unpaid is placed in ${data.all_year}.` : `Nothing is overdue or due in ${data.month_label} or ${data.next_label}.`}</td></tr>
              )}
              {companies.map((c) => {
                const n = Math.max(1, ...blocks.map((b) => c[b.key].length));
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
          </table>}
        </div>
        <div className="report-foot">
          <div>
            <div className="report-prepared-label">Prepared by</div>
            <div className="report-prepared-name">{user?.full_name || user?.username}</div>
          </div>
          {!data.all_year && data.later.count > 0 && (
            <div className="report-later">
              Not shown: {data.later.count} entr{data.later.count === 1 ? 'y' : 'ies'} ({peso(data.later.total)}) due after {data.next_label}.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}