import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '../api';
import { peso, money, AGING_BADGE, fdate, timeAgo, periodLabel, periodParts, coveredLabel, formatLongDate, isStaff, isExecutive } from '../utils';
import { useAuth } from '../AuthContext';
import MoneyInput, { fmtNum } from '../MoneyInput';
import { GRID_ID, gridKeyDown, DateCell, RemarksCell, CoveredCell } from '../gridCells';

let measureCtx = null;
function getMeasureCtx() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}

// Trash-can icon (outline style) for the Delete button
function TrashIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.5 6a2.5 2.5 0 0 1 5 0" />
      <path d="M4 6h16" />
      <path d="M6 6v11a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V6" />
      <path d="M10 10v6M14 10v6" />
    </svg>
  );
}

const r2 = (n) => Math.round(n * 100) / 100;
// Tax W/H, Rebate, Receivable and Balance worked out from the typed numbers (see the Ledger formulas).
function deriveRow(e, taxPct, amountOverride, paidOverride) {
  const amount = amountOverride !== undefined ? amountOverride : Number(e.amount) || 0;
  const paid = paidOverride !== undefined ? paidOverride : Number(e.paid_amount) || 0;
  const tax = r2((amount * taxPct) / 100);
  const base = amount - tax + (Number(e.surcharge) || 0);
  const rebate = paid > 0 ? Math.max(0, r2(base - paid)) : 0;
  return { tax_withheld: tax, rebate, receivable_amount: r2(base - rebate), balance: r2(amount - paid) };
}

function EditableText({ value, onSave, onLive, type = 'text', align, row, col }) {
  const [val, setVal] = useState(value ?? '');
  const [state, setState] = useState(''); // '', 'saving', 'saved', 'error'
  useEffect(() => setVal(value ?? ''), [value]);

  const isNum = type === 'number';
  const isZero = (v) => v === '' || v === null || v === undefined || Number(v) === 0;

  // A 0.00 amount is cleared when you click in, so you can type straight away
  // without erasing it first. Left empty, it goes back to showing 0.00.
  function onFocus() {
    if (isNum && isZero(val)) setVal('');
  }

  async function commit() {
    if (isNum && isZero(val) && isZero(value)) { setVal(value ?? ''); return; } // still zero: nothing to save
    if (isNum && Number(val) === Number(value)) return; // same number, nothing to save
    if ((val || '') === (value ?? '')) return;
    setState('saving');
    try {
      await onSave(val);
      setState('saved');
      setTimeout(() => setState(''), 700);
    } catch (e) {
      setState('error');
      if (e.message) alert(e.message);
      setVal(value ?? '');
    }
  }

  const onKeyDown = (e) => gridKeyDown(e, row, col, type === 'text');

  return (
    <div className={`editable-cell ${state}`} data-r={row} data-c={col}>
      {isNum ? (
        <MoneyInput
          className="num"
          style={align ? { textAlign: align } : undefined}
          value={val}
          placeholder="0.00"
          onChange={(v) => { setVal(v); if (onLive) onLive(v); }}
          onFocus={onFocus}
          onBlur={async () => { await commit(); if (onLive) onLive(null); }}
          onKeyDown={onKeyDown}
        />
      ) : (
        <input
          type={type}
          style={align ? { textAlign: align } : undefined}
          value={val}
          onChange={(e) => { setVal(e.target.value); if (onLive) onLive(e.target.value); }}
          onFocus={onFocus}
          onBlur={async () => { await commit(); if (onLive) onLive(null); }}
          onKeyDown={onKeyDown}
        />
      )}
    </div>
  );
}

