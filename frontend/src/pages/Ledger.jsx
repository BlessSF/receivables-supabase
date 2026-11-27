import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '../api';
import { peso, money, AGING_BADGE, fdate, timeAgo, periodLabel, periodParts, coveredLabel, formatLongDate, isStaff, isExecutive } from '../utils';
import { useAuth } from '../AuthContext';
import MoneyInput, { fmtNum } from '../MoneyInput';
import { GRID_ID, gridKeyDown, DateCell, RemarksCell, CoveredCell } from '../gridCells';
import PaymentsModal from '../PaymentsModal';
import { PROOF_FILES, prepareProof } from '../proofFiles';
import { followHeader } from '../stickyHead';
import { typedRoom, typedTax, paymentBreakdown } from '../taxMath';

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

// Overpaid shown like the Excel: all net amounts processed minus the SOA amount (the Excel's negative "Remaining Balance").
// Falls back to the received-based figure when the row has no payments with a net amount.
function overNet(r) {
  const nets = (r.pay_nets || []).reduce((a, b) => a + (Number(b) || 0), 0);
  const d = r2(nets - (Number(r.amount) || 0));
  return nets > 0 && d > 0.009 ? d : r.variance;
}

// Total = Amount Received + Tax + Discount + Provider Excess (what the payment settled)
function rowTotal(r) {
  const recv = (r.pay_amounts || []).length ? r.pay_amounts.reduce((a, b) => a + (Number(b) || 0), 0) : (Number(r.paid_amount) || 0);
  return r2(recv + (Number(r.tax_withheld) || 0) + (Number(r.disc_amount) || 0) + (Number(r.provider_excess) || 0));
}

// One proof file: hover for a preview; Admin / Accounting can remove it (after a confirmation)
function ProofChip({ file, label, canRemove, onDone }) {
  const [pos, setPos] = useState(null);
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const timer = useRef(null);
  const isPdf = file.mime === 'application/pdf';
  const url = api.paymentProofUrl(file.id);
  const open = (e) => {
    clearTimeout(timer.current);
    const r = e.currentTarget.getBoundingClientRect();
    const w = 280;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left));
    const below = r.bottom + 330 < window.innerHeight;
    setPos({ left, top: below ? r.bottom + 4 : undefined, bottom: below ? undefined : window.innerHeight - r.top + 4 });
  };
  const close = () => { timer.current = setTimeout(() => { setPos(null); setAsk(false); setErr(''); }, 180); };
  const keep = () => clearTimeout(timer.current);
  const remove = async () => {
    setBusy(true); setErr('');
    try { await api.deletePaymentProof(file.id); setPos(null); setAsk(false); onDone(); }
    catch (e) { setErr(e.message || 'Could not remove the file.'); } finally { setBusy(false); }
  };
  return (
    <span className="proof-wrap" onMouseEnter={open} onMouseLeave={close}>
      <a className="proof-chip" href={url} target="_blank" rel="noreferrer" title={file.file_name}>{label}</a>
      {pos && (
        <div className="proof-pop" style={{ left: pos.left, top: pos.top, bottom: pos.bottom }} onMouseEnter={keep} onMouseLeave={close}>
          <a href={url} target="_blank" rel="noreferrer" className="proof-pop-view" title="Open full size">
            {isPdf ? <div className="proof-pop-pdf"><b>PDF</b><span>Click to open</span></div> : <img src={url} alt={file.file_name} />}
          </a>
          <div className="proof-pop-name" title={file.file_name}>{file.file_name}</div>
          {err && <div className="proof-err">{err}</div>}
          {canRemove && !ask && <button type="button" className="proof-del" onClick={() => setAsk(true)}>Remove</button>}
          {canRemove && ask && (
            <div className="proof-confirm">
              <span>Remove this file?</span>
              <button type="button" className="proof-del" disabled={busy} onClick={remove}>{busy ? '…' : 'Yes, remove'}</button>
              <button type="button" className="proof-keep" disabled={busy} onClick={() => setAsk(false)}>Cancel</button>
            </div>
          )}
        </div>
      )}
    </span>
  );
}

