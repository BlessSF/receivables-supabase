import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { peso, fdate } from '../utils';
import { useAuth } from '../AuthContext';

// Dashboard for the owner / accounting accounts (read-only).
// Answers four questions at a glance: how much is owed, how late it is,
// is collection keeping up with billing, and who should be called first.

const BUCKETS = [
  { key: 'Not Yet Due', label: 'Not yet due', color: '#9aa7b8' },
  { key: '0-30 days', label: '1–30 days late', color: '#2f9e6e' },
  { key: '31-60 days', label: '31–60 days late', color: '#d49b22' },
  { key: '61-90 days', label: '61–90 days late', color: '#d9702a' },
  { key: 'Over 90 days', label: 'Over 90 days late', color: '#b02e25' },
  { key: 'N/A', label: 'No valid date', color: '#cfd6de' },
];

function compact(n) {
  const v = Math.abs(Number(n) || 0);
  if (v >= 1e6) return `₱${(v / 1e6).toFixed(v >= 1e7 ? 1 : 2)}M`;
  if (v >= 1e3) return `₱${(v / 1e3).toFixed(0)}K`;
  return `₱${v.toFixed(0)}`;
}

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Manila' }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
}

function TrendChart({ trend }) {
  const W = 640, H = 210, PAD_L = 8, PAD_B = 26, PAD_T = 12;
  const max = Math.max(1, ...trend.flatMap((t) => [t.billed, t.collected]));
  const slot = (W - PAD_L) / trend.length;
  const barW = Math.min(16, slot / 3);
  const y = (v) => PAD_T + (H - PAD_T - PAD_B) * (1 - v / max);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="exec-chart" role="img" aria-label="Billed vs collected, last 12 months">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={PAD_L} x2={W} y1={y(max * f)} y2={y(max * f)} stroke="#e4e8eb" strokeDasharray="3 4" />
      ))}
      {trend.map((t, i) => {
        const cx = PAD_L + slot * i + slot / 2;
        return (
          <g key={t.month}>
            <rect x={cx - barW - 1} y={y(t.billed)} width={barW} height={Math.max(0, H - PAD_B - y(t.billed))} rx="3" fill="#c9d3df">
              <title>{`${monthLabel(t.month)} billed: ${peso(t.billed)}`}</title>
            </rect>
            <rect x={cx + 1} y={y(t.collected)} width={barW} height={Math.max(0, H - PAD_B - y(t.collected))} rx="3" fill="#12756a">
              <title>{`${monthLabel(t.month)} collected: ${peso(t.collected)}`}</title>
            </rect>
            <text x={cx} y={H - 8} textAnchor="middle" className="exec-chart-label">{monthLabel(t.month)}</text>
          </g>
        );
      })}
      <line x1={PAD_L} x2={W} y1={H - PAD_B} y2={H - PAD_B} stroke="#cdd5db" />
    </svg>
  );
}

