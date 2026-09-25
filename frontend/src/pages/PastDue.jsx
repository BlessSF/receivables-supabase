import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { peso, fdate, isExecutive } from '../utils';
import { useAuth } from '../AuthContext';

export default function PastDue() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const readOnly = isExecutive(user);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.getPastDue().then((r) => setData(r.data)).catch((e) => setErr(e.message));
  }, []);

  if (err) return <div className="flash flash-error">{err}</div>;
  if (!data) return <div className="loading-state">Loading past due accounts…</div>;

  const byCompany = Object.entries(data.by_company);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Past Due Accounts</h1>
          <div className="subtitle">Balances whose due date has already passed</div>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card accent-red">
          <div className="kpi-label">Total Past Due</div>
          <div className="kpi-value">{peso(data.total)}</div>
          <div className="kpi-sub">{data.entries.length} overdue entries across {byCompany.length} companies</div>
        </div>
      </div>

      <div className="panel">
        <h2>Past due by company</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Company</th><th className="text-right">Past Due Amount</th></tr></thead>
            <tbody>
              {byCompany.length === 0 && <tr><td colSpan={2} className="empty-state">Nothing is past due right now.</td></tr>}
              {byCompany.map(([name, total]) => (
                <tr key={name}><td>{name}</td><td className="text-right num">{peso(total)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h2>Past due entries</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Company</th><th>SOA #</th><th>Billing Date</th><th>Due Date</th><th className="text-right">Days Overdue</th><th className="text-right">Balance</th></tr>
            </thead>
            <tbody>
              {data.entries.length === 0 && <tr><td colSpan={6} className="empty-state">Nothing is past due right now.</td></tr>}
              {data.entries.map((r) => (
                <tr key={r.id} {...(readOnly ? {} : { className: 'clickable-row', title: 'Open this entry in the Ledger', onClick: () => navigate(`/ledger?company_id=${r.company_id}&entry=${r.id}`) })}>
                  <td className={readOnly ? '' : 'row-link'}>{r.company_name}</td>
                  <td>{r.soa_number || '—'}</td>
                  <td>{fdate(r.billing_date)}</td>
                  <td>{fdate(r.due)}</td>
                  <td className="text-right num">{r.days}</td>
                  <td className="text-right num">{peso(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}