// Proof of payment: links to the photo / PDF files of this row's payments, and a button to add one (photo or PDF only)
function ProofCell({ entry, staff, canAdd, onDone }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const input = useRef(null);
  const files = entry.proofs || [];
  const pick = async (e) => {
    const list = Array.from(e.target.files || []);
    e.target.value = '';
    if (!list.length) return;
    if (files.length + list.length > PROOF_FILES) { setMsg(`Up to ${PROOF_FILES} files.`); return; }
    setBusy(true); setMsg('');
    try {
      for (const f of list) { const p = await prepareProof(f); await api.addLedgerProof(entry.id, p.name, p.data); }
      onDone();
    } catch (err) { setMsg(err.message || 'Upload failed.'); } finally { setBusy(false); }
  };
  return (
    <div className="proof-cell">
      {files.map((f, i) => (
        <ProofChip key={f.id} file={f} label={`${f.mime === 'application/pdf' ? 'PDF' : 'Photo'}${files.length > 1 ? ` ${i + 1}` : ''}`} canRemove={!staff} onDone={onDone} />
      ))}
      {!staff && canAdd && files.length < PROOF_FILES && (
        <>
          <button type="button" className="proof-add" disabled={busy} title="Attach a photo (JPG, PNG) or a PDF as proof of payment" onClick={() => input.current && input.current.click()}>{busy ? '…' : '+ Proof'}</button>
          <input ref={input} type="file" hidden multiple accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" onChange={pick} />
        </>
      )}
      {!files.length && (staff || !canAdd) && <span style={{ color: 'var(--slate)' }}>—</span>}
      {msg && <small className="proof-err" title={msg}>{msg}</small>}
    </div>
  );
}

// Provider Excess / Concern Amount / Disc: just an amount you type. It is always taken off the Receivable.
function ExtraCell({ row, col, amount, onSaveAmount }) {
  return (
    <div className="xtra-cell">
      <EditableText row={row} col={col} value={amount} type="number" align="right" onSave={onSaveAmount} />
    </div>
  );
}
// Tax W/H, Receivable and Balance worked out from the typed numbers -- exactly the server's formulas.
//   Tax W/H    = tax % of what was paid (none for Charge to Company accounts, or when its Tax W/H switch is off)
//   Receivable = Amount - Tax W/H - Provider Excess - Concern Amount - Disc + Surcharge - Settled
//   ("Settled" is the amount written off on entries settled earlier. It can no longer be added or changed.)
//   Balance    = Receivable - Paid, never below 0 (an unpaid difference stays outstanding until it is paid)
//   Variance   = Paid above Receivable (an overpayment). It is NOT outstanding: it stays flagged until someone fixes the payment.
function deriveRow(e, taxPct, amountOverride, paidOverride) {
  const amount = amountOverride !== undefined ? amountOverride : Number(e.amount) || 0;
  const paid = paidOverride !== undefined ? paidOverride : Number(e.paid_amount) || 0;
  // Provider Excess, Concern Amount and Disc are deducted from the Amount.
  const deduct = (Number(e.provider_excess) || 0) + (Number(e.concern_amount) || 0) + (Number(e.disc_amount) || 0);
  // Tax W/H is withheld on what was PAID (nothing on the part still unpaid): the payments entered with a net amount carry their
  // own tax, and an amount typed straight into Paid is "received" so its tax is worked back from it, never more than
  // tax % of the SOA (see src/taxMath.js)
  const typedRecv = Math.max(0, paid - (Number(e.pay_recv) || 0));
  const tax = e.account_type === 'CHARGE' ? 0
    : r2((Number(e.pay_tax) || 0) + (e.tax_off ? 0 : typedTax(typedRecv, typedRoom(amount, deduct, e.pay_base), taxPct)));
  const receivable = r2(amount - tax - deduct + (Number(e.surcharge) || 0) - (Number(e.rebate) || 0));
  return { tax_withheld: tax, receivable_amount: receivable, balance: Math.max(0, r2(receivable - paid)), variance: Math.max(0, r2(paid - receivable)) };
}

