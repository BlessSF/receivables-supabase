import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { peso, fdate, numClass } from '../utils';
import { useAuth } from '../AuthContext';

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.getDashboard().then((r) => setData(r.data)).catch((e) => setErr(e.message));
  }, []);

  if (err) return <div className="flash flash-error">{err}</div>;
  if (!data) return <div className="loading-state">Loading dashboard…</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <div className="subtitle">
            Overview of receivables across {data.total_companies} companies
            {user?.is_admin ? ' (all branches)' : ` — ${user?.full_name || user?.username} branch only`}
          </div>
        </div>
        <Link to="/ledger" className="btn">+ New ledger entry</Link>
      </div>

      <div className="kpi-dark-grid">
        <div className="kpi-dark-card">
          <div className="kpi-dark-label">Total billed</div>
          <div className="kpi-dark-value">{peso(data.total_billed)}</div>
          <div className="kpi-dark-track"><div className="kpi-dark-fill" style={{ width: '100%' }} /></div>
          <div className="kpi-dark-footer">
            <span className="kpi-dark-left">Across all companies</span>
            <span className="kpi-dark-right">{data.total_companies} companies</span>
          </div>
        </div>
        <div className="kpi-dark-card accent-green">
          <div className="kpi-dark-label">Total collected</div>
          <div className="kpi-dark-value">{peso(data.total_paid)}</div>
          <div className="kpi-dark-track"><div className="kpi-dark-fill" style={{ width: `${Math.min(100, data.collection_rate)}%` }} /></div>
          <div className="kpi-dark-footer">
            <span className="kpi-dark-left">Completed: {data.collection_rate}%</span>
            <span className="kpi-dark-right">Target: {peso(data.total_billed)}</span>
          </div>
        </div>
        <div className="kpi-dark-card accent-red">
          <div className="kpi-dark-label">Outstanding balance</div>
          <div className="kpi-dark-value">{peso(data.total_balance)}</div>
          <div className="kpi-dark-track"><div className="kpi-dark-fill" style={{ width: `${data.total_billed ? Math.min(100, (data.total_balance / data.total_billed) * 100) : 0}%` }} /></div>
          <div className="kpi-dark-footer">
            <span className="kpi-dark-left">Not yet collected</span>
            <span className="kpi-dark-right">of {peso(data.total_billed)}</span>
          </div>
        </div>
        <div className="kpi-dark-card accent-amber">
          <div className="kpi-dark-label">Past due</div>
          <div className="kpi-dark-value">{peso(data.past_due_total)}</div>
          <div className="kpi-dark-track"><div className="kpi-dark-fill" style={{ width: `${data.total_balance ? Math.min(100, (data.past_due_total / data.total_balance) * 100) : 0}%` }} /></div>
          <div className="kpi-dark-footer">
            <span className="kpi-dark-left">{data.past_due_count} overdue entries</span>
            <span className="kpi-dark-right">of {peso(data.total_balance)} outstanding</span>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Top outstanding companies</h2>
        {data.top_outstanding.length === 0 ? (
          <div className="empty-state">No outstanding balances.</div>
        ) : (
          <ol className="rank-list">
            {(() => {
              const max = Math.max(...data.top_outstanding.map((c) => Number(c.outstanding) || 0), 1);
              return data.top_outstanding.map((c, i) => (
                <li key={c.id}>
                  <Link to={`/ledger?company_id=${c.id}`} className="rank-row" title={`Open ${c.name} in the Ledger`}>
                    <span className="rank-pos">{i + 1}</span>
                    <span className="rank-name">
                      <span>{c.name}</span>
                      {c.status !== 'ACTIVE' && (
                        <span className={`badge ${c.status === 'BANKRUPT' ? 'badge-danger' : 'badge-secondary'}`}>{c.status}</span>
                      )}
                    </span>
                    <span className="rank-bar" aria-hidden="true">
                      <i style={{ width: `${Math.max(2, ((Number(c.outstanding) || 0) / max) * 100)}%` }} />
                    </span>
                    <span className="rank-amount num">{peso(c.outstanding)}</span>
                  </Link>
                </li>
              ));
            })()}
          </ol>
        )}
      </div>

      <div className="panel">
        <h2>Recent ledger activity</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Company</th><th>Billing date</th><th>SOA #</th><th className="text-right">Amount</th><th className="text-right">Balance</th></tr></thead>
            <tbody>
              {data.recent.length === 0 && (
                <tr><td colSpan={5} className="empty-state">No ledger entries yet.</td></tr>
              )}
              {data.recent.map((r) => (
                <tr key={r.id} className="clickable-row" title="Open this entry in the Ledger" onClick={() => navigate(`/ledger?company_id=${r.company_id}&entry=${r.id}`)}>
                  <td className="row-link">{r.company_name}</td>
                  <td>{fdate(r.billing_date)}</td>
                  <td>{r.soa_number || '—'}</td>
                  <td className={`text-right ${numClass(r.amount)}`}>{peso(r.amount)}</td>
                  <td className={`text-right ${numClass(r.balance)}`}>{peso(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}