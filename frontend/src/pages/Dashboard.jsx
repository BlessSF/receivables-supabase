import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { peso, fdate, numClass, coveredLabel } from '../utils';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
import { useAuth } from '../AuthContext';
import { isStaff, isExecutive } from '../utils';
import { billingYm, buildMonths, MonthTable } from '../MonthTable';

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

// Series colors for the chart + legend (checked with the palette validator: distinct for color-blind readers too)
const C_BILLED = '#4a78c2', C_COLLECTED = '#0a9078', C_UNPAID = '#c2780e';

// Round an axis maximum up to a clean number (1, 2, 2.5, 5 x 10^n) and split it into 4 steps.
function niceScale(max) {
  const raw = Math.max(1, max) / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= raw);
  return { step, top: step * 4 };
}

// Column with a 4px rounded top and a square bottom, sitting on the baseline.
function barPath(x, yTop, w, base) {
  const h = base - yTop;
  if (h <= 0) return '';
  const r = Math.min(4, h, w / 2);
  return `M${x},${base} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + w - r} Q${x + w},${yTop} ${x + w},${yTop + r} V${base} Z`;
}

/** Billed / collected columns with the unpaid balance drawn as a line over them. Hover shows every value for that period. */
function EvolutionChart({ items, selected, onSelect, label }) {
  const [hover, setHover] = useState(null);
  const wrap = useRef(null);
  const [width, setWidth] = useState(1100);
  useEffect(() => { // draw at the real width so text stays readable on phones
    const el = wrap.current;
    if (!el) return undefined;
    const set = () => setWidth(Math.max(300, Math.round(el.clientWidth)));
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const W = width, H = width < 560 ? 260 : 300;
  const PAD_L = width < 560 ? 48 : 58, PAD_R = width < 560 ? 8 : 14, PAD_B = 32, PAD_T = 18;
  const rawMax = Math.max(1, ...items.flatMap((t) => [t.billed, t.collected, t.outstanding]));
  const { step, top } = niceScale(rawMax);
  const slot = (W - PAD_L - PAD_R) / items.length;
  const barW = Math.min(22, Math.max(5, slot / 3.2));
  const base = H - PAD_B;
  const y = (v) => PAD_T + (base - PAD_T) * (1 - v / top);
  const cx = (i) => PAD_L + slot * i + slot / 2;
  const pts = items.map((t, i) => [cx(i), y(t.outstanding)]);
  const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const area = pts.length ? `${line} L${pts[pts.length - 1][0].toFixed(1)},${base} L${pts[0][0].toFixed(1)},${base} Z` : '';
  const ticks = [0, 1, 2, 3, 4].map((k) => k * step);
  const h = hover !== null ? items[hover] : null;
  const tipLeft = hover !== null ? ((cx(hover) / W) * 100) : 0;
  const tipShift = hover === null ? '-50%' : hover <= 1 ? '-18%' : hover >= items.length - 2 ? '-82%' : '-50%';

  return (
    <div className="evo" ref={wrap} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="exec-chart" role="img" aria-label={label}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} stroke={v === 0 ? '#c7d0d9' : '#e8ecf0'} strokeWidth="1" />
            <text x={PAD_L - 8} y={y(v) + 4} textAnchor="end" className="evo-axis">{v === 0 ? '0' : compact(v)}</text>
          </g>
        ))}

        {area && <path d={area} fill={C_UNPAID} fillOpacity="0.09" pointerEvents="none" />}

        {items.map((t, i) => {
          const on = t.key === selected;
          const hot = hover === i;
          return (
            <g key={t.key}>
              {(on || hot) && <rect x={PAD_L + slot * i + 3} y={PAD_T - 8} width={slot - 6} height={base - PAD_T + 8} rx="8" fill={on ? '#e3f2ef' : '#f1f4f7'} />}
              <path className="evo-bar" d={barPath(cx(i) - barW - 1, y(t.billed), barW, base)} fill={C_BILLED} opacity={hot || hover === null ? 1 : 0.55} />
              <path className="evo-bar" d={barPath(cx(i) + 1, y(t.collected), barW, base)} fill={C_COLLECTED} opacity={hot || hover === null ? 1 : 0.55} />
              <text x={cx(i)} y={H - 10} textAnchor="middle" className="evo-axis" fontWeight={on ? 700 : 500} fill={on ? '#13203a' : undefined}>{t.short}</text>
            </g>
          );
        })}

        <path d={line} fill="none" stroke={C_UNPAID} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" pointerEvents="none" />
        {pts.map(([px, py], i) => (
          <circle key={items[i].key} cx={px} cy={py} r={hover === i || items[i].key === selected ? 5.5 : 4} fill={C_UNPAID} stroke="#fff" strokeWidth="2" pointerEvents="none" />
        ))}

        {/* one wide hit area per period: hover shows the readout, click / Enter focuses it */}
        {items.map((t, i) => (
          <rect
            key={`hit-${t.key}`}
            x={PAD_L + slot * i} y={PAD_T - 8} width={slot} height={base - PAD_T + 8 + PAD_B}
            fill="transparent" style={{ cursor: 'pointer' }}
            tabIndex={0} role="button" aria-label={`${t.name}: billed ${peso(t.billed)}, collected ${peso(t.collected)}, unpaid ${peso(t.outstanding)}`}
            onPointerEnter={() => setHover(i)} onPointerMove={() => hover !== i && setHover(i)}
            onFocus={() => setHover(i)} onBlur={() => setHover(null)}
            onClick={() => onSelect(t.key)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(t.key); } }}
          />
        ))}
      </svg>

      {h && (
        <div className="evo-tip" style={{ left: `${tipLeft}%`, transform: `translateX(${tipShift})` }} role="tooltip">
          <div className="evo-tip-title">{h.name}</div>
          <div className="evo-tip-row"><i style={{ background: C_BILLED }} /><span>Billed</span><strong>{peso(h.billed)}</strong></div>
          <div className="evo-tip-row"><i style={{ background: C_COLLECTED }} /><span>Collected</span><strong>{peso(h.collected)}</strong></div>
          <div className="evo-tip-row"><i className="evo-tip-line" style={{ background: C_UNPAID }} /><span>Unpaid balance</span><strong>{peso(h.outstanding)}</strong></div>
          {h.billed > 0 && <div className="evo-tip-foot">{Math.round((h.collected / h.billed) * 100)}% of billed collected</div>}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [companies, setCompanies] = useState([]);
  const [scope, setScope] = useState(''); // '' = overall (everything) | 'COMPANY' | 'HMO' | 'CHARGE'
  const [grouping, setGrouping] = useState('all'); // 'all' = combined | 'each' = one block per account, HMOs first then Company Charges
  const [companyId, setCompanyId] = useState('');
  const [view, setView] = useState('month');
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [fm, setFm] = useState(() => new Date().getMonth() + 1); // Yearly / All time: which month the cards show (0 = every month). Starts on this month.
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const reqId = useRef(0);
  const [entries, setEntries] = useState(null); // every ledger entry, for each account's Jan - Dec summary

  useEffect(() => {
    api.getCompanies().then((r) => setCompanies(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    const id = ++reqId.current;
    setLoading(true);
    api.getCompanyDashboard({ company_id: companyId, type: scope, view, year, month, fm: view === 'month' ? '' : fm })
      .then((r) => {
        if (id !== reqId.current) return;
        setData(r.data);
        setErr('');
      })
      .catch((e) => { if (id === reqId.current) setErr(e.message); })
      .finally(() => { if (id === reqId.current) setLoading(false); });
  }, [companyId, scope, view, year, month, fm]);

  const wantMonthly = grouping === 'each' && !companyId && (view === 'year' || view === 'all' || (view === 'month' && month === 'all'));
  useEffect(() => {
    if (!wantMonthly || entries) return;
    api.getSummary({ show_all: 1 }).then((r) => setEntries(r.data || [])).catch(() => setEntries([]));
  }, [wantMonthly, entries]);

  if (err && !data) return <div className="flash flash-error">{err}</div>;
  if (!data) return <div className="loading-state">Loading dashboard…</div>;

  const company = companyId ? companies.find((c) => String(c.id) === String(companyId)) : null;
  const scopeAll = scope === 'HMO' ? 'All HMOs' : scope === 'CHARGE' ? 'All Company Charges' : scope === 'COMPANY' ? 'All companies' : 'All HMOs & Company Charges';
  const scopeName = company ? company.name : scopeAll;
  const noun = scope === 'HMO' ? 'HMOs' : scope === 'CHARGE' ? 'company charges' : scope === 'COMPANY' ? 'companies' : 'accounts';
  const p = data.period;
  const isMonth = data.view === 'month';
  const isAllTime = data.view === 'all';
  const periodName = isAllTime ? (data.fm ? `${MONTHS_LONG[data.fm - 1]} · all years` : 'All time') : isMonth ? (data.month === 0 ? `All months ${data.year}` : `${MONTHS_LONG[data.month - 1]} ${data.year}`) : (data.fm ? `${MONTHS_LONG[data.fm - 1]} ${data.year}` : String(data.year));
  const pickable = companies.filter((c) => !scope || c.account_type === scope);

  // previous period, for the "vs" notes on the cards
  let prev = null, prevLabel = '';
  if (isMonth && data.month > 1) { prev = data.months[data.month - 2]; prevLabel = MONTHS[data.month - 2]; }
  else if (data.view === 'year' && !data.fm) { prev = data.years.find((y) => y.year === data.year - 1) || null; prevLabel = String(data.year - 1); }

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
    if (acc) setScope(acc.account_type === 'HMO' ? 'HMO' : acc.account_type === 'CHARGE' ? 'CHARGE' : 'COMPANY');
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
  // Each account block: the Summary page's January - December table (Yearly, All time, or Monthly > All months)
  const monthlyFor = (id) => {
    if (!(eachMode && (data.view === 'year' || data.view === 'all' || (data.view === 'month' && data.month === 0)))) return null;
    if (!entries) return <div className="dash-month-wait">Loading monthly summary…</div>;
    const list = entries.filter((r) => String(r.company_id) === String(id));
    if (list.length === 0) return <div className="dash-month-wait">No entries yet.</div>;
    const owedLabel = isExecutive(user) ? 'Still Owed' : 'Deduction';
    const years = data.view === 'all'
      ? [...new Set(list.map((r) => billingYm(r)?.y).filter(Boolean))].sort((a, b) => b - a)
      : [data.year];
    if (years.length === 0) years.push(data.year);
    const noPeriod = list.filter((r) => !billingYm(r));
    return (
      <div className="dash-month-tables">
        {years.map((y, i) => (
          <details key={y} open={years.length === 1 || i === 0}>
            <summary>Summary by month · {y}</summary>
            <MonthTable months={buildMonths([...list.filter((r) => billingYm(r)?.y === y), ...(i === 0 ? noPeriod : [])], y)} totalLabel={`TOTAL ${y}`} owedLabel={owedLabel} />
          </details>
        ))}
      </div>
    );
  };
  const staff = isStaff(user);
  const eachMode = !company && grouping === 'each'; // one block per account instead of the combined view
  // HMOs vs Company Charges breakdown shown under each total (overall view only)
  const showSplit = !company && !scope && !!data.by_type;
  const bs = data.due_in?.before_start; // "YYYY-MM"
  const beforeName = bs ? (data.due_in.before_year_only ? bs.slice(0, 4) : `${MONTH_NAMES[Number(bs.slice(5, 7)) - 1]} ${bs.slice(0, 4)}`) : '';
  const splitLine = (field) => showSplit && (
    <div className="kpi-dark-footer" style={{ marginTop: 6, fontSize: 12 }}>
      <span className="kpi-dark-left">HMOs {peso(data.by_type.HMO?.[field] || 0)}</span>
      <span className="kpi-dark-right">Company Charges {peso(data.by_type.CHARGE?.[field] || 0)}</span>
    </div>
  );

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
        {[['', 'Overall'], ['HMO', 'HMOs'], ['CHARGE', 'Company Charges'], ['COMPANY', 'Companies']].map(([k, label]) => (
          <button key={k || 'all'} type="button" role="tab" aria-selected={scope === k} className={scope === k ? 'on' : ''} onClick={() => changeScope(k)}>{label}</button>
        ))}
      </div>

      <div className="panel dash-controls">
        <div className="dash-control">
          <label htmlFor="dash-company">{scope === 'HMO' ? 'HMO' : scope === 'CHARGE' ? 'Company Charge' : scope === 'COMPANY' ? 'Company' : 'Account'}</label>
          <select id="dash-company" className="select-inline" value={companyId} onChange={(e) => pickAccount(e.target.value)}>
            <option value="">{scopeAll} ({pickable.length})</option>
            {scope ? pickable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>) : (
              <>
                <optgroup label="HMOs">
                  {companies.filter((c) => c.account_type === 'HMO').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
                <optgroup label="Company Charges">
                  {companies.filter((c) => c.account_type === 'CHARGE').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
                <optgroup label="Companies">
                  {companies.filter((c) => c.account_type !== 'HMO' && c.account_type !== 'CHARGE').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
              </>
            )}
          </select>
        </div>
        {!company && (
          <div className="dash-control">
            <label htmlFor="dash-group">Show</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" className={grouping === 'all' ? 'btn btn-sm' : 'btn btn-secondary btn-sm'} onClick={() => setGrouping('all')}>All accounts (combined)</button>
              <button type="button" className={grouping === 'each' ? 'btn btn-sm' : 'btn btn-secondary btn-sm'} onClick={() => setGrouping('each')}>Each account (separate blocks)</button>
            </div>
          </div>
        )}
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
        {!isMonth && (
          <div className="dash-control">
            <label htmlFor="dash-fm">Month</label>
            <select id="dash-fm" className="select-inline" value={fm} onChange={(e) => setFm(Number(e.target.value))}>
              <option value={0}>All months</option>
              {MONTHS_LONG.map((m, i) => <option key={m} value={i + 1}>{m}{i + 1 === new Date().getMonth() + 1 ? ' (this month)' : ''}</option>)}
            </select>
          </div>
        )}
        {company && (
          <div className="dash-control dash-control-end">
            {company.status !== 'ACTIVE' && <span className={`badge ${company.status === 'BANKRUPT' ? 'badge-danger' : 'badge-secondary'}`}>{company.status}</span>}
            <Link to={`/ledger?company_id=${company.id}`} className="btn btn-secondary btn-sm">Open ledger</Link>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCompanyId('')}>Back to {scope === 'HMO' ? 'all HMOs' : scope === 'CHARGE' ? 'all company charges' : scope === 'COMPANY' ? 'all companies' : 'overall'}</button>
          </div>
        )}
      </div>

      {isMonth && (
        <div className="month-chips" role="tablist" aria-label="Month">
          <button type="button" role="tab" aria-selected={data.month === 0} className={data.month === 0 ? 'on' : ''} onClick={() => setMonth('all')}>All months</button>
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

      {!eachMode && (<>
      <div className="kpi-dark-grid">
        <div className="kpi-dark-card">
          <div className="kpi-dark-label">Billed · {periodName}</div>
          <div className="kpi-dark-value">{peso(p.billed)}</div>
          <div className="kpi-dark-track"><div className="kpi-dark-fill" style={{ width: p.billed ? '100%' : '0%' }} /></div>
          <div className="kpi-dark-footer">
            <span className="kpi-dark-left">{p.entries} {p.entries === 1 ? 'entry' : 'entries'}</span>
            <span className="kpi-dark-right">{delta(p.billed, prev?.billed, prevLabel) || scopeName}</span>
          </div>
          {splitLine('billed')}
        </div>
        <div className="kpi-dark-card accent-green">
          <div className="kpi-dark-label">Collected · {periodName}</div>
          <div className="kpi-dark-value">{peso(p.collected)}</div>
          <div className="kpi-dark-track"><div className="kpi-dark-fill" style={{ width: `${Math.min(100, p.collection_rate)}%` }} /></div>
          <div className="kpi-dark-footer">
            <span className="kpi-dark-left">{p.collection_rate}% of billed</span>
            <span className="kpi-dark-right">{delta(p.collected, prev?.collected, prevLabel) || 'by payment date'}</span>
          </div>
          {splitLine('collected')}
        </div>
        <div className="kpi-dark-card accent-red">
          <div className="kpi-dark-label">Outstanding balance</div>
          <div className="kpi-dark-value">{peso(p.outstanding)}</div>
          <div className="kpi-dark-track"><div className="kpi-dark-fill" style={{ width: `${p.billed ? Math.min(100, (p.outstanding / p.billed) * 100) : 0}%` }} /></div>
          <div className="kpi-dark-footer">
            <span className="kpi-dark-left">{p.open_count} unpaid {p.open_count === 1 ? 'entry' : 'entries'}</span>
            <span className="kpi-dark-right">{isAllTime && !data.fm ? 'across all periods' : `billed in ${periodName}`}</span>
          </div>
          {splitLine('outstanding')}
        </div>
        <div className="kpi-dark-card accent-amber">
          <div className="kpi-dark-label">Past due</div>
          <div className="kpi-dark-value">{peso(p.past_due)}</div>
          <div className="kpi-dark-track"><div className="kpi-dark-fill" style={{ width: `${p.outstanding ? Math.min(100, (p.past_due / p.outstanding) * 100) : 0}%` }} /></div>
          <div className="kpi-dark-footer">
            <span className="kpi-dark-left">{p.past_due_count} overdue {p.past_due_count === 1 ? 'entry' : 'entries'}</span>
            <span className="kpi-dark-right">of {peso(p.outstanding)} unpaid</span>
          </div>
          {splitLine('past_due')}
        </div>
        {data.due_in && data.due_in.before_start && (
          <div className="kpi-dark-card accent-orange">
            <div className="kpi-dark-label">Overdue before {beforeName}</div>
            <div className="kpi-dark-value">{peso(data.due_in.before)}</div>
            <div className="kpi-dark-track"><div className="kpi-dark-fill" style={{ width: `${data.due_in.before + data.due_in.total ? Math.min(100, (data.due_in.before / (data.due_in.before + data.due_in.total)) * 100) : 0}%` }} /></div>
            <div className="kpi-dark-footer">
              <span className="kpi-dark-left">{data.due_in.before_count} overdue {data.due_in.before_count === 1 ? 'entry' : 'entries'}</span>
              <span className="kpi-dark-right">due before {beforeName}</span>
            </div>
            {showSplit && (
              <div className="kpi-dark-footer" style={{ marginTop: 6, fontSize: 12 }}>
                <span className="kpi-dark-left">HMOs {peso(data.due_in.before_by_type?.HMO || 0)}</span>
                <span className="kpi-dark-right">Company Charges {peso(data.due_in.before_by_type?.CHARGE || 0)}</span>
              </div>
            )}
          </div>
        )}
        {data.due_in && (
          <div className="kpi-dark-card accent-blue">
            <div className="kpi-dark-label">Due · {periodName}</div>
            <div className="kpi-dark-value">{peso(data.due_in.total)}</div>
            <div className="kpi-dark-track"><div className="kpi-dark-fill" style={{ width: `${p.outstanding ? Math.min(100, (data.due_in.total / p.outstanding) * 100) : 0}%` }} /></div>
            <div className="kpi-dark-footer">
              <span className="kpi-dark-left">{data.due_in.count} {data.due_in.count === 1 ? 'entry' : 'entries'} due</span>
              <span className="kpi-dark-right">by Due Date / 3-month terms</span>
            </div>
            {data.due_in.before > 0.009 && (
              <div className="dash-due-plus">
                <div className="tot"><span>Total due now (with overdue)</span><strong>{peso(data.due_in.total + data.due_in.before)}</strong></div>
              </div>
            )}
            {showSplit && (
              <div className="kpi-dark-footer" style={{ marginTop: 6, fontSize: 12 }}>
                <span className="kpi-dark-left">HMOs {peso(data.due_in.by_type.HMO || 0)}</span>
                <span className="kpi-dark-right">Company Charges {peso(data.due_in.by_type.CHARGE || 0)}</span>
              </div>
            )}
            {user?.is_admin && !user?.is_accounting && <Link className="dash-due-link" to="/payables/cash-position">Open in Cash Position →</Link>}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="dash-panel-head">
          <h2>{isMonth ? `Month by month — ${data.year}` : isAllTime ? 'Overall — year by year' : 'Year by year'}</h2>
          <div className="exec-chart-key">
            <span><i style={{ background: C_BILLED }} />Billed</span>
            <span><i style={{ background: C_COLLECTED }} />Collected</span>
            <span><i style={{ background: C_UNPAID, height: 3, width: 16, borderRadius: 2 }} />Unpaid balance</span>
          </div>
        </div>
        <EvolutionChart items={items} selected={isMonth ? (data.month || null) : isAllTime ? null : data.year} onSelect={pickCategory}
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
                const active = !isAllTime && data.month !== 0 && t.key === (isMonth ? data.month : data.year);
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

      </>)}

      {!isAllTime && data.undated.billed_count > 0 && (
        <div className="flash flash-warning">
          {data.undated.billed_count} ledger {data.undated.billed_count === 1 ? 'entry' : 'entries'} ({peso(data.undated.billed_total)}) have a billing date the dashboard can’t place in a month
          (for example a free-text range), so they’re left out of the months and years above.
        </div>
      )}

      {!company && !scope && (
        <div className="panel">
          <h2>HMOs vs Company Charges <span className="dash-sub">· {periodName}</span></h2>
          <div className="split-grid">
            {[['HMO', 'HMOs'], ['CHARGE', 'Company Charges'], ['COMPANY', 'Companies']].filter(([k]) => k !== 'COMPANY' || data.by_type.COMPANY.entries > 0).map(([k, label]) => {
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

      {eachMode ? (
        (() => {
          // every account gets a block, even when it has nothing in this period (shown as zeros)
          const byId = new Map(data.companies.map((c) => [String(c.id), c]));
          const zero = { billed: 0, collected: 0, outstanding: 0, past_due: 0 };
          const accounts = companies
            .filter((c) => (scope ? c.account_type === scope : c.account_type === 'HMO' || c.account_type === 'CHARGE'))
            .map((c) => ({ ...c, ...zero, ...(byId.get(String(c.id)) || {}) }))
            .sort((a, b) => (b.outstanding - a.outstanding) || String(a.name).localeCompare(String(b.name)));
          return [
            { key: 'HMO', title: 'HMOs', list: accounts.filter((c) => c.account_type === 'HMO') },
            { key: 'CHARGE', title: 'Company Charges', list: accounts.filter((c) => c.account_type === 'CHARGE') },
            { key: 'COMPANY', title: 'Companies', list: accounts.filter((c) => c.account_type !== 'HMO' && c.account_type !== 'CHARGE') },
        ].filter((g) => g.list.length > 0).map((g) => (
          <div key={g.key}>
            <div className="dash-group-title">{g.title} <span>· {g.list.length} · {periodName}</span></div>
            {g.list.map((c) => {
              const rate = c.billed ? Math.round((c.collected / c.billed) * 1000) / 10 : 0;
              return (
                <div className="panel account-block" key={c.id}>
                  <div className="dash-panel-head">
                    <h2 style={{ margin: 0 }}>{c.name}
                      {c.status !== 'ACTIVE' && <span className={`badge ${c.status === 'BANKRUPT' ? 'badge-danger' : 'badge-secondary'}`} style={{ marginLeft: 8 }}>{c.status}</span>}
                    </h2>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" className="btn btn-sm" onClick={() => pickAccount(c.id)}>Open dashboard</button>
                      <Link className="btn btn-secondary btn-sm" to={`/ledger?company_id=${c.id}`}>Ledger</Link>
                    </div>
                  </div>
                  <div className="kpi-dark-grid" style={{ marginTop: 12 }}>
                    <div className="kpi-dark-card">
                      <div className="kpi-dark-label">Billed · {periodName}</div>
                      <div className="kpi-dark-value">{peso(c.billed)}</div>
                      <div className="kpi-dark-track"><div className="kpi-dark-fill" style={{ width: c.billed ? '100%' : '0%' }} /></div>
                    </div>
                    <div className="kpi-dark-card accent-green">
                      <div className="kpi-dark-label">Collected</div>
                      <div className="kpi-dark-value">{peso(c.collected)}</div>
                      <div className="kpi-dark-track"><div className="kpi-dark-fill" style={{ width: `${Math.min(100, rate)}%` }} /></div>
                      <div className="kpi-dark-footer"><span className="kpi-dark-left">{rate}% of billed</span></div>
                    </div>
                    <div className="kpi-dark-card accent-red">
                      <div className="kpi-dark-label">Outstanding balance</div>
                      <div className="kpi-dark-value">{peso(c.outstanding)}</div>
                      <div className="kpi-dark-track"><div className="kpi-dark-fill" style={{ width: `${c.billed ? Math.min(100, (c.outstanding / c.billed) * 100) : 0}%` }} /></div>
                    </div>
                    <div className="kpi-dark-card accent-amber">
                      <div className="kpi-dark-label">Past due</div>
                      <div className="kpi-dark-value">{peso(c.past_due)}</div>
                      <div className="kpi-dark-track"><div className="kpi-dark-fill" style={{ width: `${c.outstanding ? Math.min(100, (c.past_due / c.outstanding) * 100) : 0}%` }} /></div>
                    </div>
                  </div>
                  {monthlyFor(c.id)}
                </div>
              );
            })}
          </div>
        ));
        })()
      ) : !company ? (
        <div className="panel">
          <h2>{noun.charAt(0).toUpperCase() + noun.slice(1)} · {periodName} <span className="dash-sub">· click one to open its own dashboard</span></h2>
          {data.companies.length === 0 ? (
            <div className="empty-state">No activity for {periodName}.</div>
          ) : (
            <ol className="rank-list">
              {data.companies.slice(0, 15).map((c, i) => (
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
          {data.companies_total > 15 && (
            <div className="dash-hint">Showing the top 15 of {data.companies_total} {noun} by unpaid balance.</div>
          )}
        </div>
      ) : (
        <div className="panel">
          <h2>How old is the unpaid balance? <span className="dash-sub">· {periodName}</span></h2>
          {p.outstanding <= 0 ? (
            <div className="empty-state">Nothing unpaid for {company.name}{isAllTime && !data.fm ? '.' : ` in ${periodName}.`}</div>
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

      {!eachMode && (
      <div className="panel">
        <h2>{isAllTime && !data.fm ? 'Latest ledger entries' : `Entries billed in ${periodName}`} <span className="dash-sub">· {scopeName}</span></h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                {!company && <th>Company</th>}
                <th>Covered period</th><th>SOA #</th>
                <th className="text-right">Amount</th><th className="text-right">Paid</th><th className="text-right">Balance</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.length === 0 && <tr><td colSpan={company ? 6 : 7} className="empty-state">No ledger entries for {periodName}.</td></tr>}
              {data.entries.map((r) => (
                <tr key={r.id} className="clickable-row" title="Open this entry in the Ledger"
                  onClick={() => navigate(`/ledger?company_id=${r.company_id}&entry=${r.id}`)}>
                  {!company && <td className="row-link">{r.company_name}</td>}
                  <td>{coveredLabel(r.period_from, r.period_to) || fdate(r.billing_date)}</td>
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
      )}
    </div>
  );
}