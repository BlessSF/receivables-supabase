import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { peso, fdate, AGING_BADGE, isExecutive, MONTHS } from '../utils';
import { useAuth } from '../AuthContext';

const BUCKET_OPTIONS = [
  ['', 'All statuses'],
  ['not_yet_due', 'Not Yet Due'],
  ['0-30', '0-30 days'],
  ['31-60', '31-60 days'],
  ['61-90', '61-90 days'],
  ['over90', 'Over 90 days'],
];

function statusBadge(r) {
  if (r.is_paid) return <span className="badge badge-success">Paid</span>;
  if (r.days === null || r.days === undefined) return <span className="badge badge-secondary">N/A</span>;
  if (r.is_overdue) return <span className="badge badge-danger">{r.days} day{r.days === 1 ? '' : 's'} past due</span>;
  return <span className="badge badge-info">{r.days} day{r.days === 1 ? '' : 's'} unpaid</span>;
}

// Overdue first (most days overdue), then not-yet-due (longest unpaid first), paid last.
function sortSummary(rows) {
  return [...rows].sort((a, b) => {
    if (a.is_paid !== b.is_paid) return a.is_paid ? 1 : -1;
    if (a.is_overdue !== b.is_overdue) return a.is_overdue ? -1 : 1;
    return (b.days || 0) - (a.days || 0);
  });
}

// Owner / accounting accounts only see past-due entries
const EXEC_BUCKET_OPTIONS = [
  ['', 'All past due'],
  ['0-30', '1-30 days late'],
  ['31-60', '31-60 days late'],
  ['61-90', '61-90 days late'],
  ['over90', 'Over 90 days late'],
];