// An entry that was settled earlier: this part of it was written off, which is why it can be Paid with less money
function SettledNote({ amount }) {
  if (!(Number(amount) > 0.009)) return null;
  return <span className="settled-note" title="Settled earlier: this amount is not owed. It is already taken off the Receivable.">Settled {peso(amount)}</span>;
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

const toNum = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

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
  const [viewCard, setViewCard] = useState(null); // { id, x, y } company card whose View popup is open
  const viewTimer = useRef(null);
  const [payFor, setPayFor] = useState(null); // ledger row whose payments popup is open
  const [sheetFirst, setSheetFirst] = useState(false); // open that popup straight on the SOA sheet (from the Amount Received column)
  const [taxSel, setTaxSel] = useState(null); // null = normal view; a Set of entry ids while choosing entries for Tax W/H on/off
  const [taxBusy, setTaxBusy] = useState(false);
  const [taxMsg, setTaxMsg] = useState('');

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
  const BUCKETS = ['Not Yet Due', '0-30 days', '31-60 days', '61-90 days', 'Over 90 days', 'N/A'];
  function openView(e, c) {
    clearTimeout(viewTimer.current);
    const r = e.currentTarget.getBoundingClientRect();
    const w = 380;
    const x = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    const below = window.innerHeight - r.bottom > 340;
    setViewCard({ id: c.id, x, y: below ? r.bottom + 6 : null, bottom: below ? null : window.innerHeight - r.top + 6 });
  }
  function holdView() { clearTimeout(viewTimer.current); }
  function closeViewSoon() { clearTimeout(viewTimer.current); viewTimer.current = setTimeout(() => setViewCard(null), 180); }

  // While a Paid amount is being typed, the row balance, the Paid / Outstanding
  // totals and the aging badges update on every keystroke (before it is saved).
  const [live, setLive] = useState(null); // { id, field, value }
  // Tax W/H, Receivable and Balance are computed for every row (view only) -- see deriveRow.
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
    let amount = 0, paid = 0, balance = 0, tax = 0, variance = 0, varianceCount = 0;
    const tally = {};
    for (const e of liveEntries) {
      amount += e.live_amount !== undefined ? e.live_amount : Number(e.amount) || 0;
      paid += e.live_paid !== undefined ? e.live_paid : Number(e.paid_amount) || 0;
      tax += Number(e.tax_withheld) || 0;
      const b = Number(e.balance) || 0;
      balance += b;
      if (e.variance > 0.009) { variance += e.variance; varianceCount++; }
      if (b > 0.009 && e.aging_bucket && e.aging_bucket !== 'Paid') tally[e.aging_bucket] = (tally[e.aging_bucket] || 0) + b;
    }
    return { amount, paid, balance, tax, variance, varianceCount, tally };
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
    const rows = entries.map((e) => ({ ...e, ...deriveRow(e, taxPct) })); // measure the computed Tax W/H and Receivable too
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
    const HEADERS = ['Billing Date', 'Covered Period', 'SOA #', 'Amount', 'Net Amount Processed', 'Total Tax', 'Tax', 'Discount', 'Concern Amount', 'Provider Excess', 'Total', 'Receivable',
      'Payment Date', 'Check Ref', 'Paid', 'Amount Received', 'Balance', 'Aging', 'Paid Status', 'Proof', 'Remarks', ...(canDelete ? ['Action'] : [])];
    const headerMin = HEADERS.map((h) => Math.max(0, ...h.split(' ').map((word) => ctx.measureText(word).width * SAFE)) + 22);
    ctx.font = `${BASE_FONT}px ${fam}`;
    return [
      DATE + 10,                                              // Billing Date (first column has extra left padding)
      PERIOD - 14,                                            // Covered Period
      cap(widest('soa_number', undefined, 'SOA #0'), 22) + RO,
      widest('amount', money, '0.00') + RO,
      Math.max(tw('0'.repeat(11)), rows.reduce((m, r) => Math.max(m, ...(r.pay_nets || []).map((a) => tw(money(a)) + (r.pay_nets.length > 1 ? tw('2nd ') : 0))), 0)) + CELL + 6, // Net Amount Processed (one line per payment)
      widest('amount', money, '0.00') + RO,                                  // Total Tax (never wider than Amount)
      widest('tax_withheld', money, '0.00') + RO + (staff ? 30 : 40), // room for the on/off switch
      Math.max(widest('disc_amount', fmtNum, '0.00'), tw('0'.repeat(11))) + INPUT + 8,
      Math.max(widest('concern_amount', fmtNum, '0.00'), tw('0'.repeat(11))) + INPUT + 8,
      Math.max(widest('provider_excess', fmtNum, '0.00'), tw('0'.repeat(11))) + INPUT + 8,   // input only
      Math.max(tw('0'.repeat(11)), widest('receivable_amount', peso, '₱0.00')) + CELL + 6,                  // Total
      widest('receivable_amount', peso, '₱0.00') + CELL,
      DATE,                                                   // Payment Date
      // Check Ref always has room for a long check number (14 digits) and grows past that if a longer one is saved
      Math.min(Math.max(widest('check_ref', undefined, 'Check'), tw('0'.repeat(14))), tw('0'.repeat(26))) + INPUT,
      // Paid always has room for an 8-digit amount with centavos (12,345,678.00 typed as 12345678.00) and grows past that if a bigger one is saved
      Math.min(Math.max(widest('paid_amount', fmtNum, '0.00'), tw('0'.repeat(12))), tw('0'.repeat(20))) + INPUT + 30, // + room for the payments button
      Math.max(tw('0'.repeat(11)), rows.reduce((m, r) => Math.max(m, ...(r.pay_amounts || []).map((a) => tw(money(a)) + (r.pay_amounts.length > 1 ? tw('2nd ') : 0))), 0)) + CELL + 6, // Amount Received (one line per payment)
      balanceW + CELL,
      Math.max(tw('0,000 days'), tw('Not Yet Due'), tw('Overdue 90+')) * 1.2 + 70, // Aging badge (wide enough for "Not Yet Due" on one line)
      Math.max(tw('Unpaid') + 86, rows.reduce((m, r) => (Number(r.rebate) > 0.009 ? Math.max(m, tw(`Settled ${peso(r.rebate)}`)) : m), 0) + 40, rows.reduce((m, r) => (r.variance > 0.009 ? Math.max(m, tw(`Overpaid ${peso(r.variance)}`)) : m), 0) + 58), // Paid Status badge (an "Overpaid" flag sits under it)
      tw('+ Proof') + tw('Photo') * 2 + 90,                                   // Proof (links + upload button)
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

  // The header row follows the page scroll. Runs after every render because the table can be swapped in and out.
  useLayoutEffect(() => followHeader(gridWrapRef.current));

  async function saveField(id, field, value) {
    let r;
    try {
      r = await api.inlineUpdateLedger(id, field, value);
    } catch (e) {
      // Same SOA already on another entry (e.g. two payments for one SOA): ask before allowing it.
      if (e.code !== 'SOA_SHARED') throw e;
      const ok = window.confirm(`${e.message}\n\nDo these 2 payments share the same SOA?\n\nOK = yes, use the same SOA on both. The SOA Tracker will show it as shared (x2) and it still counts as ONE SOA number.\nCancel = don't change it.`);
      if (!ok) throw new Error(''); // quiet revert
      r = await api.inlineUpdateLedger(id, field, value, true);
    }
    setData((d) => ({
      ...d,
      entries: d.entries.map((e) =>
        e.id === id ? { ...e, [field]: value, ...(r.tax_withheld !== null && r.tax_withheld !== undefined ? { tax_withheld: r.tax_withheld } : {}), receivable_amount: r.receivable_amount, balance: r.balance } : e
      ),
    }));
    // Paid / amounts change the aging buckets and Paid status: refresh them quietly.
    if (companyId && ['paid_amount', 'amount', 'tax_withheld', 'surcharge', 'provider_excess', 'concern_amount', 'disc_amount', 'pe_on', 'ca_on', 'dc_on'].includes(field)) reload();
  }

  // Switch the automatic Tax W/H off (or back on) for the chosen entries only.
  async function applyTaxOff(ids, off) {
    const rows = entries.filter((e) => ids.includes(e.id) && e.account_type !== 'CHARGE' && !!e.tax_off !== off);
    if (!rows.length) { setTaxMsg(off ? 'Those entries already have Tax W/H turned off.' : 'Those entries already have Tax W/H turned on.'); return; }
    if (off) {
      const settled = rows.filter((e) => (Number(e.paid_amount) || 0) > 0.009 && r2(Number(e.balance) || 0) <= 0.009);
      if (settled.length) {
        const extra = settled.reduce((t, e) => t + (Number(e.tax_withheld) || 0), 0);
        if (!window.confirm(`${settled.length} of these ${settled.length === 1 ? 'entry is' : 'entries are'} already fully paid.\n\nWithout Tax W/H the Receivable goes up, so ${settled.length === 1 ? 'it' : 'they'} will show an unpaid balance of ${peso(extra)} in total until the payment is adjusted.\n\nTurn Tax W/H off anyway?`)) return;
      }
    }
    setTaxBusy(true); setTaxMsg('');
    try {
      const r = await api.setTaxOff(rows.map((e) => e.id), off);
      setData((d) => ({ ...d, entries: d.entries.map((e) => (r.rows && r.rows[e.id] ? { ...e, ...r.rows[e.id] } : e)) }));
      setTaxMsg(r.message || '');
      setTaxSel(null);
      reload();
    } catch (e) {
      setTaxMsg(e.message || 'Could not change Tax W/H.');
    } finally {
      setTaxBusy(false);
    }
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
              <div><div style={{ fontSize: 11, color: 'var(--slate)' }}>Tax W/H</div><strong className="num totals-live">{peso(liveTotals.tax)}</strong></div>
              <div><div style={{ fontSize: 11, color: 'var(--teal)' }}>Outstanding</div><strong className="num totals-live" style={{ color: 'var(--teal)' }}>{peso(liveTotals.balance)}</strong></div>
            </div>
          </div>
          {liveTotals.varianceCount > 0 && (
            <div className="flash flash-warning" style={{ marginTop: 12 }}>
              <b>{liveTotals.varianceCount} unresolved variance{liveTotals.varianceCount === 1 ? '' : 's'} ({peso(liveTotals.variance)} overpaid).</b>{' '}
              Paid is more than the receivable. It is not counted as outstanding. Correct the payment if it was typed wrong.
            </div>
          )}
          {Object.keys(liveTotals.tally).length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {Object.entries(liveTotals.tally).map(([bucket, total]) => (
                <span key={bucket} className={`badge ic-clock ${AGING_BADGE[bucket] || 'badge-secondary'}`}>{bucket}: {peso(total)}</span>
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
                    {overdue && <span className="badge badge-danger ic-overdue">{c.worst_days_overdue} day{c.worst_days_overdue === 1 ? '' : 's'} past due</span>}
                    {dueSoon && <span className="badge badge-warning ic-clock">Due in {c.soonest_days_until_due} day{c.soonest_days_until_due === 1 ? '' : 's'}</span>}
                    {hasBalance && !overdue && !dueSoon && <span className="badge badge-secondary ic-clock">No due date</span>}
                    {!hasBalance && <span className="badge badge-success ic-paid">Not past due</span>}
                    <button
                      type="button"
                      className="card-view-btn"
                      onMouseEnter={(e) => openView(e, c)}
                      onMouseLeave={closeViewSoon}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); viewCard?.id === c.id ? setViewCard(null) : openView(e, c); }}
                    >View</button>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      ))}

      {viewCard && (() => {
        const c = (data.company_summary || []).find((x) => x.id === viewCard.id);
        if (!c) return null;
        const mine = entries.filter((r) => String(r.company_id) === String(c.id));
        const unpaid = mine.filter((r) => !r.is_paid).sort((a, b) => (b.days_overdue ?? -1e9) - (a.days_overdue ?? -1e9));
        const paid = mine.filter((r) => r.is_paid && toNum(r.paid_amount) > 0);
        const tally = {};
        unpaid.forEach((r) => { tally[r.aging_bucket] = (tally[r.aging_bucket] || 0) + toNum(r.balance); });
        return (
          <div
            className="card-view-pop"
            style={{ left: viewCard.x, top: viewCard.y ?? undefined, bottom: viewCard.bottom ?? undefined }}
            onMouseEnter={holdView}
            onMouseLeave={closeViewSoon}
          >
            <div className="cvp-head">
              <div><strong>{c.name}</strong><div className="cvp-sub">{unpaid.length} unpaid · {paid.length} paid</div></div>
              <div className="cvp-total">{peso(c.outstanding)}</div>
              <button type="button" className="cvp-x" onClick={() => setViewCard(null)} aria-label="Close">×</button>
            </div>
            {Object.keys(tally).length > 0 && (
              <div className="cvp-tally">
                {BUCKETS.filter((b) => tally[b] > 0.009).map((b) => (
                  <span key={b} className={`badge ic-clock ${AGING_BADGE[b] || 'badge-secondary'}`}>{b}: {peso(tally[b])}</span>
                ))}
              </div>
            )}
            <div className="cvp-list">
              {unpaid.length === 0 && <div className="cvp-empty">No unpaid entries.</div>}
              {unpaid.map((r) => {
                const d = r.days_overdue;
                const tag = d === null || d === undefined ? <span className="badge badge-secondary ic-clock">No due date</span>
                  : d > 0 ? <span className="badge badge-danger ic-overdue">{d} day{d === 1 ? '' : 's'} aged</span>
                  : <span className="badge badge-warning ic-clock">due in {-d} day{d === -1 ? '' : 's'}</span>;
                return (
                  <div className="cvp-row" key={r.id}>
                    <span className="cvp-soa">{r.soa_number || '—'}</span>
                    <span className="cvp-bal">{peso(r.balance)}</span>
                    {tag}
                  </div>
                );
              })}
              {paid.length > 0 && (
                <details className="cvp-paid">
                  <summary>Show paid ({paid.length})</summary>
                  {paid.map((r) => (
                    <div className="cvp-row" key={r.id}>
                      <span className="cvp-soa">{r.soa_number || '—'}</span>
                      <span className="cvp-bal">{peso(r.paid_amount)}</span>
                      <span className="cvp-date">{r.payment_date ? fdate(r.payment_date) : 'paid'}</span>
                    </div>
                  ))}
                </details>
              )}
            </div>
            <div className="cvp-foot">
              <Link to={`/ledger?company_id=${c.id}`}>Open ledger →</Link>
              <button type="button" className="btn btn-sm" onClick={() => {
                const lines = [`${c.name} — outstanding ${peso(c.outstanding)}`, ...unpaid.map((r) => `${r.soa_number || '—'}  ${peso(r.balance)}  ${r.days_overdue > 0 ? r.days_overdue + ' days aged' : r.days_overdue === null || r.days_overdue === undefined ? 'no due date' : 'due in ' + (-r.days_overdue) + ' days'}`)];
                try { navigator.clipboard.writeText(lines.join('\n')); } catch (_) {}
              }}>Copy</button>
            </div>
          </div>
        );
      })()}

      <div className="panel">
        <div className="table-toolbar">
          <div className="table-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.3-4.3" /></svg>
            <input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {company && !staff && (
            taxSel ? (
              <div className="tax-bar">
                <b>{taxSel.size}</b> selected
                <button type="button" className="btn btn-sm" disabled={!taxSel.size || taxBusy} onClick={() => applyTaxOff([...taxSel], true)}>Turn Tax W/H OFF</button>
                <button type="button" className="btn btn-sm btn-secondary" disabled={!taxSel.size || taxBusy} onClick={() => applyTaxOff([...taxSel], false)}>Turn ON</button>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => { setTaxSel(null); setTaxMsg(''); }}>Cancel</button>
              </div>
            ) : (
              <button type="button" className="btn btn-sm btn-secondary" title="Choose several entries, then turn their Tax W/H off or on" onClick={() => { setTaxSel(new Set()); setTaxMsg(''); }}>Tax W/H: select entries</button>
            )
          )}
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
        {taxMsg && <div className="flash flash-success tax-msg" role="status">{taxMsg} <button type="button" onClick={() => setTaxMsg('')} aria-label="Dismiss">×</button></div>}

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
                  <th className="text-right">Amount</th>
                  <th className="text-right">Net Amount Processed</th>
                  <th className="text-right">Total Tax</th>
                  <th className="text-right">
                    {taxSel && (
                      <input type="checkbox" className="tax-check" title="Select every entry shown" aria-label="Select every entry shown"
                        checked={filtered.filter((r) => r.account_type !== 'CHARGE').length > 0 && filtered.filter((r) => r.account_type !== 'CHARGE').every((r) => taxSel.has(r.id))}
                        onChange={(e) => setTaxSel(e.target.checked ? new Set(filtered.filter((r) => r.account_type !== 'CHARGE').map((r) => r.id)) : new Set())} />
                    )}
                    Tax
                  </th>
                  <th className="text-right">Discount</th><th className="text-right">Concern Amount</th><th className="text-right">Provider Excess</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Receivable</th>
                  <th>Payment Date</th><th>Check Ref</th>
                  <th className="text-right">Paid</th><th className="text-right">Amount Received</th><th className="text-right">Balance</th>
                  <th>Aging</th>
                  <th>Paid Status</th>
                  <th>Proof</th>
                  <th>Remarks</th>
                  {canDelete && <th className="text-center col-sticky-r">Action</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={canDelete ? 22 : 21} className="empty-state">No ledger entries{staff ? '.' : ' — click "+ New Entry" to add one.'}</td></tr>
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
                      </>
                    ) : (
                      <>
                        <td><DateCell row={rowIdx} col={0} value={r.billing_date} onSave={(v) => saveField(r.id, 'billing_date', v)} /></td>
                        <td><CoveredCell row={rowIdx} col={1} from={r.period_from} to={r.period_to} periodDate={r.period_date} onSave={(v) => saveCovered(r.id, v)} /></td>
                        <td><EditableText row={rowIdx} col={2} value={r.soa_number} onSave={(v) => saveField(r.id, 'soa_number', v)} /></td>
                        <td><EditableText row={rowIdx} col={3} value={r.amount} type="number" align="right" onLive={(v) => setLive(v === null ? null : { id: r.id, field: 'amount', value: v })} onSave={(v) => saveField(r.id, 'amount', v)} /></td>
                      </>
                    )}
                    <td className="text-right num recv-cell" title="Net amount processed: one value per payment, read-only">
                      {(r.pay_nets || []).length > 0
                        ? r.pay_nets.map((a, i) => (
                          <div key={i} className="recv-line">{r.pay_nets.length > 1 && <small>{['1st', '2nd', '3rd'][i] || `${i + 1}th`}</small>}{money(a)}</div>
                        ))
                        : (Number(r.paid_amount) > 0
                          // no payment records: everything paid so far is one payment
                          ? <div className="recv-line">{money(paymentBreakdown(r, [{ amount: r.paid_amount }], taxPct, r.account_type === 'CHARGE')[0].net)}</div>
                          : <span style={{ color: 'var(--slate)' }}>—</span>)}
                    </td>
                    <td><div className="ro-cell ro-num" title="Amount x tax %">{money(r.account_type === 'CHARGE' ? 0 : r2((Number(r.amount) || 0) * taxPct / 100))}</div></td>
                    {staff ? (
                        <td><div className="ro-cell ro-num">{r.tax_off && <span className="tax-off-tag" title="Tax W/H is turned off for this entry">OFF</span>}{money(r.tax_withheld)}</div></td>
                    ) : (
                        <td>
                          <div className={`ro-cell ro-num tax-cell${r.tax_off ? ' is-off' : ''}`} title={r.tax_off ? 'Tax W/H is turned off for this entry' : 'Automatic: Amount x tax %'}>
                            {r.account_type !== 'CHARGE' && (taxSel ? (
                              <input type="checkbox" className="tax-check" aria-label="Select this entry" checked={taxSel.has(r.id)}
                                onChange={(e) => setTaxSel((cur) => { const n = new Set(cur); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} />
                            ) : (
                              <button type="button" className={`tax-switch${r.tax_off ? '' : ' on'}`} disabled={taxBusy}
                                title={r.tax_off ? 'Tax W/H is OFF for this entry. Click to turn it back on.' : 'Tax W/H is ON. Click to turn it off for this entry.'}
                                aria-label={r.tax_off ? 'Turn Tax W/H on for this entry' : 'Turn Tax W/H off for this entry'}
                                onClick={(e) => { e.stopPropagation(); applyTaxOff([r.id], !r.tax_off); }}><span /></button>
                            ))}
                            <span className="tax-amt">{money(r.tax_withheld)}</span>
                          </div>
                        </td>
                    )}
                    {staff ? (
                        <td><div className="ro-cell ro-num">{money(r.disc_amount)}</div></td>
                    ) : (
                        <td><ExtraCell row={rowIdx} col={4} amount={r.disc_amount} onSaveAmount={(v) => saveField(r.id, 'disc_amount', v)} /></td>
                    )}
                    {staff ? (
                        <td><div className="ro-cell ro-num">{money(r.concern_amount)}</div></td>
                    ) : (
                        <td><ExtraCell row={rowIdx} col={5} amount={r.concern_amount} onSaveAmount={(v) => saveField(r.id, 'concern_amount', v)} /></td>
                    )}
                    {staff ? (
                        <td><div className="ro-cell ro-num">{money(r.provider_excess)}</div></td>
                    ) : (
                        <td><ExtraCell row={rowIdx} col={6} amount={r.provider_excess} onSaveAmount={(v) => saveField(r.id, 'provider_excess', v)} /></td>
                    )}
                    <td className="text-right num" style={{ fontWeight: 600 }} title="Amount Received + Tax + Discount + Provider Excess">{peso(rowTotal(r))}</td>
                    <td className="text-right num">{peso(r.receivable_amount)}</td>
                    {(
                      <>
                        <td className="cell-glow"><DateCell row={rowIdx} col={7} value={r.payment_date} onSave={(v) => saveField(r.id, 'payment_date', v)} /></td>
                        <td className="cell-glow"><EditableText row={rowIdx} col={8} value={r.check_ref} onSave={(v) => saveField(r.id, 'check_ref', v)} /></td>
                        <td className="cell-glow">
                          <div className="paid-cell">
                            {r.payment_count > 1
                              ? <div className="ro-cell ro-num" title={`${r.payment_count} payments - use the + button`}>{money(r.paid_amount)}</div>
                              : <EditableText row={rowIdx} col={9} value={r.paid_amount} type="number" align="right" onLive={(v) => setLive(v === null ? null : { id: r.id, field: 'paid_amount', value: v })} onSave={(v) => saveField(r.id, 'paid_amount', v)} />}
                            {data?.payments_enabled && (
                              <button type="button" className="pay-btn" title={r.payment_count > 1 ? `${r.payment_count} payments - open the list` : 'Add another payment / see payments'} aria-label="Payments" onClick={() => { setSheetFirst(false); setPayFor(r); }}>
                                {r.payment_count > 1 ? `×${r.payment_count}` : '+'}
                              </button>
                            )}
                          </div>
                        </td>
                      </>
                    )}
                    <td className="text-right num recv-cell">
                      {(r.pay_amounts || []).length > 0
                        ? (
                          <button type="button" className="recv-btn" title="Open the SOA sheet of this entry" onClick={() => { setSheetFirst(true); setPayFor(r); }}>
                            {r.pay_amounts.map((a, i) => (
                              <div key={i} className="recv-line">{r.pay_amounts.length > 1 && <small>{['1st', '2nd', '3rd'][i] || `${i + 1}th`}</small>}{money(a)}</div>
                            ))}
                          </button>
                        )
                        : (Number(r.paid_amount) > 0 ? <div className="recv-line">{money(r.paid_amount)}</div> : <span style={{ color: 'var(--slate)' }}>—</span>)}
                    </td>
                    <td className="text-right num" style={{ fontWeight: 700 }}>{peso(r.balance)}</td>
                    <td>
                      {r.is_paid && <span style={{ color: 'var(--slate)' }}>—</span>}
                      {!r.is_paid && r.is_overdue && <span className="badge badge-danger ic-overdue" title={`${r.days_overdue} day${r.days_overdue === 1 ? '' : 's'} past due`}>{r.days_overdue.toLocaleString()} day{r.days_overdue === 1 ? '' : 's'}</span>}
                      {!r.is_paid && !r.is_overdue && <span className={`badge ic-clock ${AGING_BADGE[r.aging_bucket] || 'badge-secondary'}`}>{r.aging_bucket}</span>}
                    </td>
                    <td>{Number(r.balance) > 0.009
                      ? <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                        <span className="badge badge-danger ic-unpaid" title="Still has a balance">Unpaid</span>
                        <SettledNote amount={r.rebate} /></div>
                      : <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3 }}>
                        <span className="badge badge-success ic-paid" title="Balance is zero">Paid</span>
                        <SettledNote amount={r.rebate} />
                        {r.variance > 0.009 && <span className="badge badge-warning ic-over" style={{ whiteSpace: 'nowrap' }} title="Net amounts processed are more than the SOA amount (same as the Excel's negative Remaining Balance). Fix the payment if it was typed wrong.">Overpaid {peso(overNet(r))}</span>}</div>}</td>
                    <td><ProofCell entry={r} staff={staff} canAdd={!!data?.payments_enabled} onDone={reload} /></td>
                    <td>{staff ? <div className="ro-cell">{r.remarks || '—'}</div> : <RemarksCell row={rowIdx} col={10} value={r.remarks} onSave={(v) => saveField(r.id, 'remarks', v)} />}</td>
                    {canDelete && <td className="text-center col-sticky-r cell-action"><button type="button" className="btn btn-danger btn-sm" style={{ width: 34, padding: 0, justifyContent: 'center' }} title="Delete entry" aria-label="Delete entry" onClick={() => deleteRow(r)}><TrashIcon /></button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {payFor && (
        <PaymentsModal
          entry={payFor}
          openSheet={sheetFirst}
          onClose={() => { setPayFor(null); setSheetFirst(false); }}
          onChanged={(row) => {
            if (row) setData((d) => ({ ...d, entries: d.entries.map((e) => (e.id === payFor.id ? { ...e, ...row } : e)) }));
            reload();
          }}
        />
      )}
    </div>
  );
}