export default function Ledger() {
  const { user } = useAuth();
  const staff = isStaff(user); // staff can edit only the highlighted Payment Date / Check Ref / Paid cells
  const exec = isExecutive(user); // executives edit and delete like Admin
  const canDelete = !!user?.is_admin || exec; // only Admin and Executive can delete; Staff and Branch cannot
  const [params, setParams] = useSearchParams();
  const companyId = params.get('company_id') || '';
  const entryParam = params.get('entry');
  const [companies, setCompanies] = useState([]);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [search, setSearch] = useState('');
  const [highlightId, setHighlightId] = useState(null);

  const reload = useCallback(() => {
    api.getLedger(companyId || null).then((r) => setData(r.data)).catch((e) => setErr(e.message));
  }, [companyId]);

  useEffect(() => { api.getCompanies().then((r) => setCompanies(r.data)); }, []);
  useEffect(reload, [reload]);

  // Arrived here from a Summary / Past Due / Dashboard row click ("?entry=123"):
  // scroll to that ledger row and keep it highlighted so it's obvious which
  // one it was. The highlight stays until you click another row.
  useEffect(() => {
    if (!entryParam || !data) return;
    setSearch('');
    flashRow(entryParam);
  }, [entryParam, data]); // eslint-disable-line react-hooks/exhaustive-deps

  function flashRow(id) {
    const key = String(id);
    setHighlightId(key);
    // wait for the row to be on screen, then bring it into view
    let tries = 0;
    const go = () => {
      const el = document.getElementById(`entry-${key}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      else if (tries++ < 10) setTimeout(go, 80);
    };
    requestAnimationFrame(go);
  }

  const entries = data?.entries || [];

  // While a Paid amount is being typed, the row balance, the Paid / Outstanding
  // totals and the aging badges update on every keystroke (before it is saved).
  const [live, setLive] = useState(null); // { id, field, value }
  // Tax W/H, Rebate and Receivable are computed automatically for every row (view only):
  //   Tax W/H = Amount x tax %,  Rebate = Amount - Tax W/H + Surcharge - Paid (only once something is paid),
  //   Receivable = Amount - Tax W/H + Surcharge - Rebate,  Balance = Amount - Paid.
  const taxPct = Number(data?.tax_percent ?? 2);
  const liveEntries = useMemo(() => entries.map((e) => {
    const isLive = live && e.id === live.id;
    const ao = isLive && live.field === 'amount' ? Number(live.value) || 0 : undefined;
    const po = isLive && live.field === 'paid_amount' ? Number(live.value) || 0 : undefined;
    return {
      ...e,
      ...(ao !== undefined ? { live_amount: ao } : {}),
      ...(po !== undefined ? { live_paid: po } : {}),
      ...deriveRow(e, taxPct, ao, po),
    };
  }), [entries, live, taxPct]);
  const liveTotals = useMemo(() => {
    let amount = 0, paid = 0, balance = 0, rebate = 0;
    const tally = {};
    for (const e of liveEntries) {
      amount += e.live_amount !== undefined ? e.live_amount : Number(e.amount) || 0;
      paid += e.live_paid !== undefined ? e.live_paid : Number(e.paid_amount) || 0;
      rebate += Number(e.rebate) || 0;
      const b = Number(e.balance) || 0;
      balance += b;
      if (b > 0.009 && e.aging_bucket && e.aging_bucket !== 'Paid') tally[e.aging_bucket] = (tally[e.aging_bucket] || 0) + b;
    }
    return { amount, paid, balance, rebate, tally };
  }, [liveEntries]);

  const filtered = useMemo(() => {
    if (!search.trim()) return liveEntries;
    const q = search.trim().toLowerCase();
    return liveEntries.filter((r) =>
      [r.company_name, r.soa_number, r.remarks, r.billing_date, coveredLabel(r.period_from, r.period_to, r.period_date)].filter(Boolean).join(' ').toLowerCase().includes(q)
    );
  }, [liveEntries, search]);

  const periodYears = useMemo(() => {
    const now = new Date().getFullYear();
    const seen = entries.map((r) => periodParts(r.period_date)?.y).filter(Boolean);
    const lo = Math.min(now - 2, ...seen);
    const hi = Math.max(now + 1, ...seen);
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  }, [entries]);

  const ACTIVITY_LIMIT = 60;
  const activityRows = useMemo(() => {
    return [...filtered]
      .sort((a, b) => new Date(b.created_at || b.billing_date || 0) - new Date(a.created_at || a.billing_date || 0))
      .slice(0, ACTIVITY_LIMIT);
  }, [filtered]);

  // ---- Auto-fit ledger grid ----
  // Each column's width is measured from its longest value (a column holding
  // millions gets wider, one holding 0.00 gets narrower). If all the columns
  // still don't fit the screen, the grid's text shrinks a little until they
  // do -- so nothing is ever cut off and there's no sideways scrolling.
  const BASE_FONT = 13;
  const colPx = useMemo(() => {
    const ctx = getMeasureCtx();
    const fam = getComputedStyle(document.body).fontFamily || 'sans-serif';
    ctx.font = `${BASE_FONT}px ${fam}`;
    const SAFE = 1.12; // tabular figures + 100% zoom render a bit wider than the canvas measures
    const tw = (v) => ctx.measureText(String(v ?? '')).width * SAFE;
    const rows = entries.map((e) => ({ ...e, ...deriveRow(e, taxPct) })); // measure the computed Tax W/H, Rebate and Receivable too
    const widest = (key, fmt = (v) => v, min = '') =>
      rows.reduce((m, r) => Math.max(m, tw(fmt(r[key]))), tw(min));
    ctx.font = `600 ${BASE_FONT}px ${fam}`;
    const bold = (key) => rows.reduce((m, r) => Math.max(m, ctx.measureText(peso(r[key])).width * SAFE), ctx.measureText('₱0.00').width * SAFE);
    const balanceW = bold('balance');
    ctx.font = `${BASE_FONT}px ${fam}`;
    const INPUT = 27;   // input padding + border + cell padding (+ a little room)
    const CELL = 24;    // plain cell padding
    const RO = CELL + 16; // read-only text cell: cell padding + the text's own side padding + a little room
    const DATE = tw('September 30, 2026') + 40; // longest date text + calendar icon + padding
    const PERIOD = tw('Sept 30, 2026 to Sept 30, 2026') + 34; // longest covered period text
    const cap = (px, maxChars) => Math.min(px, tw('0'.repeat(maxChars)));
    // A column is never narrower than the longest word of its header
    ctx.font = `600 ${BASE_FONT * 0.9}px ${fam}`;
    const HEADERS = ['Billing Date', 'Covered Period', 'SOA #', 'Amount', 'Tax W/H', 'Surcharge', 'Rebate', 'Receivable',
      'Payment Date', 'Check Ref', 'Paid', 'Balance', 'Aging', 'Remarks', ...(canDelete ? ['Action'] : [])];
    const headerMin = HEADERS.map((h) => Math.max(0, ...h.split(' ').map((word) => ctx.measureText(word).width * SAFE)) + 22);
    ctx.font = `${BASE_FONT}px ${fam}`;
    return [
      DATE + 10,                                              // Billing Date (first column has extra left padding)
      PERIOD - 14,                                            // Covered Period
      cap(widest('soa_number', undefined, 'SOA #0'), 22) + RO,
      widest('amount', money, '0.00') + RO,
      widest('tax_withheld', money, '0.00') + RO,
      widest('surcharge', money, '0.00') + RO,
      widest('rebate', money, '0.00') + RO,
      widest('receivable_amount', peso, '₱0.00') + CELL,
      DATE,                                                   // Payment Date
      // Check Ref always has room for a long check number (14 digits) and grows past that if a longer one is saved
      Math.min(Math.max(widest('check_ref', undefined, 'Check'), tw('0'.repeat(14))), tw('0'.repeat(26))) + INPUT,
      // Paid always has room for an 8-digit amount with centavos (12,345,678.00 typed as 12345678.00) and grows past that if a bigger one is saved
      Math.min(Math.max(widest('paid_amount', fmtNum, '0.00'), tw('0'.repeat(12))), tw('0'.repeat(20))) + INPUT,
      balanceW + CELL,
      tw('0,000 days') + 30,                                  // Aging badge
      cap(widest('remarks', undefined, 'Remarks'), 14) + INPUT,
      ...(canDelete ? [58] : []),             // Delete button (Admin / Executive only)
    ].map((px, i) => Math.max(px, headerMin[i]));
  }, [entries, canDelete, taxPct]);
  const MIN_FONT = 10.5;
  const colWidths = useMemo(() => {
    const total = colPx.reduce((a, b) => a + b, 0);
    return colPx.map((x) => `${((x / total) * 100).toFixed(2)}%`);
  }, [colPx]);

  const gridWrapRef = useRef(null);
  const [gridFont, setGridFont] = useState(BASE_FONT);
  const [gridScroll, setGridScroll] = useState(false); // too narrow even at the smallest text: scroll sideways instead of cutting cells off
  const neededPx = colPx.reduce((a, b) => a + b, 0);
  useLayoutEffect(() => {
    const el = gridWrapRef.current;
    if (!el) return undefined;
    const needed = colPx.reduce((a, b) => a + b, 0);
    const fit = () => {
      const avail = el.clientWidth;
      if (!avail) return;
      const scaled = BASE_FONT * Math.min(1.04, avail / needed);
      setGridFont(Math.max(MIN_FONT, Math.min(13.5, Math.floor(scaled * 4) / 4)));
      setGridScroll(scaled < MIN_FONT - 0.01);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [colPx, data]);

  async function saveField(id, field, value) {
    let r;
    // Rebate = Receivable - Paid, filled in automatically whenever a Paid amount is entered.
    const autoRebate = field === 'paid_amount' && (Number(value) || 0) > 0;
    try {
      r = await api.inlineUpdateLedger(id, field, value, false, autoRebate);
    } catch (e) {
      // Same SOA already on another entry (e.g. two payments for one SOA): ask before allowing it.
      if (e.code !== 'SOA_SHARED') throw e;
      const ok = window.confirm(`${e.message}\n\nDo these 2 payments share the same SOA?\n\nOK = yes, use the same SOA on both. The SOA Tracker will show it as shared (x2) and it still counts as ONE SOA number.\nCancel = don't change it.`);
      if (!ok) throw new Error(''); // quiet revert
      r = await api.inlineUpdateLedger(id, field, value, true, autoRebate);
    }
    setData((d) => ({
      ...d,
      entries: d.entries.map((e) =>
        e.id === id ? { ...e, [field]: value, ...(r.rebate !== null && r.rebate !== undefined ? { rebate: r.rebate } : {}), ...(r.tax_withheld !== null && r.tax_withheld !== undefined ? { tax_withheld: r.tax_withheld } : {}), receivable_amount: r.receivable_amount, balance: r.balance } : e
      ),
    }));
    // Paid / amounts change the aging buckets and Paid status: refresh them quietly.
    if (companyId && ['paid_amount', 'amount', 'tax_withheld', 'surcharge', 'rebate'].includes(field)) reload();
  }

  async function deleteRow(r) {
    const label = `${r.soa_number ? `SOA ${r.soa_number}` : 'this entry'} (${peso(r.amount)})`;
    if (!confirm(`Delete ${label} from the ledger? This cannot be undone.`)) return;
    try {
      await api.deleteLedger(r.id);
      setData((d) => ({ ...d, entries: d.entries.filter((e) => e.id !== r.id) }));
      if (companyId) reload(); // refresh the Billed / Paid / Outstanding totals
    } catch (e) {
      alert(e.message);
    }
  }

  async function saveCovered(id, v) {
    const r = await api.inlineUpdateLedger(id, 'covered_period', v);
    const [pf, pt] = v ? v.split('|') : [null, null];
    setData((d) => ({
      ...d,
      entries: d.entries.map((e) =>
        e.id === id ? { ...e, period_from: pf, period_to: pt, period_date: pf ? `${pf.slice(0, 7)}-01` : null, receivable_amount: r.receivable_amount, balance: r.balance } : e
      ),
    }));
  }

  async function addRow() {
    if (!companyId) { alert('Choose a company first.'); return; }
    const res = await api.quickAddLedger(companyId);
    const r = await api.getLedger(companyId);
    setData(r.data);
    // Wait a tick for the new row to actually be in the DOM before scrolling to it.
    setTimeout(() => flashRow(res.id), 60);
  }

  if (err) return <div className="flash flash-error">{err}</div>;
  if (!data) return <div className="loading-state">Loading ledger…</div>;

  const company = data.company;

  return (
    <div>
      <div className="page-header">
        <div>
          {company && <Link to="/ledger" className="btn btn-secondary btn-sm back-link">← Back to All Companies</Link>}
          <h1>Receivable Ledger{company ? ` — ${company.name}` : ''}</h1>
          <div className="subtitle">{company ? (staff ? 'You can edit the highlighted columns only: Payment Date, Check Ref and Paid. Changes save automatically.' : 'Click any cell to edit — it saves automatically. Use arrow keys or Enter to move between cells, like a spreadsheet.') : 'All companies — pick one below to focus, or filter with search'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="select-inline" value={companyId} onChange={(e) => setParams(e.target.value ? { company_id: e.target.value } : {})}>
            <option value="">All companies…</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}{c.account_type === 'CHARGE' ? ' (Charge)' : ''}</option>)}
          </select>
          {!exec && <a className="btn btn-secondary" href={`/export_csv.php?type=ledger${companyId ? `&company_id=${companyId}` : ''}`}>Export CSV</a>}
          {!exec && <a className="btn btn-secondary" href={`/export_xlsx.php?type=ledger${companyId ? `&company_id=${companyId}` : ''}`}>Export XLSX</a>}
          {companyId && !staff && <button className="btn" onClick={addRow}>+ New Entry</button>}
        </div>
      </div>

      {company && (
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>
                {company.name}
                <span className={`tag-status ${company.status === 'ACTIVE' ? 'tag-active' : company.status === 'BANKRUPT' ? 'tag-bankrupt' : 'tag-inactive'}`}>{company.status}</span>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--slate)', marginTop: 4 }}>
                {company.code && <span style={{ marginRight: 14 }}><strong>Code:</strong> {company.code}</span>}
                {company.contact_person && <span style={{ marginRight: 14 }}><strong>Contact:</strong> {company.contact_person}</span>}
                {company.contact_number && <span><strong>Phone:</strong> {company.contact_number}</span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              <div><div style={{ fontSize: 11, color: 'var(--slate)' }}>Entries</div><strong className="num">{entries.length}</strong></div>
              <div><div style={{ fontSize: 11, color: 'var(--slate)' }}>Billed</div><strong className="num">{peso(liveTotals.amount)}</strong></div>
              <div><div style={{ fontSize: 11, color: 'var(--slate)' }}>Paid</div><strong className="num totals-live">{peso(liveTotals.paid)}</strong></div>
              <div><div style={{ fontSize: 11, color: 'var(--slate)' }}>Rebate</div><strong className="num totals-live">{peso(liveTotals.rebate)}</strong></div>
              <div><div style={{ fontSize: 11, color: 'var(--teal)' }}>Outstanding</div><strong className="num totals-live" style={{ color: 'var(--teal)' }}>{peso(liveTotals.balance)}</strong></div>
            </div>
          </div>
          {Object.keys(liveTotals.tally).length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {Object.entries(liveTotals.tally).map(([bucket, total]) => (
                <span key={bucket} className={`badge ${AGING_BADGE[bucket] || 'badge-secondary'}`}>{bucket}: {peso(total)}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {!company && data.company_summary && data.company_summary.length > 0 && [
        { key: 'hmo', title: 'HMOs', list: data.company_summary.filter((c) => c.account_type !== 'CHARGE') },
        { key: 'charge', title: 'Company Charges', list: data.company_summary.filter((c) => c.account_type === 'CHARGE') },
      ].filter((g) => g.list.length > 0).map((g) => (
        <div className="panel" key={g.key}>
          <h2>{g.title} — Outstanding &amp; Aging</h2>
          <div className="company-card-grid">
            {g.list.map((c) => {
              const hasBalance = c.outstanding > 0.009;
              const overdue = hasBalance && c.worst_days_overdue !== null && c.worst_days_overdue !== undefined;
              const dueSoon = hasBalance && !overdue && c.soonest_days_until_due !== null && c.soonest_days_until_due !== undefined;
              const accent = overdue ? 'accent-red' : hasBalance ? 'accent-amber' : 'accent-green';
              return (
                <Link
                  key={c.id}
                  to={`/ledger?company_id=${c.id}`}
                  className={`company-card ${accent}`}
                  title={`Open ${c.name} in the Ledger`}
                >
                  <div className="company-card-top">
                    <div className="company-card-name">{c.name}</div>
                    <svg className="company-card-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                  </div>
                  <div className="company-card-value">{peso(c.outstanding)}</div>
                  <div className="company-card-sub">
                    {overdue && <span className="badge badge-danger">{c.worst_days_overdue} day{c.worst_days_overdue === 1 ? '' : 's'} past due</span>}
                    {dueSoon && <span className="badge badge-warning">Due in {c.soonest_days_until_due} day{c.soonest_days_until_due === 1 ? '' : 's'}</span>}
                    {hasBalance && !overdue && !dueSoon && <span className="badge badge-secondary">No due date</span>}
                    {!hasBalance && <span className="badge badge-success">Not past due</span>}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      ))}

      <div className="panel">
        <div className="table-toolbar">
          <div className="table-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.3-4.3" /></svg>
            <input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {company && highlightId && (() => {
            const hit = entries.find((e) => String(e.id) === highlightId);
            if (!hit) return null;
            return (
              <div className="focus-note">
                <span className="focus-dot" />
                Highlighted: billing {fdate(hit.billing_date)}{hit.soa_number ? ` · ${hit.soa_number}` : ''} · balance {peso(hit.balance)}
                <button type="button" onClick={() => flashRow(highlightId)}>Show</button>
                <button type="button" onClick={() => setHighlightId(null)}>Clear</button>
              </div>
            );
          })()}
          <span className="table-toolbar-count">
            {company ? `${filtered.length} entries` : `${activityRows.length} of ${filtered.length} entries shown`}
          </span>
        </div>

        {!company ? (
          <div className="activity-feed">
            {activityRows.length === 0 && <div className="empty-state">No ledger entries{search ? ` match "${search}".` : ' yet.'}</div>}
            {activityRows.map((r) => (
              <Link
                key={r.id}
                to={`/ledger?company_id=${r.company_id}&entry=${r.id}`}
                className={`activity-item ${!r.is_paid && r.is_overdue ? 'is-overdue' : ''}`}
                title={`Open this entry in ${r.company_name}'s ledger`}
              >
                <div className="activity-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
                </div>
                <div className="activity-body">
                  <div className="activity-title">
                    <span className="activity-co">{r.company_name}</span> added a new entry
                  </div>
                  <div className="activity-meta">
                    {r.soa_number ? `SOA ${r.soa_number}` : 'No SOA #'} · Billed {fdate(r.billing_date)}
                    {!r.is_paid && r.is_overdue && <> · <span style={{ color: 'var(--brick)', fontWeight: 600 }}>{r.days_overdue} day{r.days_overdue === 1 ? '' : 's'} past due</span></>}
                    {r.is_paid && <> · <span style={{ color: 'var(--teal)', fontWeight: 600 }}>Paid</span></>}
                  </div>
                </div>
                <div className="activity-right">
                  <div className="activity-amount">{peso(r.amount)}</div>
                  <div className="activity-time">{timeAgo(r.created_at) || fdate(r.billing_date)}</div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className={`table-wrap${gridScroll ? ' ledger-scroll' : ''}`} ref={gridWrapRef}>
            <table className="data-table ledger-table" id={GRID_ID} style={{ fontSize: `${gridFont}px`, minWidth: gridScroll ? Math.ceil(neededPx * (MIN_FONT / BASE_FONT)) : undefined }}>
              {/* Column widths are sized from the data (see colWidths) so all columns fit */}
              <colgroup>
                {colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
              </colgroup>
              <thead>
                <tr>
                  <th>Billing Date</th><th>Covered Period</th><th>SOA #</th>
                  <th className="text-right">Amount</th><th className="text-right">Tax W/H</th>
                  <th className="text-right">Surcharge</th><th className="text-right">Rebate</th>
                  <th className="text-right">Receivable</th>
                  <th>Payment Date</th><th>Check Ref</th>
                  <th className="text-right">Paid</th><th className="text-right">Balance</th>
                  <th>Aging</th>
                  <th>Remarks</th>
                  {canDelete && <th className="text-center col-sticky-r">Action</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={canDelete ? 15 : 14} className="empty-state">No ledger entries{staff ? '.' : ' — click "+ New Entry" to add one.'}</td></tr>
                )}
                {filtered.map((r, rowIdx) => (
                  <tr
                    key={r.id}
                    id={`entry-${r.id}`}
                    className={highlightId === String(r.id) ? 'row-focus' : ''}
                    onClick={() => { if (highlightId && highlightId !== String(r.id)) setHighlightId(null); }}
                  >
                    {staff ? (
                      <>
                        <td><div className="ro-cell ro-first">{formatLongDate(r.billing_date) || '—'}</div></td>
                        <td><div className="ro-cell">{coveredLabel(r.period_from, r.period_to, r.period_date) || '—'}</div></td>
                        <td><div className="ro-cell">{r.soa_number || '—'}</div></td>
                        <td><div className="ro-cell ro-num">{money(r.amount)}</div></td>
                        <td><div className="ro-cell ro-num">{money(r.tax_withheld)}</div></td>
                        <td><div className="ro-cell ro-num">{money(r.surcharge)}</div></td>
                        <td><div className="ro-cell ro-num">{money(r.rebate)}</div></td>
                      </>
                    ) : (
                      <>
                        <td><DateCell row={rowIdx} col={0} value={r.billing_date} onSave={(v) => saveField(r.id, 'billing_date', v)} /></td>
                        <td><CoveredCell row={rowIdx} col={1} from={r.period_from} to={r.period_to} periodDate={r.period_date} onSave={(v) => saveCovered(r.id, v)} /></td>
                        <td><EditableText row={rowIdx} col={2} value={r.soa_number} onSave={(v) => saveField(r.id, 'soa_number', v)} /></td>
                        <td><EditableText row={rowIdx} col={3} value={r.amount} type="number" align="right" onLive={(v) => setLive(v === null ? null : { id: r.id, field: 'amount', value: v })} onSave={(v) => saveField(r.id, 'amount', v)} /></td>
                        <td><div className="ro-cell ro-num" title="Automatic: Amount x tax %">{money(r.tax_withheld)}</div></td>
                        <td><EditableText row={rowIdx} col={5} value={r.surcharge} type="number" align="right" onSave={(v) => saveField(r.id, 'surcharge', v)} /></td>
                        <td><div className="ro-cell ro-num" title="Automatic: Receivable - Paid">{money(r.rebate)}</div></td>
                      </>
                    )}
                    <td className="text-right num">{peso(r.receivable_amount)}</td>
                    {(
                      <>
                        <td className="cell-glow"><DateCell row={rowIdx} col={7} value={r.payment_date} onSave={(v) => saveField(r.id, 'payment_date', v)} /></td>
                        <td className="cell-glow"><EditableText row={rowIdx} col={8} value={r.check_ref} onSave={(v) => saveField(r.id, 'check_ref', v)} /></td>
                        <td className="cell-glow"><EditableText row={rowIdx} col={9} value={r.paid_amount} type="number" align="right" onLive={(v) => setLive(v === null ? null : { id: r.id, field: 'paid_amount', value: v })} onSave={(v) => saveField(r.id, 'paid_amount', v)} /></td>
                      </>
                    )}
                    <td className="text-right num" style={{ fontWeight: 700 }}>{peso(r.balance)}</td>
                    <td>
                      {r.is_paid && <span className="badge badge-success">Paid</span>}
                      {!r.is_paid && r.is_overdue && <span className="badge badge-danger" title={`${r.days_overdue} day${r.days_overdue === 1 ? '' : 's'} past due`}>{r.days_overdue.toLocaleString()} day{r.days_overdue === 1 ? '' : 's'}</span>}
                      {!r.is_paid && !r.is_overdue && <span className={`badge ${AGING_BADGE[r.aging_bucket] || 'badge-secondary'}`}>{r.aging_bucket}</span>}
                    </td>
                    <td>{staff ? <div className="ro-cell">{r.remarks || '—'}</div> : <RemarksCell row={rowIdx} col={10} value={r.remarks} onSave={(v) => saveField(r.id, 'remarks', v)} />}</td>
                    {canDelete && <td className="text-center col-sticky-r cell-action"><button type="button" className="btn btn-danger btn-sm" style={{ width: 34, padding: 0, justifyContent: 'center' }} title="Delete entry" aria-label="Delete entry" onClick={() => deleteRow(r)}><TrashIcon /></button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}