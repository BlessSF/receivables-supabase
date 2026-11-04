import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { IconUndo, IconChecklist, IconTable, IconBuilding, IconHash, IconActivity, IconCoins } from '../icons';

const ROLE_LABEL = { admin: 'Admin', accounting: 'Accounting', staff: 'Staff', branch: 'Branch', executive: 'Executive' };
const KIND = {
  payable: { name: 'Payable', Icon: IconChecklist },
  payables: { name: 'Clear all', Icon: IconChecklist },
  ledger: { name: 'Ledger entry', Icon: IconTable },
  payment: { name: 'Payment', Icon: IconCoins },
  company: { name: 'Company', Icon: IconBuilding },
  monitoring: { name: 'Monitoring', Icon: IconActivity },
  soa: { name: 'SOA number', Icon: IconHash },
};

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function whenLabel(at) {
  const day = at.slice(0, 10);
  const t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1);
  const [h, m] = at.slice(11, 16).split(':').map(Number);
  const time = `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
  if (day === ymd(t)) return `Today, ${time}`;
  if (day === ymd(y)) return `Yesterday, ${time}`;
  return `${new Date(`${day}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}, ${time}`;
}

export default function DeletedItems() {
  const { user } = useAuth();
  const [rows, setRows] = useState(null);
  const [tab, setTab] = useState('all');
  const [flash, setFlash] = useState(null);
  const [busyId, setBusyId] = useState(0);
  const [keep, setKeep] = useState(30);
  const seeAll = user?.is_admin_role || user?.is_executive;

  const load = useCallback(() => api.getDeleted().then((r) => { setRows(r.rows || []); setKeep(r.keep_days || 30); })
    .catch((e) => { setFlash({ type: 'error', msg: e.message }); setRows([]); }), []);
  useEffect(() => { load(); }, [load]);

  async function restore(it) {
    setBusyId(it.id); setFlash(null);
    try { const r = await api.restoreDeleted(it.id); setFlash({ type: 'success', msg: r.message }); await load(); }
    catch (e) { setFlash({ type: 'error', msg: e.message }); }
    setBusyId(0);
  }

  const list = (rows || []).filter((r) => tab === 'all' || r.area === tab);
  const count = (a) => (rows || []).filter((r) => a === 'all' || r.area === a).length;

  return (
    <div className="dl-page">
      <div className="page-header">
        <div>
          <h1>Recently deleted</h1>
          <div className="subtitle">
            Deleted something by mistake? Press Restore and it comes back exactly as it was, with its payments and links.
            Items stay here for {keep} days, then are removed for good.{seeAll ? '' : ' You see only what you deleted yourself.'}
          </div>
        </div>
      </div>

      {flash && <div className={`flash flash-${flash.type}`}>{flash.msg}</div>}

      <div className="dl-tabs" role="tablist">
        {[['all', 'All'], ['Payables', 'Payables'], ['Receivables', 'Receivables']].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}<b>{count(k)}</b></button>
        ))}
      </div>

      {rows === null ? <div className="panel"><p className="muted">Loading…</p></div> : list.length === 0 ? (
        <div className="panel dl-empty">
          <span className="dl-empty-ic"><IconUndo /></span>
          <strong>Nothing deleted recently.</strong>
          <span>When something is deleted, you can bring it back from here.</span>
        </div>
      ) : (
        <ul className="dl-list">
          {list.map((it) => {
            const k = KIND[it.kind] || { name: it.kind, Icon: IconUndo };
            const Ic = k.Icon;
            return (
              <li key={it.id} className="dl-item">
                <span className={`dl-ic a-${it.area}`}><Ic /></span>
                <div className="dl-main">
                  <div className="dl-top">
                    <span className="dl-kind">{k.name}</span>
                    <span className={`dl-area a-${it.area}`}>{it.area}</span>
                  </div>
                  <div className="dl-label">{it.label}</div>
                  {it.detail ? <div className="dl-detail">{it.detail}</div> : null}
                  <div className="dl-by">Deleted by <strong>{it.by_name || it.by_user}</strong> <span className={`au-role r-${it.by_role}`}>{ROLE_LABEL[it.by_role] || it.by_role}</span> · {whenLabel(it.at)}</div>
                </div>
                <div className="dl-side">
                  <span className={`dl-left ${it.days_left <= 3 ? 'low' : ''}`}>{it.days_left} {it.days_left === 1 ? 'day' : 'days'} left</span>
                  <button type="button" className="btn" disabled={busyId === it.id} onClick={() => restore(it)}>{busyId === it.id ? 'Restoring…' : 'Restore'}</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}