export default function ExecDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.getExecDashboard().then((r) => setData(r.data)).catch((e) => setErr(e.message));
  }, []);

  if (err) return <div className="flash flash-error">{err}</div>;
  if (!data) return <div className="loading-state">Loading dashboard…</div>;

  const t = data.totals;
  const name = (user?.full_name || user?.username || '').split(' ')[0];
  const bucketTotal = BUCKETS.reduce((s, b) => s + (data.buckets[b.key]?.total || 0), 0) || 1;
  const oldest = data.top_past_due.reduce((m, c) => Math.max(m, c.oldest_days), 0);
  const topMax = Math.max(1, ...data.top_past_due.map((c) => c.past_due));
  const last3 = data.trend.slice(-3);
  const billed3 = last3.reduce((s, m) => s + m.billed, 0);
  const collected3 = last3.reduce((s, m) => s + m.collected, 0);

  return (
    <div className="exec">
      <section className="exec-hero">
        <div className="exec-hero-date">{fdate(data.today, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div>
        <h1>{greeting()}, {name}.</h1>
        <p className="exec-hero-line">
          <strong>{peso(t.past_due)}</strong> is past due across <strong>{t.companies_past_due} {t.companies_past_due === 1 ? 'company' : 'companies'}</strong>
          {' '}— that's <strong>{t.past_due_share}%</strong> of everything still owed.
        </p>
      </section>

      <div className="exec-kpis">
        <div className="exec-kpi">
          <div className="exec-kpi-label">Still owed</div>
          <div className="exec-kpi-value">{peso(t.outstanding)}</div>
          <div className="exec-kpi-sub">{t.open_count} unpaid entries</div>
        </div>
        <div className="exec-kpi is-danger">
          <div className="exec-kpi-label">Past due</div>
          <div className="exec-kpi-value">{peso(t.past_due)}</div>
          <div className="exec-kpi-sub">{t.past_due_count} entries · {t.past_due_share}% of what's owed</div>
        </div>
        <div className="exec-kpi is-good">
          <div className="exec-kpi-label">Collected so far</div>
          <div className="exec-kpi-value">{peso(t.collected)}</div>
          <div className="exec-kpi-sub">{t.collection_rate}% of {peso(t.billed)} billed</div>
        </div>
        <div className="exec-kpi">
          <div className="exec-kpi-label">Oldest unpaid</div>
          <div className="exec-kpi-value">{oldest.toLocaleString()} <span className="exec-kpi-unit">days</span></div>
          <div className="exec-kpi-sub">past its due date</div>
        </div>
      </div>

      <section className="panel">
        <div className="exec-section-head">
          <h2>How late is the money?</h2>
          <Link to="/aging" className="exec-link">Open Aging Report →</Link>
        </div>
        <div className="exec-stack" role="img" aria-label="Outstanding balance by age">
          {BUCKETS.map((b) => {
            const v = data.buckets[b.key]?.total || 0;
            if (v <= 0) return null;
            return <div key={b.key} style={{ width: `${(v / bucketTotal) * 100}%`, background: b.color }} title={`${b.label}: ${peso(v)}`} />;
          })}
        </div>
        <div className="exec-legend">
          {BUCKETS.map((b) => {
            const bk = data.buckets[b.key] || { total: 0, count: 0 };
            if (bk.total <= 0) return null;
            return (
              <div key={b.key} className="exec-legend-item">
                <span className="exec-dot" style={{ background: b.color }} />
                <div>
                  <div className="exec-legend-label">{b.label}</div>
                  <div className="exec-legend-value">{peso(bk.total)} <span>· {bk.count} {bk.count === 1 ? 'entry' : 'entries'}</span></div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="exec-grid">
        <section className="panel">
          <div className="exec-section-head">
            <h2>Who to call first</h2>
            <Link to="/past-due" className="exec-link">All past due →</Link>
          </div>
          {data.top_past_due.length === 0 ? (
            <div className="empty-state">Nothing is past due. 🎉</div>
          ) : (
            <ol className="exec-callers">
              {data.top_past_due.map((c, i) => (
                <li key={c.id}>
                  <Link to={`/summary?company_id=${c.id}`} className="exec-caller" title={`See ${c.name}'s past-due entries`}>
                    <span className="exec-rank">{i + 1}</span>
                    <div className="exec-caller-main">
                      <div className="exec-caller-top">
                        <strong>{c.name}</strong>
                        <span className="num">{peso(c.past_due)}</span>
                      </div>
                      <div className="exec-caller-bar"><div style={{ width: `${(c.past_due / topMax) * 100}%` }} /></div>
                      <div className="exec-caller-meta">
                        {c.entries} past-due {c.entries === 1 ? 'entry' : 'entries'} · oldest{' '}
                        <span className={c.oldest_days > 90 ? 'text-danger' : ''}>{c.oldest_days.toLocaleString()} days late</span>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>

        <div className="exec-side">
          <section className="panel">
            <div className="exec-section-head">
              <h2>Billed vs collected</h2>
              <div className="exec-chart-key">
                <span><i style={{ background: '#c9d3df' }} />Billed</span>
                <span><i style={{ background: '#12756a' }} />Collected</span>
              </div>
            </div>
            <TrendChart trend={data.trend} />
            <p className="exec-note">
              Last 3 months: billed <strong>{compact(billed3)}</strong>, collected <strong>{compact(collected3)}</strong>
              {billed3 > 0 && <> — {collected3 >= billed3 ? 'collections are keeping up.' : 'collections are behind billing.'}</>}
            </p>
          </section>

          <section className="panel">
            <h2>Latest payments received</h2>
            {data.recent_payments.length === 0 ? (
              <div className="empty-state">No payments recorded yet.</div>
            ) : (
              <ul className="exec-payments">
                {data.recent_payments.map((p) => (
                  <li key={p.id}>
                    <div>
                      <strong>{p.company_name}</strong>
                      <span>{fdate(p.payment_date)}{p.soa_number ? ` · ${p.soa_number}` : ''}</span>
                    </div>
                    <span className="num exec-pay-amt">+{peso(p.paid_amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {t.overpaid_count > 0 && (
            <div className="exec-flag">
              <strong>{t.overpaid_count} entries</strong> show more paid than billed ({peso(t.overpaid_total)} in total).
              Ask the admin team to check them — they lower the "still owed" figure.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}