export default function Summary() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const readOnly = isExecutive(user);
  const [companies, setCompanies] = useState([]);
  const [searchParams] = useSearchParams();
  const [companyId, setCompanyId] = useState(() => searchParams.get('company_id') || '');
  const [aging, setAging] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [view, setView] = useState('entry'); // 'entry' = every entry, 'month' = totals for January - December
  const [year, setYear] = useState('');

  useEffect(() => { api.getCompanies().then((r) => setCompanies(r.data)); }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      api.getSummary({ company_id: companyId, aging, show_all: showAll ? 1 : 0, q })
        .then((r) => setRows(sortSummary(r.data)))
        .catch((e) => setErr(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [companyId, aging, showAll, q]);

  // ---- Summary by month: the entries on screen (same filters) grouped by billing month ----
  const yearOf = (r) => { const m = String(r.billing_date || '').match(/^(\d{4})-(\d{2})/); return m ? { y: +m[1], m: +m[2] } : null; };
  const years = useMemo(() => {
    const ys = new Set((rows || []).map((r) => yearOf(r)?.y).filter(Boolean));
    ys.add(new Date().getFullYear());
    return [...ys].sort((a, b) => b - a);
  }, [rows]);
  useEffect(() => {
    if (!rows || year) return;
    const now = new Date().getFullYear();
    const withData = rows.some((r) => yearOf(r)?.y === now);
    setYear(String(withData ? now : (years.find((y) => rows.some((r) => yearOf(r)?.y === y)) ?? now)));
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const monthRows = useMemo(() => {
    const out = MONTHS.map((name) => ({ name, entries: 0, overdue: 0, billed: 0, paid: 0, owed: 0 }));
    (rows || []).forEach((r) => {
      const p = yearOf(r);
      if (!p || String(p.y) !== String(year)) return;
      const t = out[p.m - 1];
      t.entries += 1;
      if (r.is_overdue) t.overdue += 1;
      t.billed += Number(r.amount || 0);
      t.paid += Number(r.paid_amount || 0);
      t.owed += Number(r.deduction ?? r.balance ?? 0);
    });
    return out;
  }, [rows, year]);
  const monthTotal = monthRows.reduce((a, m) => ({ entries: a.entries + m.entries, overdue: a.overdue + m.overdue, billed: a.billed + m.billed, paid: a.paid + m.paid, owed: a.owed + m.owed }), { entries: 0, overdue: 0, billed: 0, paid: 0, owed: 0 });

  const filtersActive = companyId || aging || showAll || q.trim() !== '';
  const selectedCompany = companies.find((c) => String(c.id) === String(companyId));

  const totalAmount = (rows || []).reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalPaid = (rows || []).reduce((s, r) => s + Number(r.paid_amount || 0), 0);
  const totalDeduction = (rows || []).reduce((s, r) => s + Number(r.deduction || r.balance || 0), 0);
  const overdueCount = (rows || []).filter((r) => r.is_overdue).length;

  function clearFilters() {
    setCompanyId(''); setAging(''); setShowAll(false); setQ('');
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{readOnly ? 'Past Due Summary' : 'Summary'}{selectedCompany ? ` — ${selectedCompany.name}` : ''}</h1>
          <div className="subtitle">
            {readOnly
              ? `Every past-due entry${selectedCompany ? '' : ' across all companies'} — what was billed, what was paid, what is still owed, and how late it is.`
              : `${showAll ? 'Every entry' : 'Every unpaid entry'}${selectedCompany ? '' : ' across all companies'} — billed, paid, deduction, and how long it's been outstanding.`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className={view === 'entry' ? 'btn' : 'btn btn-secondary'} onClick={() => setView('entry')}>By Entry</button>
          <button type="button" className={view === 'month' ? 'btn' : 'btn btn-secondary'} onClick={() => setView('month')}>Summary by Month</button>
        </div>
      </div>

      <div className="panel">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="table-search" style={{ maxWidth: 280 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.3-4.3" /></svg>
            <input placeholder="Search company, comment, amount, date…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Filter by company</label>
            <select className="select-inline" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">All companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Filter by status</label>
            <select className="select-inline" value={aging} onChange={(e) => setAging(e.target.value)}>
              {(readOnly ? EXEC_BUCKET_OPTIONS : BUCKET_OPTIONS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          {!readOnly && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, paddingBottom: 9 }}>
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              Include fully paid entries
            </label>
          )}
          {view === 'month' && (
            <div className="form-group">
              <label>Year</label>
              <select className="select-inline" value={year} onChange={(e) => setYear(e.target.value)}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          )}
          {filtersActive && <button className="btn btn-secondary btn-sm" onClick={clearFilters}>Clear filters</button>}
        </div>
      </div>

      {err && <div className="flash flash-error">{err}</div>}

      {view === 'entry' && (
      <div className="kpi-grid">
        <div className="kpi-card accent-red">
          <div className="kpi-label">Past Due Entries</div>
          <div className="kpi-value">{overdueCount}</div>
          <div className="kpi-sub">
            {readOnly
              ? `across ${new Set((rows || []).map((r) => r.company_id)).size} companies${filtersActive ? ' (filtered)' : ''}`
              : `out of ${rows ? rows.length : '…'} ${showAll ? 'entries shown' : 'unpaid entries'}${filtersActive ? ' (filtered)' : ''}`}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Total Billed</div>
          <div className="kpi-value">{peso(totalAmount)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Total Paid</div>
          <div className="kpi-value">{peso(totalPaid)}</div>
        </div>
        <div className="kpi-card accent-red">
          <div className="kpi-label">{readOnly ? 'Still Owed' : 'Total Deduction'}</div>
          <div className="kpi-value">{peso(totalDeduction)}</div>
        </div>
      </div>
      )}

      {view === 'month' && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Summary by Month — {year}</h2>
          <p style={{ fontSize: 12.5, color: 'var(--slate)', margin: '-4px 0 14px' }}>
            Entries grouped by billing month{showAll || readOnly ? '' : ', unpaid entries only (tick "Include fully paid entries" to count paid ones too)'}. The company, status and search filters above apply.
          </p>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Month</th><th className="text-right">Entries</th><th className="text-right">Past Due</th>
                  <th className="text-right">Billed</th><th className="text-right">Paid</th><th className="text-right">{readOnly ? 'Still Owed' : 'Deduction'}</th>
                </tr>
              </thead>
              <tbody>
                {!rows && <tr><td colSpan={6} className="empty-state">Loading…</td></tr>}
                {rows && monthRows.map((m) => (
                  <tr key={m.name} style={m.entries === 0 ? { color: 'var(--slate)', opacity: 0.6 } : undefined}>
                    <td style={{ fontWeight: 600 }}>{m.name}</td>
                    <td className="text-right num">{m.entries}</td>
                    <td className="text-right num">{m.overdue}</td>
                    <td className="text-right num">{peso(m.billed)}</td>
                    <td className="text-right num">{peso(m.paid)}</td>
                    <td className="text-right num" style={{ fontWeight: 700 }}>{peso(m.owed)}</td>
                  </tr>
                ))}
              </tbody>
              {rows && (
                <tfoot>
                  <tr>
                    <td style={{ fontWeight: 700 }}>TOTAL {year}</td>
                    <td className="text-right num" style={{ fontWeight: 700 }}>{monthTotal.entries}</td>
                    <td className="text-right num" style={{ fontWeight: 700 }}>{monthTotal.overdue}</td>
                    <td className="text-right num" style={{ fontWeight: 700 }}>{peso(monthTotal.billed)}</td>
                    <td className="text-right num" style={{ fontWeight: 700 }}>{peso(monthTotal.paid)}</td>
                    <td className="text-right num" style={{ fontWeight: 700 }}>{peso(monthTotal.owed)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {view === 'entry' && (
      <div className="panel">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Company</th><th>Date of Billing</th><th className="text-right">Amount</th>
                <th className="text-right">Paid</th><th>Date Paid</th><th className="text-right">{readOnly ? 'Still Owed' : 'Deduction'}</th>
                <th>Comment</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {!rows && <tr><td colSpan={8} className="empty-state">Loading…</td></tr>}
              {rows && rows.length === 0 && (
                <tr><td colSpan={8} className="empty-state">{filtersActive ? (q ? `No entries match "${q}".` : 'Nothing matches these filters.') : (readOnly ? 'Nothing is past due right now. 🎉' : 'Nothing outstanding right now. 🎉')}</td></tr>
              )}
              {rows && rows.map((r) => (
                <tr
                  key={r.id}
                  {...(readOnly ? {} : {
                    className: 'clickable-row',
                    title: 'Open this entry in the Ledger',
                    onClick: () => navigate(`/ledger?company_id=${r.company_id}&entry=${r.id}`),
                  })}
                >
                  <td className={readOnly ? '' : 'row-link'}>{r.company_name}</td>
                  <td>{fdate(r.billing_date)}</td>
                  <td className="text-right num">{peso(r.amount)}</td>
                  <td className="text-right num">{peso(r.paid_amount)}</td>
                  <td>{r.payment_date ? fdate(r.payment_date) : '—'}</td>
                  <td className="text-right num" style={{ fontWeight: 700 }}>{peso(r.deduction ?? r.balance)}</td>
                  <td>{r.deduction_remarks || '—'}</td>
                  <td>
                    {statusBadge(r)}{' '}
                    {!r.is_paid && <span className={`badge ${AGING_BADGE[r.aging_bucket] || 'badge-secondary'}`}>{r.aging_bucket}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            {rows && rows.length > 0 && (
              <tfoot>
                <tr>
                  <td></td><td style={{ fontWeight: 700 }}>TOTAL</td>
                  <td className="text-right num" style={{ fontWeight: 700 }}>{peso(totalAmount)}</td>
                  <td className="text-right num" style={{ fontWeight: 700 }}>{peso(totalPaid)}</td>
                  <td></td>
                  <td className="text-right num" style={{ fontWeight: 700 }}>{peso(totalDeduction)}</td>
                  <td></td><td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      )}
    </div>
  );
}