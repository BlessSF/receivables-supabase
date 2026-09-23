import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { peso, fdate, AGING_BADGE } from '../utils';

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

export default function Summary() {
  const navigate = useNavigate();
  const [companies, setCompanies] = useState([]);
  const [companyId, setCompanyId] = useState('');
  const [aging, setAging] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => { api.getCompanies().then((r) => setCompanies(r.data)); }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      api.getSummary({ company_id: companyId, aging, show_all: showAll ? 1 : 0, q })
        .then((r) => setRows(sortSummary(r.data)))
        .catch((e) => setErr(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [companyId, aging, showAll, q]);

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
          <h1>Summary{selectedCompany ? ` — ${selectedCompany.name}` : ''}</h1>
          <div className="subtitle">
            {showAll ? 'Every entry' : 'Every unpaid entry'}{selectedCompany ? '' : ' across all companies'} — billed, paid, deduction, and how long it's been outstanding.
          </div>
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
              {BUCKET_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, paddingBottom: 9 }}>
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Include fully paid entries
          </label>
          {filtersActive && <button className="btn btn-secondary btn-sm" onClick={clearFilters}>Clear filters</button>}
        </div>
      </div>

      {err && <div className="flash flash-error">{err}</div>}

      <div className="kpi-grid">
        <div className="kpi-card accent-red">
          <div className="kpi-label">Past Due Entries</div>
          <div className="kpi-value">{overdueCount}</div>
          <div className="kpi-sub">out of {rows ? rows.length : '…'} {showAll ? 'entries shown' : 'unpaid entries'}{filtersActive ? ' (filtered)' : ''}</div>
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
          <div className="kpi-label">Total Deduction</div>
          <div className="kpi-value">{peso(totalDeduction)}</div>
        </div>
      </div>

      <div className="panel">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Company</th><th>Date of Billing</th><th className="text-right">Amount</th>
                <th className="text-right">Paid</th><th>Date Paid</th><th className="text-right">Deduction</th>
                <th>Comment</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {!rows && <tr><td colSpan={8} className="empty-state">Loading…</td></tr>}
              {rows && rows.length === 0 && (
                <tr><td colSpan={8} className="empty-state">{filtersActive ? (q ? `No entries match "${q}".` : 'Nothing matches these filters.') : 'Nothing outstanding right now. 🎉'}</td></tr>
              )}
              {rows && rows.map((r) => (
                <tr
                  key={r.id}
                  className="clickable-row"
                  title="Open this entry in the Ledger"
                  onClick={() => navigate(`/ledger?company_id=${r.company_id}&entry=${r.id}`)}
                >
                  <td className="row-link">{r.company_name}</td>
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
    </div>
  );
}
