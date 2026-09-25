import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '../api';
import { peso, AGING_BADGE, fdate, timeAgo } from '../utils';

const GRID_ID = 'ledger-grid';

let measureCtx = null;
function getMeasureCtx() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}

function focusCell(row, col) {
  const el = document.querySelector(`#${GRID_ID} [data-r="${row}"][data-c="${col}"] input`);
  if (el) {
    el.focus();
    if (el.select && el.type !== 'date') el.select();
  }
}

function EditableText({ value, onSave, type = 'text', align, row, col }) {
  const [val, setVal] = useState(value ?? '');
  const [state, setState] = useState(''); // '', 'saving', 'saved', 'error'
  useEffect(() => setVal(value ?? ''), [value]);

  async function commit() {
    if ((val || '') === (value ?? '')) return;
    setState('saving');
    try {
      await onSave(val);
      setState('saved');
      setTimeout(() => setState(''), 700);
    } catch (e) {
      setState('error');
      alert(e.message);
      setVal(value ?? '');
    }
  }

  function onKeyDown(e) {
    const { key, target } = e;
    if (key === 'Enter') { e.preventDefault(); target.blur(); focusCell(row + 1, col); return; }
    if (key === 'ArrowDown') { e.preventDefault(); focusCell(row + 1, col); return; }
    if (key === 'ArrowUp') { e.preventDefault(); focusCell(row - 1, col); return; }
    if (key === 'ArrowRight' || key === 'ArrowLeft') {
      // Only jump cells when the cursor is already at that edge of the text,
      // so normal left/right editing inside the field still works.
      let atEdge = true;
      try {
        if (type === 'text') {
          atEdge = key === 'ArrowRight'
            ? target.selectionStart === target.value.length
            : target.selectionStart === 0;
        }
      } catch { /* selection API unsupported on this input type — treat as edge */ }
      if (atEdge) { focusCell(row, key === 'ArrowRight' ? col + 1 : col - 1); }
    }
  }

  return (
    <div className={`editable-cell ${state}`} data-r={row} data-c={col}>
      <input
        type={type}
        className={type === 'number' ? 'num' : ''}
        style={align ? { textAlign: align } : undefined}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}

export default function Ledger() {
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
  const filtered = useMemo(() => {
    if (!search.trim()) return entries;
    const q = search.trim().toLowerCase();
    return entries.filter((r) =>
      [r.company_name, r.soa_number, r.remarks, r.billing_date].filter(Boolean).join(' ').toLowerCase().includes(q)
    );
  }, [entries, search]);

  const ACTIVITY_LIMIT = 60;
  const activityRows = useMemo(() => {
    return [...filtered]
      .sort((a, b) => new Date(b.created_at || b.billing_date || 0) - new Date(a.created_at || a.billing_date || 0))
      .slice(0, ACTIVITY_LIMIT);
  }, [filtered]);

  // ---- Auto-fit ledger grid ----
  // Each column's width is measured from its longest value (a column holding
  // millions gets wider, one holding 0.00 gets narrower). If all 14 columns
  // still don't fit the screen, the grid's text shrinks a little until they
  // do -- so nothing is ever cut off and there's no sideways scrolling.
  const BASE_FONT = 13;
  const colPx = useMemo(() => {
    const ctx = getMeasureCtx();
    const fam = getComputedStyle(document.body).fontFamily || 'sans-serif';
    ctx.font = `${BASE_FONT}px ${fam}`;
    const tw = (v) => ctx.measureText(String(v ?? '')).width;
    const widest = (key, fmt = (v) => v, min = '') =>
      entries.reduce((m, r) => Math.max(m, tw(fmt(r[key]))), tw(min));
    ctx.font = `600 ${BASE_FONT}px ${fam}`;
    const bold = (key) => entries.reduce((m, r) => Math.max(m, ctx.measureText(peso(r[key])).width), ctx.measureText('₱0.00').width);
    const balanceW = bold('balance');
    ctx.font = `${BASE_FONT}px ${fam}`;
    const INPUT = 27;   // input padding + border + cell padding (+ a little room)
    const CELL = 24;    // plain cell padding
    const DATE = tw('00/00/0000') + 52; // text + calendar icon + padding
    const cap = (px, maxChars) => Math.min(px, tw('0'.repeat(maxChars)));
    // A column is never narrower than the longest word of its header
    ctx.font = `600 ${BASE_FONT * 0.9}px ${fam}`;
    const HEADERS = ['Billing Date', 'SOA #', 'Amount', 'Tax W/H', 'Surcharge', 'Rebate', 'Receivable',
      'Payment Date', 'Check Ref', 'Paid', 'Balance', 'Aging', 'Remarks', ''];
    const headerMin = HEADERS.map((h) => Math.max(0, ...h.split(' ').map((word) => ctx.measureText(word).width)) + 22);
    ctx.font = `${BASE_FONT}px ${fam}`;
    return [
      DATE + 10,                                              // Billing Date (first column has extra left padding)
      cap(widest('soa_number', undefined, 'SOA #0'), 14) + INPUT,
      widest('amount', undefined, '0.00') + INPUT,
      widest('tax_withheld', undefined, '0.00') + INPUT,
      widest('surcharge', undefined, '0.00') + INPUT,
      widest('rebate', undefined, '0.00') + INPUT,
      widest('receivable_amount', peso, '₱0.00') + CELL,
      DATE,                                                   // Payment Date
      cap(widest('check_ref', undefined, 'Check'), 12) + INPUT,
      widest('paid_amount', undefined, '0.00') + INPUT,
      balanceW + CELL,
      tw('0,000 days') + 30,                                  // Aging badge
      cap(widest('remarks', undefined, 'Remarks'), 14) + INPUT,
      46,                                                     // delete button
    ].map((px, i) => Math.max(px, headerMin[i]));
  }, [entries]);
  const colWidths = useMemo(() => {
    const total = colPx.reduce((a, b) => a + b, 0);
    return colPx.map((x) => `${((x / total) * 100).toFixed(2)}%`);
  }, [colPx]);

  const gridWrapRef = useRef(null);
  const [gridFont, setGridFont] = useState(BASE_FONT);
  useLayoutEffect(() => {
    const el = gridWrapRef.current;
    if (!el) return undefined;
    const needed = colPx.reduce((a, b) => a + b, 0);
    const fit = () => {
      const avail = el.clientWidth;
      if (!avail) return;
      const scaled = BASE_FONT * Math.min(1.04, avail / needed);
      setGridFont(Math.max(10.5, Math.min(13.5, Math.floor(scaled * 4) / 4)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [colPx, data]);

  async function saveField(id, field, value) {
    const r = await api.inlineUpdateLedger(id, field, value);
    setData((d) => ({
      ...d,
      entries: d.entries.map((e) =>
        e.id === id ? { ...e, [field]: value, receivable_amount: r.receivable_amount, balance: r.balance } : e
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

  async function removeRow(id) {
    if (!confirm('Delete this ledger entry?')) return;
    await api.deleteLedger(id);
    reload();
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
          <div className="subtitle">{company ? 'Click any cell to edit — it saves automatically. Use arrow keys or Enter to move between cells, like a spreadsheet.' : 'All companies — pick one below to focus, or filter with search'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="select-inline" value={companyId} onChange={(e) => setParams(e.target.value ? { company_id: e.target.value } : {})}>
            <option value="">All companies…</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <a className="btn btn-secondary" href={`/export_csv.php?type=ledger${companyId ? `&company_id=${companyId}` : ''}`}>Export CSV</a>
          <a className="btn btn-secondary" href={`/export_xlsx.php?type=ledger${companyId ? `&company_id=${companyId}` : ''}`}>Export XLSX</a>
          {companyId && <button className="btn" onClick={addRow}>+ New Entry</button>}
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
              <div><div style={{ fontSize: 11, color: 'var(--slate)' }}>Billed</div><strong className="num">{peso(data.totals.amount)}</strong></div>
              <div><div style={{ fontSize: 11, color: 'var(--slate)' }}>Paid</div><strong className="num">{peso(data.totals.paid)}</strong></div>
              <div><div style={{ fontSize: 11, color: 'var(--teal)' }}>Outstanding</div><strong className="num" style={{ color: 'var(--teal)' }}>{peso(data.totals.balance)}</strong></div>
            </div>
          </div>
          {Object.keys(data.aging_tally).length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {Object.entries(data.aging_tally).map(([bucket, total]) => (
                <span key={bucket} className={`badge ${AGING_BADGE[bucket] || 'badge-secondary'}`}>{bucket}: {peso(total)}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {!company && data.company_summary && data.company_summary.length > 0 && (
        <div className="panel">
          <h2>Companies — Outstanding &amp; Aging</h2>
          <div className="company-card-grid">
            {data.company_summary.map((c) => {
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
      )}

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
          <div className="table-wrap" ref={gridWrapRef}>
            <table className="data-table ledger-table" id={GRID_ID} style={{ fontSize: `${gridFont}px` }}>
              {/* Column widths are sized from the data (see colWidths) so all 14 columns fit */}
              <colgroup>
                {colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
              </colgroup>
              <thead>
                <tr>
                  <th>Billing Date</th><th>SOA #</th>
                  <th className="text-right">Amount</th><th className="text-right">Tax W/H</th>
                  <th className="text-right">Surcharge</th><th className="text-right">Rebate</th>
                  <th className="text-right">Receivable</th>
                  <th>Payment Date</th><th>Check Ref</th>
                  <th className="text-right">Paid</th><th className="text-right">Balance</th>
                  <th>Aging</th>
                  <th>Remarks</th><th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={14} className="empty-state">No ledger entries — click "+ New Entry" to add one.</td></tr>
                )}
                {filtered.map((r, rowIdx) => (
                  <tr
                    key={r.id}
                    id={`entry-${r.id}`}
                    className={highlightId === String(r.id) ? 'row-focus' : ''}
                    onClick={() => { if (highlightId && highlightId !== String(r.id)) setHighlightId(null); }}
                  >
                    <td><EditableText row={rowIdx} col={0} value={r.billing_date} type="date" onSave={(v) => saveField(r.id, 'billing_date', v)} /></td>
                    <td><EditableText row={rowIdx} col={1} value={r.soa_number} onSave={(v) => saveField(r.id, 'soa_number', v)} /></td>
                    <td><EditableText row={rowIdx} col={2} value={r.amount} type="number" align="right" onSave={(v) => saveField(r.id, 'amount', v)} /></td>
                    <td><EditableText row={rowIdx} col={3} value={r.tax_withheld} type="number" align="right" onSave={(v) => saveField(r.id, 'tax_withheld', v)} /></td>
                    <td><EditableText row={rowIdx} col={4} value={r.surcharge} type="number" align="right" onSave={(v) => saveField(r.id, 'surcharge', v)} /></td>
                    <td><EditableText row={rowIdx} col={5} value={r.rebate} type="number" align="right" onSave={(v) => saveField(r.id, 'rebate', v)} /></td>
                    <td className="text-right num">{peso(r.receivable_amount)}</td>
                    <td><EditableText row={rowIdx} col={6} value={r.payment_date} type="date" onSave={(v) => saveField(r.id, 'payment_date', v)} /></td>
                    <td><EditableText row={rowIdx} col={7} value={r.check_ref} onSave={(v) => saveField(r.id, 'check_ref', v)} /></td>
                    <td><EditableText row={rowIdx} col={8} value={r.paid_amount} type="number" align="right" onSave={(v) => saveField(r.id, 'paid_amount', v)} /></td>
                    <td className="text-right num" style={{ fontWeight: 700 }}>{peso(r.balance)}</td>
                    <td>
                      {r.is_paid && <span className="badge badge-success">Paid</span>}
                      {!r.is_paid && r.is_overdue && <span className="badge badge-danger" title={`${r.days_overdue} day${r.days_overdue === 1 ? '' : 's'} past due`}>{r.days_overdue.toLocaleString()} day{r.days_overdue === 1 ? '' : 's'}</span>}
                      {!r.is_paid && !r.is_overdue && <span className={`badge ${AGING_BADGE[r.aging_bucket] || 'badge-secondary'}`}>{r.aging_bucket}</span>}
                    </td>
                    <td><EditableText row={rowIdx} col={9} value={r.remarks} onSave={(v) => saveField(r.id, 'remarks', v)} /></td>
                    <td className="cell-action"><button className="btn btn-danger btn-sm btn-icon" title="Delete this entry" onClick={() => removeRow(r.id)}>×</button></td>
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