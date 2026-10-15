import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { peso, fdate, numClass } from '../utils';
import { useAuth } from '../AuthContext';
import { isStaff } from '../utils';

// Evolving dashboard: pick Overall / Companies / HMOs, optionally one account,
// then watch it month by month, year by year, or all time. Clicking a bar, a month, a year or a
// company in the lists below drills the whole page into it.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function compact(n) {
  const v = Math.abs(Number(n) || 0);
  if (v >= 1e6) return `₱${(v / 1e6).toFixed(v >= 1e7 ? 1 : 2)}M`;
  if (v >= 1e3) return `₱${(v / 1e3).toFixed(0)}K`;
  return `₱${v.toFixed(0)}`;
}

function delta(cur, prev, prevLabel) {
  if (prev === null || prev === undefined) return null;
  if (!prev && !cur) return `same as ${prevLabel}`;
  if (!prev) return `new vs ${prevLabel}`;
  const pct = ((cur - prev) / prev) * 100;
  if (Math.abs(pct) < 0.05) return `same as ${prevLabel}`;
  return `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(Math.abs(pct) >= 10 ? 0 : 1)}% vs ${prevLabel}`;
}

/** Billed / collected bars with the unpaid balance drawn as a line over them. */
function EvolutionChart({ items, selected, onSelect, label }) {
  const W = 1100, H = 270, PAD_L = 8, PAD_B = 28, PAD_T = 14;
  const max = Math.max(1, ...items.flatMap((t) => [t.billed, t.collected, t.outstanding]));
  const slot = (W - PAD_L) / items.length;
  const barW = Math.min(26, slot / 3);
  const y = (v) => PAD_T + (H - PAD_T - PAD_B) * (1 - v / max);
  const cx = (i) => PAD_L + slot * i + slot / 2;
  const line = items.map((t, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)},${y(t.outstanding).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="exec-chart" role="img" aria-label={label}>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line x1={PAD_L} x2={W} y1={y(max * f)} y2={y(max * f)} stroke="#e4e8eb" strokeDasharray="3 4" />
          <text x={W - 2} y={y(max * f) - 3} textAnchor="end" className="exec-chart-label">{compact(max * f)}</text>
        </g>
      ))}
      {items.map((t, i) => (
        <g key={t.key} className="dash-chart-slot" onClick={() => onSelect(t.key)} style={{ cursor: 'pointer' }}>
          {t.key === selected && <rect x={PAD_L + slot * i + 2} y={PAD_T - 6} width={slot - 4} height={H - PAD_B - PAD_T + 6} rx="6" fill="#e2f1ee" />}
          <rect x={PAD_L + slot * i} y={PAD_T - 6} width={slot} height={H - PAD_T + 6} fill="transparent" />
          <rect x={cx(i) - barW - 1} y={y(t.billed)} width={barW} height={Math.max(0, H - PAD_B - y(t.billed))} rx="3" fill="#c9d3df">
            <title>{`${t.name} billed: ${peso(t.billed)}`}</title>
          </rect>
          <rect x={cx(i) + 1} y={y(t.collected)} width={barW} height={Math.max(0, H - PAD_B - y(t.collected))} rx="3" fill="#12756a">
            <title>{`${t.name} collected: ${peso(t.collected)}`}</title>
          </rect>
          <text x={cx(i)} y={H - 9} textAnchor="middle" className="exec-chart-label" fontWeight={t.key === selected ? 700 : 400}>{t.short}</text>
        </g>
      ))}
      <path d={line} fill="none" stroke="#e2a03a" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" pointerEvents="none" />
      {items.map((t, i) => (
        <circle key={t.key} cx={cx(i)} cy={y(t.outstanding)} r={t.key === selected ? 4.5 : 3} fill="#e2a03a" stroke="#fff" strokeWidth="1.2" pointerEvents="none">
          <title>{`${t.name} unpaid: ${peso(t.outstanding)}`}</title>
        </circle>
      ))}
      <line x1={PAD_L} x2={W} y1={H - PAD_B} y2={H - PAD_B} stroke="#cdd5db" />
    </svg>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [companies, setCompanies] = useState([]);
  const [scope, setScope] = useState(''); // '' = overall (everything) | 'COMPANY' | 'HMO'
  const [companyId, setCompanyId] = useState('');
  const [view, setView] = useState('month');
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const reqId = useRef(0);

  useEffect(() => {
    api.getCompanies().then((r) => setCompanies(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    const id = ++reqId.current;
    setLoading(true);
    api.getCompanyDashboard({ company_id: companyId, type: scope, view, year, month })
      .then((r) => {
        if (id !== reqId.current) return;
        setData(r.data);
        setErr('');
      })
      .catch((e) => { if (id === reqId.current) setErr(e.message); })
      .finally(() => { if (id === reqId.current) setLoading(false); });
  }, [companyId, scope, view, year, month]);

  if (err && !data) return <div className="flash flash-error">{err}</div>;
  if (!data) return <div className="loading-state">Loading dashboard…</div>;

  const company = companyId ? companies.find((c) => String(c.id) === String(companyId)) : null;
  const scopeAll = scope === 'HMO' ? 'All HMOs' : scope === 'COMPANY' ? 'All companies' : 'All companies & HMOs';
  const scopeName = company ? company.name : scopeAll;
  const noun = scope === 'HMO' ? 'HMOs' : scope === 'COMPANY' ? 'companies' : 'accounts';
  const p = data.period;
  const isMonth = data.view === 'month';
  const isAllTime = data.view === 'all';
  const periodName = isAllTime ? 'All time' : isMonth ? `${MONTHS_LONG[data.month - 1]} ${data.year}` : String(data.year);
  const pickable = companies.filter((c) => !scope || c.account_type === scope);

  // previous period, for the "vs" notes on the cards
  let prev = null, prevLabel = '';
  if (isMonth && data.month > 1) { prev = data.months[data.month - 2]; prevLabel = MONTHS[data.month - 2]; }
  else if (data.view === 'year') { prev = data.years.find((y) => y.year === data.year - 1) || null; prevLabel = String(data.year - 1); }

  const useMonths = isMonth;
  const items = useMonths
    ? data.months.map((m) => ({ ...m, key: m.month, name: `${MONTHS_LONG[m.month - 1]} ${data.year}`, short: MONTHS[m.month - 1] }))
    : data.years.map((yr) => ({ ...yr, key: yr.year, name: String(yr.year), short: String(yr.year) }));

  const pickCategory = (key) => {
    if (isMonth) setMonth(key);
    else drillYear(key);
  };
  const changeScope = (next) => { setScope(next); setCompanyId(''); };
  const pickAccount = (id) => {
    const acc = companies.find((c) => String(c.id) === String(id));
    if (acc) setScope(acc.account_type === 'HMO' ? 'HMO' : 'COMPANY');
    setCompanyId(id ? String(id) : '');
  };
  const drillYear = (yr) => { setYear(yr); setMonth(''); setView('month'); };

  const rowsForTable = items.filter((t) => t.billed || t.collected || t.outstanding || t.entries);
  const maxCompany = Math.max(1, ...data.companies.map((c) => c.outstanding));
  const agingRows = [
    ['Not Yet Due', 'Not yet due', '#9aa7b8'],
    ['0-30 days', '1–30 days late', '#2f9e6e'],
    ['31-60 days', '31–60 days late', '#d49b22'],
    ['61-90 days', '61–90 days late', '#d9702a'],
    ['Over 90 days', 'Over 90 days late', '#b02e25'],
    ['N/A', 'No valid date', '#cfd6de'],
  ];
  const agingTotal = agingRows.reduce((s, [k]) => s + (data.aging[k]?.total || 0), 0) || 1;
  const staff = isStaff(user);

  return (
    <div className={loading ? 'dash is-loading' : 'dash'}>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <div className="subtitle">
            {scopeName} · {periodName}
            {user?.is_admin || staff ? '' : ` — ${user?.full_name || user?.username} branch only`}
          </div>
        </div>
      </div>

      {err && <div className="flash flash-error">{err}</div>}

      <div className="dash-scope" role="tablist" aria-label="Show">
        {[['', 'Overall'], ['COMPANY', 'Companies'], ['HMO', 'HMOs']].map(([k, label]) => (
          <button key={k || 'all'} type="button" role="tab" aria-selected={scope === k} className={scope === k ? 'on' : ''} onClick={() => changeScope(k)}>{label}</button>
        ))}
      </div>

      <div className="panel dash-controls">
        <div className="dash-control">
          <label htmlFor="dash-company">{scope === 'HMO' ? 'HMO' : scope === 'COMPANY' ? 'Company' : 'Account'}</label>
          <select id="dash-company" className="select-inline" value={companyId} onChange={(e) => pickAccount(e.target.value)}>
            <option value="">{scopeAll} ({pickable.length})</option>
            {scope ? pickable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>) : (
              <>
                <optgroup label="Companies">
                  {companies.filter((c) => c.account_type !== 'HMO').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
                <optgroup label="HMOs">
                  {companies.filter((c) => c.account_type === 'HMO').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
              </>
            )}
          </select>
        </div>
        <div className="dash-control">
          <label>View</label>
          <div className="seg" role="tablist">
            <button type="button" role="tab" aria-selected={isMonth} className={isMonth ? 'on' : ''} onClick={() => setView('month')}>Monthly</button>
            <button type="button" role="tab" aria-selected={data.view === 'year'} className={data.view === 'year' ? 'on' : ''} onClick={() => setView('year')}>Yearly</button>
            <button type="button" role="tab" aria-selected={isAllTime} className={isAllTime ? 'on' : ''} onClick={() => setView('all')}>All time</button>
          </div>
        </div>
        {!isAllTime && (
          <div className="dash-control">
            <label htmlFor="dash-year">Year</label>
            <select id="dash-year" className="select-inline" value={data.year} onChange={(e) => { setYear(Number(e.target.value)); if (isMonth) setMonth(''); }}>
              {data.years.map((yr) => <option key={yr.year} value={yr.year}>{yr.year}</option>)}
            </select>
          </div>
        )}
        {company && (
          <div className="dash-control dash-control-end">
            {company.status !== 'ACTIVE' && <span className={`badge ${company.status === 'BANKRUPT' ? 'badge-danger' : 'badge-secondary'}`}>{company.status}</span>}
            <Link to={`/ledger?company_id=${company.id}`} className="btn btn-secondary btn-sm">Open ledger</Link>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCompanyId('')}>Back to {scope === 'HMO' ? 'all HMOs' : scope === 'COMPANY' ? 'all companies' : 'overall'}</button>
          </div>
        )}
      </div>

      {isMonth && (
        <div className="month-chips" role="tablist" aria-label="Month">
          {MONTHS.map((m, i) => {
            const t = data.months[i];
            const has = t.billed || t.collected || t.entries;
            return (
              <button key={m} type="button" role="tab" aria-selected={data.month === i + 1}
                className={`${data.month === i + 1 ? 'on' : ''} ${has ? '' : 'empty'}`} onClick={() => setMonth(i + 1)}>
                {m}
              </button>
            );
          })}
        </div>
      )}

      <div className="kpi-dark-grid">
        <div className="kpi-dark-card">
          <div className="kpi-dark-label">Billed · {periodName}</div>
          <div className="kpi-dark-value">{peso(p.billed)}</div>
          <div className="kpi-dark-track"><div className="kpi-dark-fill" style={{ width: p.billed ? '100%' : '0%' }} /></div>
          <div className="kpi-dark-footer">
            <span className="kpi-dark-left">{p.entries} {p.entries === 1 ? 'entry' : 'entries'}</span>
            <span className="kpi-dark-right">{delta(p.billed, prev?.billed, prevLabel) || scopeName}</span>
          </div>
        </div>
        <div className="kpi-dark-card accent-green">
          <div className="kpi-dark-label">Collected · {periodName}</div>
          <div className="kpi-dark-value">{peso(p.collected)}</div>
          <div className="kpi-dark-track"><div className="kpi-dark-fill" style={{ width: `${Math.min(100, p.collection_rate)}%` }} /></div>
          <div className="kpi-dark-footer">
            <span className="kpi-dark-left">{p.collection_rate}% of billed</span>
            <span className="kpi-dark-right">{delta(p.collected, prev?.collected, prevLabel) || 'by payment date'}</span>
          </div>
        </div>
        <div className="kpi-dark-card accent-red">
          <div className="kpi-dark-label">Outstanding balance</div>
          <div className="kpi-dark-value">{peso(p.outstanding)}</div>
          <div className="kpi-dark-track"><div className="kpi-dark-fill" style={{ width: `${p.billed ? Math.min(100, (p.outstanding / p.billed) * 100) : 0}%` }} /></div>
          <div className="kpi-dark-footer">
            <span className="kpi-dark-left">{p.open_count} unpaid {p.open_count === 1 ? 'entry' : 'entries'}</span>
            <span className="kpi-dark-right">{isAllTime ? 'across all periods' : `billed in ${periodName}`}</span>
          </div>
        </div>
        <div className="kpi-dark-card accent-amber">
          <div className="kpi-dark-label">Past due</div>
          <div className="kpi-dark-value">{peso(p.past_due)}</div>
          <div className="kpi-dark-track"><div className="kpi-dark-fill" style={{ width: `${p.outstanding ? Math.min(100, (p.past_due / p.outstanding) * 100) : 0}%` }} /></div>
          <div className="kpi-dark-footer">
            <span className="kpi-dark-left">{p.past_due_count} overdue {p.past_due_count === 1 ? 'entry' : 'entries'}</span>
            <span className="kpi-dark-right">of {peso(p.outstanding)} unpaid</span>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="dash-panel-head">
          <h2>{isMonth ? `Month by month — ${data.year}` : isAllTime ? 'Overall — year by year' : 'Year by year'}</h2>
          <div className="exec-chart-key">
            <span><i style={{ background: '#c9d3df' }} />Billed</span>
            <span><i style={{ background: '#12756a' }} />Collected</span>
            <span><i style={{ background: '#e2a03a', borderRadius: 999 }} />Unpaid balance</span>
          </div>
        </div>
        <EvolutionChart items={items} selected={isMonth ? data.month : isAllTime ? null : data.year} onSelect={pickCategory}
          label={isMonth ? `Billed, collected and unpaid by month, ${data.year}` : 'Billed, collected and unpaid by year'} />
        <div className="dash-hint">{isMonth ? 'Click a month to focus on it.' : 'Click a year to open it month by month.'}</div>
      </div>

      <div className="panel">
        <h2>{isMonth ? `${data.year} at a glance` : 'Every year'} <span className="dash-sub">· {scopeName}</span></h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{isMonth ? 'Month' : 'Year'}</th>
                <th className="text-right">Entries</th>
                <th className="text-right">Billed</th>
                <th className="text-right">Collected</th>
                <th className="text-right">Unpaid</th>
                <th className="text-right">Past due</th>
                <th className="text-right">Collected %</th>
              </tr>
            </thead>
            <tbody>
              {rowsForTable.length === 0 && <tr><td colSpan={7} className="empty-state">Nothing recorded for {scopeName} yet.</td></tr>}
              {rowsForTable.map((t) => {
                const active = !isAllTime && t.key === (isMonth ? data.month : data.year);
                return (
                  <tr key={t.key} className={`clickable-row ${active ? 'row-active' : ''}`}
                    onClick={() => (isMonth ? setMonth(t.key) : drillYear(t.key))}
                    title={isMonth ? `Focus on ${t.name}` : `Open ${t.name} month by month`}>
                    <td className="row-link">{isMonth ? MONTHS_LONG[t.month - 1] : t.year}</td>
                    <td className="text-right num">{t.entries}</td>
                    <td className={`text-right ${numClass(t.billed)}`}>{peso(t.billed)}</td>
                    <td className={`text-right ${numClass(t.collected)}`}>{peso(t.collected)}</td>
                    <td className={`text-right ${numClass(t.outstanding)}`}>{peso(t.outstanding)}</td>
                    <td className={`text-right ${numClass(t.past_due)}`}>{peso(t.past_due)}</td>
                    <td className="text-right num">{t.billed ? `${t.collection_rate}%` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {!isAllTime && data.undated.billed_count > 0 && (
        <div className="flash flash-warning">
          {data.undated.billed_count} ledger {data.undated.billed_count === 1 ? 'entry' : 'entries'} ({peso(data.undated.billed_total)}) have a billing date the dashboard can’t place in a month
          (for example a free-text range), so they’re left out of the months and years above.
        </div>
      )}

      {!company && !scope && (
        <div className="panel">
          <h2>Companies vs HMOs <span className="dash-sub">· {periodName}</span></h2>
          <div className="split-grid">
            {[['COMPANY', 'Companies'], ['HMO', 'HMOs']].map(([k, label]) => {
              const t = data.by_type[k];
              return (
                <button key={k} type="button" className="split-card" onClick={() => changeScope(k)} title={`Open the ${label} dashboard`}>
                  <span className="split-title">{label}</span>
                  <span className="split-value num">{peso(t.outstanding)}</span>
                  <span className="split-sub">unpaid · {peso(t.past_due)} past due</span>
                  <span className="split-sub">Billed {peso(t.billed)} · Collected {peso(t.collected)} ({t.collection_rate}%)</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!company ? (
        <div className="panel">
          <h2>{noun.charAt(0).toUpperCase() + noun.slice(1)} · {periodName} <span className="dash-sub">· click one to open its own dashboard</span></h2>
          {data.companies.length === 0 ? (
            <div className="empty-state">No activity for {periodName}.</div>
          ) : (
            <ol className="rank-list">
              {data.companies.map((c, i) => (
                <li key={c.id}>
                  <button type="button" className="rank-row rank-button" onClick={() => pickAccount(c.id)} title={`Show ${c.name}'s dashboard`}>
                    <span className="rank-pos">{i + 1}</span>
                    <span className="rank-name">
                      <span>{c.name}</span>
                      {!scope && c.account_type === 'HMO' && <span className="badge badge-secondary">HMO</span>}
                      {c.status !== 'ACTIVE' && <span className={`badge ${c.status === 'BANKRUPT' ? 'badge-danger' : 'badge-secondary'}`}>{c.status}</span>}
                    </span>
                    <span className="rank-bar" aria-hidden="true"><i style={{ width: `${Math.max(2, (c.outstanding / maxCompany) * 100)}%` }} /></span>
                    <span className="rank-amount num">{peso(c.outstanding)}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
          {data.companies_total > data.companies.length && (
            <div className="dash-hint">Showing the top {data.companies.length} of {data.companies_total} {noun} by unpaid balance.</div>
          )}
        </div>
      ) : (
        <div className="panel">
          <h2>How old is the unpaid balance? <span className="dash-sub">· {periodName}</span></h2>
          {p.outstanding <= 0 ? (
            <div className="empty-state">Nothing unpaid for {company.name}{isAllTime ? '.' : ` in ${periodName}.`}</div>
          ) : (
            <>
              <div className="aging-strip" aria-hidden="true">
                {agingRows.map(([k, , color]) => {
                  const t = data.aging[k]?.total || 0;
                  return t > 0 ? <i key={k} style={{ width: `${(t / agingTotal) * 100}%`, background: color }} /> : null;
                })}
              </div>
              <div className="exec-legend">
                {agingRows.filter(([k]) => data.aging[k]?.count).map(([k, label, color]) => (
                  <div className="exec-legend-item" key={k}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: color, marginTop: 5, flex: 'none' }} />
                    <div>
                      <div className="exec-legend-label">{label}</div>
                      <div className="exec-legend-value">{peso(data.aging[k].total)} <span>· {data.aging[k].count}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className="panel">
        <h2>{isAllTime ? 'Latest ledger entries' : `Entries billed in ${periodName}`} <span className="dash-sub">· {scopeName}</span></h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                {!company && <th>Company</th>}
                <th>Billing date</th><th>SOA #</th>
                <th className="text-right">Amount</th><th className="text-right">Paid</th><th className="text-right">Balance</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.length === 0 && <tr><td colSpan={company ? 6 : 7} className="empty-state">No ledger entries for {periodName}.</td></tr>}
              {data.entries.map((r) => (
                <tr key={r.id} className="clickable-row" title="Open this entry in the Ledger"
                  onClick={() => navigate(`/ledger?company_id=${r.company_id}&entry=${r.id}`)}>
                  {!company && <td className="row-link">{r.company_name}</td>}
                  <td>{fdate(r.billing_date)}</td>
                  <td>{r.soa_number || '—'}</td>
                  <td className={`text-right ${numClass(r.amount)}`}>{peso(r.amount)}</td>
                  <td className={`text-right ${numClass(r.paid_amount)}`}>{peso(r.paid_amount)}</td>
                  <td className={`text-right ${numClass(r.balance)}`}>{peso(r.balance)}</td>
                  <td>
                    {r.balance <= 0.009 ? <span className="badge badge-success">Paid</span>
                      : r.overdue_days > 0 ? <span className="badge badge-danger">{r.overdue_days}d overdue</span>
                      : <span className="badge badge-secondary">Open</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.entries_total > data.entries.length && (
          <div className="dash-hint" style={{ padding: '12px 24px 16px' }}>
            Showing the latest {data.entries.length} of {data.entries_total} entries.
            {company && <> <Link to={`/ledger?company_id=${company.id}`}>Open the full ledger</Link>.</>}
          </div>
        )}
      </div>
    </div>
  );
}