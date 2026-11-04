import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';

const KINDS = [
  ['add', 'Added'], ['edit', 'Edited'], ['delete', 'Deleted'], ['paid', 'Paid'], ['release', 'Release'],
  ['clear', 'Cleared'], ['restore', 'Restored'], ['setting', 'Settings'], ['user', 'Users'], ['login', 'Sign in'], ['failed', 'Failed sign-in'],
];
const KIND_LABEL = Object.fromEntries(KINDS);
const ROLE_LABEL = { admin: 'Admin', accounting: 'Accounting', staff: 'Staff', branch: 'Branch', executive: 'Executive' };

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayYmd = () => ymd(new Date());
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + n); return ymd(d); };
const timeOf = (at) => { const [h, m] = at.slice(11, 16).split(':').map(Number); return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`; };
const dayLabel = (day) => {
  const t = todayYmd();
  const long = new Date(`${day}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return day === t ? { tag: 'Today', long } : day === addDays(t, -1) ? { tag: 'Yesterday', long } : { tag: '', long };
};
const initials = (r) => (r.full_name || r.username || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export default function Audit() {
  const { user } = useAuth();
  const [f, setF] = useState({ user: '', area: '', kind: '', from: '', to: '', search: '' });
  const [rows, setRows] = useState(null);
  const [more, setMore] = useState(false);
  const [users, setUsers] = useState([]);
  const [areas, setAreas] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState('all'); // today | week | all | custom
  const timer = useRef(null);

  const load = useCallback(async (filters, append = false, beforeId = 0) => {
    setBusy(true); setErr('');
    try {
      const r = await api.getAudit({ ...filters, before: beforeId || '', limit: 100 });
      setRows((cur) => (append ? [...(cur || []), ...r.rows] : r.rows));
      setMore(r.more); setUsers(r.users || []); setAreas(r.areas || []);
    } catch (e) { setErr(e.message); setRows((cur) => cur || []); }
    setBusy(false);
  }, []);

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => load(f), f.search ? 300 : 0);
    return () => clearTimeout(timer.current);
  }, [f, load]);

  const set = (patch) => setF((c) => ({ ...c, ...patch }));
  function pickRange(r) {
    setRange(r);
    const t = todayYmd();
    if (r === 'today') set({ from: t, to: t });
    else if (r === 'week') set({ from: addDays(t, -6), to: t });
    else if (r === 'all') set({ from: '', to: '' });
  }
  const anyFilter = f.user || f.area || f.kind || f.from || f.to || f.search;

  // group the rows by day, newest first
  const groups = [];
  for (const r of rows || []) {
    const day = r.at.slice(0, 10);
    if (!groups.length || groups[groups.length - 1].day !== day) groups.push({ day, items: [] });
    groups[groups.length - 1].items.push(r);
  }

  if (!user?.is_admin_role && !user?.is_executive) return <div className="panel"><p className="muted">Only an admin or executive can see the audit log.</p></div>;

  return (
    <div className="au-page">
      <div className="page-header">
        <div>
          <h1>Audit log</h1>
          <div className="subtitle">Everything the team does in the system: who added, edited, deleted, paid, released or cleared something, and when. Only Admin and Executive can see this, and it cannot be changed or deleted.</div>
        </div>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => load(f)}>{busy ? 'Refreshing…' : 'Refresh'}</button>
      </div>

      <div className="panel au-filters">
        <div className="au-range" role="tablist" aria-label="Period">
          {[['today', 'Today'], ['week', 'Last 7 days'], ['all', 'All time']].map(([k, label]) => (
            <button key={k} type="button" className={range === k ? 'on' : ''} onClick={() => pickRange(k)}>{label}</button>
          ))}
        </div>
        <div className="au-row">
          <label className="au-field"><span>Person</span>
            <select value={f.user} onChange={(e) => set({ user: e.target.value })}>
              <option value="">Everyone</option>
              {users.map((u) => <option key={u.username} value={u.username}>{u.full_name && u.full_name !== u.username ? `${u.full_name} (${u.username})` : u.username}{u.role ? ` · ${ROLE_LABEL[u.role] || u.role}` : ''}</option>)}
            </select>
          </label>
          <label className="au-field"><span>Where</span>
            <select value={f.area} onChange={(e) => set({ area: e.target.value })}>
              <option value="">Everywhere</option>
              {areas.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className="au-field"><span>From</span><input type="date" value={f.from} onChange={(e) => { setRange('custom'); set({ from: e.target.value }); }} /></label>
          <label className="au-field"><span>To</span><input type="date" value={f.to} onChange={(e) => { setRange('custom'); set({ to: e.target.value }); }} /></label>
          <label className="au-field au-grow"><span>Search</span><input type="search" placeholder="Payee, company, amount, SOA…" value={f.search} onChange={(e) => set({ search: e.target.value })} /></label>
        </div>
        <div className="au-kinds">
          <button type="button" className={`au-kind-chip ${f.kind === '' ? 'on' : ''}`} onClick={() => set({ kind: '' })}>All actions</button>
          {KINDS.map(([k, label]) => <button key={k} type="button" className={`au-kind-chip k-${k} ${f.kind === k ? 'on' : ''}`} onClick={() => set({ kind: f.kind === k ? '' : k })}>{label}</button>)}
          {anyFilter ? <button type="button" className="au-reset" onClick={() => { setRange('all'); setF({ user: '', area: '', kind: '', from: '', to: '', search: '' }); }}>Reset</button> : null}
        </div>
      </div>

      {err && <div className="flash flash-error">{err}</div>}

      {rows === null ? <div className="panel"><p className="muted">Loading…</p></div> : rows.length === 0 ? (
        <div className="panel au-empty">
          <strong>{anyFilter ? 'Nothing matches these filters.' : 'No activity recorded yet.'}</strong>
          <span>{anyFilter ? 'Try another person, day or action.' : 'From now on, every change in the system will show up here.'}</span>
        </div>
      ) : groups.map((g) => {
        const d = dayLabel(g.day);
        return (
          <section key={g.day} className="au-day">
            <div className="au-day-head"><h2>{d.tag || d.long}</h2>{d.tag ? <span>{d.long}</span> : null}<em>{g.items.length} {g.items.length === 1 ? 'action' : 'actions'}</em></div>
            <ul className="au-list">
              {g.items.map((r) => (
                <li key={r.id} className={`au-item k-${r.kind}`}>
                  <span className="au-time">{timeOf(r.at)}</span>
                  <span className="au-avatar" title={r.username}>{initials(r)}</span>
                  <div className="au-main">
                    <div className="au-who"><strong>{r.full_name || r.username}</strong><span className={`au-role r-${r.role}`}>{ROLE_LABEL[r.role] || r.role || 'Unknown'}</span><span className="au-area">{r.area}</span></div>
                    <div className="au-text">{r.summary}</div>
                  </div>
                  <span className={`au-tag k-${r.kind}`}>{KIND_LABEL[r.kind] || r.kind}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {more && rows && rows.length > 0 && (
        <div className="au-more"><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => load(f, true, rows[rows.length - 1].id)}>{busy ? 'Loading…' : 'Show older'}</button></div>
      )}
    </div>
  );
}