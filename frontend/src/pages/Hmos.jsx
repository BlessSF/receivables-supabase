import { IconOpen, IconEdit } from '../icons';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { peso, fdate, coveredLabel, isStaff } from '../utils';
import { useAuth } from '../AuthContext';

const BLANK = { name: '', code: '', account_type: 'HMO', status: 'ACTIVE', contact_person: '', contact_number: '', email_address: '', remarks: '', branch: '' };
const STATUS_BADGE = { OPEN: 'badge-warning', POSTED: 'badge-success', VOID: 'badge-secondary' };
const n = (v) => Number(v) || 0;

export default function Hmos() {
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin;
  const staff = isStaff(user); // staff can look but not add / edit
  const [hmos, setHmos] = useState(null);
  const [branches, setBranches] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null); // detail view
  const [form, setForm] = useState(null); // null = hidden, object = add/edit
  const [flash, setFlash] = useState(null);
  const [busy, setBusy] = useState(false);

  function load() {
    api.getHmos().then((r) => setHmos(r.data)).catch((e) => setFlash({ type: 'error', msg: e.message }));
  }
  useEffect(() => {
    load();
    if (isAdmin) api.getBranches().then((r) => setBranches(r.data.branches || []));
  }, [isAdmin]);

  const filtered = useMemo(() => {
    if (!hmos) return null;
    const q = search.trim().toLowerCase();
    if (!q) return hmos;
    return hmos.filter((h) => [h.name, h.code, h.contact_person].filter(Boolean).join(' ').toLowerCase().includes(q));
  }, [hmos, search]);

  const totals = useMemo(() => {
    const t = { hmos: 0, open: 0, unpaidHmo: 0, unpaidPartners: 0 };
    (hmos || []).forEach((h) => {
      t.hmos += 1;
      t.open += n(h.open_amount);
      t.unpaidHmo += n(h.unpaid_hmo);
      t.unpaidPartners += n(h.unpaid_partners);
    });
    return t;
  }, [hmos]);

  const setF = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) { setFlash({ type: 'error', msg: 'HMO name is required.' }); return; }
    setBusy(true);
    try {
      const payload = { ...form, account_type: 'HMO' };
      if (form.id) await api.updateCompany(payload); else await api.createCompany(payload);
      setFlash({ type: 'success', msg: `HMO "${form.name}" ${form.id ? 'updated' : 'added'}.` });
      setForm(null);
      load();
    } catch (err) {
      setFlash({ type: 'error', msg: err.message });
    }
    setBusy(false);
  }

  if (form) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>{form.id ? 'Edit HMO' : 'Add HMO'}</h1>
            <div className="subtitle">HMO provider details</div>
          </div>
          <button className="btn btn-secondary btn-sm back-link" onClick={() => setForm(null)}>← Back</button>
        </div>
        {flash && <div className={`flash flash-${flash.type}`}>{flash.msg}</div>}
        <div className="panel">
          <form onSubmit={submit}>
            <div className="form-grid">
              <div className="form-group"><label>HMO name *</label><input required value={form.name} onChange={setF('name')} /></div>
              <div className="form-group"><label>Short code</label><input value={form.code || ''} onChange={setF('code')} /></div>
              <div className="form-group">
                <label>Status</label>
                <select value={form.status} onChange={setF('status')}>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                  <option value="BANKRUPT">BANKRUPT</option>
                </select>
              </div>
              <div className="form-group"><label>Contact person</label><input value={form.contact_person || ''} onChange={setF('contact_person')} /></div>
              <div className="form-group"><label>Contact number</label><input value={form.contact_number || ''} onChange={setF('contact_number')} /></div>
              <div className="form-group"><label>Email</label><input type="email" value={form.email_address || ''} onChange={setF('email_address')} /></div>
              {isAdmin && (
                <div className="form-group">
                  <label>Branch</label>
                  <select value={form.branch || ''} onChange={setF('branch')}>
                    <option value="">Unassigned / Shared</option>
                    {branches.map((b) => <option key={b.username} value={b.username}>{b.full_name || b.username}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="form-group" style={{ marginTop: 14 }}>
              <label>Remarks</label>
              <textarea rows={3} value={form.remarks || ''} onChange={setF('remarks')} />
            </div>
            <div className="form-actions">
              <button className="btn" type="submit" disabled={busy}>{form.id ? 'Save Changes' : 'Add HMO'}</button>
              <button className="btn btn-secondary" type="button" onClick={() => setForm(null)}>Cancel</button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  if (selectedId) {
    return (
      <HmoDetail
        id={selectedId}
        onBack={() => { setSelectedId(null); load(); }}
        onEdit={(h) => { setFlash(null); setForm({ ...BLANK, ...h }); }}
      />
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>HMOs</h1>
          <div className="subtitle">Partner HMO providers and the clinic charges billed to them or their partner companies</div>
        </div>
        {!staff && <button className="btn" onClick={() => { setFlash(null); setForm({ ...BLANK }); }}>+ Add HMO</button>}
      </div>

      {flash && <div className={`flash flash-${flash.type}`}>{flash.msg}</div>}

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">HMO providers</div>
          <div className="kpi-value">{hmos ? totals.hmos : '…'}</div>
          <div className="kpi-sub">on file</div>
        </div>
        <div className="kpi-card accent-amber">
          <div className="kpi-label">Open, not yet posted</div>
          <div className="kpi-value">{peso(totals.open)}</div>
          <div className="kpi-sub">waiting in Billing</div>
        </div>
        <div className="kpi-card accent-red">
          <div className="kpi-label">Unpaid, billed to HMOs</div>
          <div className="kpi-value">{peso(totals.unpaidHmo)}</div>
          <div className="kpi-sub">from posted charges</div>
        </div>
        <div className="kpi-card accent-red">
          <div className="kpi-label">Unpaid, billed to partner companies</div>
          <div className="kpi-value">{peso(totals.unpaidPartners)}</div>
          <div className="kpi-sub">from posted charges</div>
        </div>
      </div>

      <div className="panel">
        <div className="table-toolbar">
          <input className="table-search" placeholder="Search HMO name, code, contact…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <span className="table-toolbar-count">{filtered ? `${filtered.length} HMO${filtered.length === 1 ? '' : 's'}` : ''}</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>HMO</th><th>Status</th><th className="text-right">Partner companies</th>
                <th className="text-right">Open</th>
                <th className="text-right">Billed to HMO</th><th className="text-right">Billed to partners</th>
                <th className="text-right">Ledger balance</th><th></th>
              </tr>
            </thead>
            <tbody>
              {!filtered && <tr><td colSpan={8} className="empty-state">Loading…</td></tr>}
              {filtered && filtered.length === 0 && (
                <tr><td colSpan={8} className="empty-state">
                  {hmos.length
                    ? 'No HMOs match your search.'
                    : 'No HMOs yet. Click "+ Add HMO", or open Companies and change a partner HMO\'s type to HMO.'}
                </td></tr>
              )}
              {filtered && filtered.map((h) => (
                <tr key={h.id}>
                  <td><a style={{ cursor: 'pointer' }} onClick={() => { setFlash(null); setSelectedId(h.id); }}>{h.name}</a>{h.code ? <span style={{ color: 'var(--slate)' }}> · {h.code}</span> : null}</td>
                  <td><span className={`badge ${h.status === 'ACTIVE' ? 'badge-success' : 'badge-secondary'}`}>{h.status}</span></td>
                  <td className="text-right num">{h.partner_count}</td>
                  <td className="text-right num" title={`${h.open_count} open transaction(s)`}>{peso(h.open_amount)}</td>
                  <td className="text-right num" title={`Charged ${peso(h.billed_hmo)}, still unpaid ${peso(h.unpaid_hmo)}`}>{peso(h.unpaid_hmo)}</td>
                  <td className="text-right num" title={`Charged ${peso(h.billed_partners)}, still unpaid ${peso(h.unpaid_partners)}`}>{peso(h.unpaid_partners)}</td>
                  <td className="text-right num"><Link to={`/ledger?company_id=${h.id}`}>{peso(h.account_balance)}</Link></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-secondary btn-sm icon-btn" title="Open" aria-label="Open" onClick={() => { setFlash(null); setSelectedId(h.id); }}><IconOpen /></button>{!staff && <>
                    <button className="btn btn-secondary btn-sm icon-btn" title="Edit" aria-label="Edit" onClick={() => { setFlash(null); setForm({ ...BLANK, ...h }); }}><IconEdit /></button></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function HmoDetail({ id, onBack, onEdit }) {
  const { user } = useAuth();
  const staff = isStaff(user);
  const [data, setData] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [addId, setAddId] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [flash, setFlash] = useState(null);

  function load() {
    api.getHmo(id).then((r) => setData(r.data)).catch((e) => setFlash({ type: 'error', msg: e.message }));
  }
  useEffect(() => {
    load();
    api.getCompanies().then((r) => setCompanies(r.data));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const available = useMemo(() => {
    if (!data) return [];
    const have = new Set(data.partners.filter((p) => p.is_partner).map((p) => p.id));
    return companies.filter((c) => c.account_type === 'COMPANY' && !have.has(c.id));
  }, [companies, data]);

  const stats = useMemo(() => {
    const s = { openAmt: 0, hmoCharged: 0, hmoUnpaid: 0, coCharged: 0, coUnpaid: 0 };
    (data?.transactions || []).forEach((t) => {
      if (t.status === 'OPEN') s.openAmt += n(t.amount);
      if (t.status !== 'POSTED') return;
      if (t.bill_to === 'COMPANY') { s.coCharged += n(t.amount); s.coUnpaid += n(t.ledger_balance); }
      else { s.hmoCharged += n(t.amount); s.hmoUnpaid += n(t.ledger_balance); }
    });
    return s;
  }, [data]);

  const txns = useMemo(() => {
    const all = data?.transactions || [];
    return filter === 'ALL' ? all : all.filter((t) => t.status === filter);
  }, [data, filter]);

  async function addPartner() {
    if (!addId) return;
    try {
      const r = await api.addHmoPartner(id, addId);
      setFlash({ type: 'success', msg: r.message });
      setAddId('');
      load();
    } catch (e) { setFlash({ type: 'error', msg: e.message }); }
  }

  async function removePartner(p) {
    if (!confirm(`Remove ${p.name} from this HMO's partner companies? Its past charges stay as they are.`)) return;
    try {
      const r = await api.removeHmoPartner(id, p.id);
      setFlash({ type: 'success', msg: r.message });
      load();
    } catch (e) { setFlash({ type: 'error', msg: e.message }); }
  }

  if (!data) {
    return (
      <div>
        <div className="page-header"><div><h1>HMO</h1></div><button className="btn btn-secondary btn-sm back-link" onClick={onBack}>← Back to HMOs</button></div>
        {flash ? <div className={`flash flash-${flash.type}`}>{flash.msg}</div> : <div className="loading-state">Loading…</div>}
      </div>
    );
  }
  const hmo = data.hmo;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{hmo.name}</h1>
          <div className="subtitle">
            {[hmo.code, hmo.contact_person, hmo.contact_number, hmo.email_address].filter(Boolean).join(' · ') || 'HMO provider'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!staff && <Link className="btn" to={`/billing?hmo_id=${hmo.id}`}>+ New Charge</Link>}
          {!staff && <button className="btn btn-secondary" onClick={() => onEdit(hmo)}>Edit HMO</button>}
          <button className="btn btn-secondary btn-sm back-link" onClick={onBack}>← Back to HMOs</button>
        </div>
      </div>

      {flash && <div className={`flash flash-${flash.type}`}>{flash.msg}</div>}

      <div className="kpi-grid">
        <div className="kpi-card accent-amber">
          <div className="kpi-label">Open, not yet posted</div>
          <div className="kpi-value">{peso(stats.openAmt)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Billed to the HMO</div>
          <div className="kpi-value">{peso(stats.hmoCharged)}</div>
          <div className="kpi-sub">{peso(stats.hmoUnpaid)} still unpaid</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Billed to partner companies</div>
          <div className="kpi-value">{peso(stats.coCharged)}</div>
          <div className="kpi-sub">{peso(stats.coUnpaid)} still unpaid</div>
        </div>
      </div>

      <div className="panel">
        <h2>Partner companies</h2>
        {!staff && <div className="table-toolbar" style={{ gap: 8, flexWrap: 'wrap' }}>
          <select value={addId} onChange={(e) => setAddId(e.target.value)} style={{ minWidth: 240 }}>
            <option value="">Add a partner company…</option>
            {available.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="btn btn-sm" disabled={!addId} onClick={addPartner}>Add partner</button>
        </div>}
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Company</th><th className="text-right">Charges</th><th className="text-right">Billed to company</th><th className="text-right">Unpaid</th><th></th></tr></thead>
            <tbody>
              {data.partners.length === 0 && <tr><td colSpan={5} className="empty-state">No partner companies yet.{staff ? '' : ' Add the companies whose employees use this HMO.'}</td></tr>}
              {data.partners.map((p) => (
                <tr key={p.id}>
                  <td><Link to={`/ledger?company_id=${p.id}`}>{p.name}</Link>{!p.is_partner && <span className="badge badge-secondary" style={{ marginLeft: 8 }} title="Billed with this HMO but not added as a partner">not listed</span>}</td>
                  <td className="text-right num">{p.txn_count}</td>
                  <td className="text-right num">{peso(p.billed_to_company)}</td>
                  <td className="text-right num">{peso(p.unpaid)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {!staff && (p.is_partner
                      ? <button className="btn btn-danger btn-sm" onClick={() => removePartner(p)}>Remove</button>
                      : <button className="btn btn-secondary btn-sm" onClick={() => api.addHmoPartner(id, p.id).then(load)}>Add as partner</button>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h2>Charges</h2>
        <div className="table-toolbar">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[['ALL', 'All'], ['OPEN', 'Open'], ['POSTED', 'Posted'], ['VOID', 'Voided']].map(([k, label]) => (
              <button key={k} className={`btn btn-sm ${filter === k ? '' : 'btn-secondary'}`} onClick={() => setFilter(k)}>{label}</button>
            ))}
          </div>
          <span className="table-toolbar-count">{txns.length} charge{txns.length === 1 ? '' : 's'}</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>#</th><th>Billing Date</th><th>Covered Period</th><th>SOA #</th><th>Billed to</th><th className="text-right">Amount</th><th className="text-right">Unpaid</th><th>Status</th></tr>
            </thead>
            <tbody>
              {txns.length === 0 && <tr><td colSpan={8} className="empty-state">No charges here.{staff ? '' : ' Use "+ New Charge" to open one.'}</td></tr>}
              {txns.map((t) => (
                <tr key={t.id}>
                  <td className="num">{t.id}</td>
                  <td>{fdate(t.txn_date)}</td>
                  <td>{coveredLabel(t.period_from, t.period_to) || '—'}</td>
                  <td>{t.soa_number || '—'}</td>
                  <td>
                    {t.bill_to === 'COMPANY'
                      ? <><span className="badge badge-secondary">Company</span> {t.company_name || '—'}</>
                      : <><span className="badge badge-info">HMO</span> {hmo.name}</>}
                  </td>
                  <td className="text-right num">{peso(t.amount)}</td>
                  <td className="text-right num">{t.status === 'POSTED' ? peso(t.ledger_balance) : '—'}</td>
                  <td><span className={`badge ${STATUS_BADGE[t.status] || 'badge-secondary'}`}>{t.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}