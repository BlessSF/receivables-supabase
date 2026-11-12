import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { peso, fdate, MONTHS } from '../utils';
import MoneyInput from '../MoneyInput';

const num = (v) => Number(v) || 0;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const sgn = (n) => (n < 0 ? `−${peso(-n)}` : peso(n));
const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y, m) => new Date(y, m, 0).getDate();
const clampDay = (y, m, d) => Math.min(Math.max(1, d), lastDay(y, m));
const mon = (y, m) => `${MONTHS[m - 1].slice(0, 3)} ${y}`;
const fus = (d) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}` : ''); // 2026-09-25 -> 09/25/2026
function parseUs(t) { // 9/25/2026, 09/25/26, 2026-09-25 -> YYYY-MM-DD (null if it is not a real date)
  const s = String(t ?? '').trim();
  let y; let m; let d;
  let a = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (a) { m = Number(a[1]); d = Number(a[2]); y = Number(a[3]); if (y < 100) y += 2000; }
  else if ((a = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) { y = Number(a[1]); m = Number(a[2]); d = Number(a[3]); }
  else return null;
  if (m < 1 || m > 12 || d < 1 || d > lastDay(y, m) || y < 2000 || y > 2100) return null;
  return ymd(y, m, d);
}
// Date box shown as MM/DD/YYYY (type it, or paste it)
function DateBox({ value, onCommit, ariaLabel, placeholder = 'MM/DD/YYYY' }) {
  const [t, setT] = useState(fus(value));
  useEffect(() => { setT(fus(value)); }, [value]);
  const done = () => {
    if (!t.trim()) { if (value) onCommit(''); return; }
    const v = parseUs(t);
    if (v) { setT(fus(v)); if (v !== value) onCommit(v); } else setT(fus(value));
  };
  return <input className="pdc-in pdc-date" inputMode="numeric" value={t} placeholder={placeholder} aria-label={ariaLabel}
    onChange={(e) => setT(e.target.value)} onBlur={done} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />;
}

// One cell from Excel to a number: "216,388.89", "(0.04)", "₱1,000" ... (blank or text gives null)
function cellNum(t) {
  const s = String(t ?? '').trim();
  if (!s || /[a-z]/i.test(s.replace(/e\+?\d+$/i, ''))) return null;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s);
  const n = Number(s.replace(/[(),₱$\s-]/g, ''));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}
// One cell from Excel to YYYY-MM-DD: 02/18/25, 2/18/2025, 2025-02-18, Feb 18, 2025 (else null)
function cellDate(t) {
  const s = String(t ?? '').trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { let y = Number(m[3]); if (y < 100) y += 2000; return Number(m[1]) >= 1 && Number(m[1]) <= 12 && Number(m[2]) >= 1 && Number(m[2]) <= 31 ? ymd(y, Number(m[1]), Number(m[2])) : null; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  if (/[a-z]/i.test(s) && /\d{4}/.test(s)) { const d = new Date(s); if (!Number.isNaN(d.getTime())) return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
  return null;
}

// PDC Tracker: every Future payable (Cash Position) has its own tracker. Type its balance and the "as of" date, then the PDC
// paid each month (or make the rows, or paste them from Excel); the amount comes off the balance until it is paid.
export default function PdcTracker() {
  const [year, setYear] = useState(null);
  const [data, setData] = useState(null);
  const [typed, setTyped] = useState({}); // { itemId: [12 text boxes] }
  const [dates, setDates] = useState({}); // { itemId: [12 'YYYY-MM-DD' or ''] } the exact date issued
  const [setup, setSetup] = useState({}); // { itemId: { amount, date, monthly, day } } text boxes of the balance box
  const [sel, setSel] = useState('');
  const [firstTxt, setFirstTxt] = useState(''); // the first date typed for an item that has no rows yet
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(0);
  const lastSaved = useRef({}); // { itemId: [{ a, d }] }
  const [tip, setTip] = useState(null); // hover card: { id, m (0 = beginning, 1-12), left, w, top | bottom }
  const tipTimer = useRef(null);
  const [showList, setShowList] = useState(() => { try { return localStorage.getItem('pdc_show_list') === '1'; } catch { return false; } }); // Running payables list: hidden by default
  const toggleList = () => setShowList((v) => { const n = !v; try { localStorage.setItem('pdc_show_list', n ? '1' : '0'); } catch { /* ignore */ } return n; });
  const flash = (t) => { setSaved(t); setTimeout(() => setSaved(''), 2600); };
  function openTip(id, m, el) {
    clearTimeout(tipTimer.current);
    const r = el.getBoundingClientRect();
    const w = Math.min(420, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
    const down = r.top < window.innerHeight / 2;
    setTip({ id, m, left, w, ...(down ? { top: r.bottom + 6 } : { bottom: window.innerHeight - r.top + 6 }) });
  }
  const closeTip = () => { clearTimeout(tipTimer.current); tipTimer.current = setTimeout(() => setTip(null), 160); };

  function load(y) {
    setErr('');
    return api.getPdcTracker(y || '')
      .then((r) => {
        setData(r.data); setYear(r.data.year);
        const t = {}; const dt = {}; const ls = {}; const su = {};
        for (const it of r.data.items || []) {
          t[it.id] = it.months.map((n) => (n ? String(n) : ''));
          dt[it.id] = it.dates.slice();
          ls[it.id] = it.months.map((n, i) => ({ a: n, d: it.dates[i] || '' }));
          su[it.id] = { amount: it.start_amount === null ? '' : String(it.start_amount), date: it.start_date || '' };
        }
        setTyped(t); setDates(dt); lastSaved.current = ls; setSetup(su);
        setSel((cur) => ((r.data.items || []).some((it) => it.id === cur) ? cur : (r.data.items?.[0]?.id || '')));
      })
      .catch((e) => setErr(e.message));
  }
  useEffect(() => { load(); }, []);

  const due = useMemo(() => {
    const none = { total: 0, count: 0 };
    for (const p of data?.payables || []) if (!p.check_date) { none.total += p.amount; none.count++; }
    return { none };
  }, [data]);

  // ---- saving one row (amount + exact date)
  async function commit(it, i, over = {}) {
    const amount = num(over.a !== undefined ? over.a : typed[it.id]?.[i]);
    const d = over.d !== undefined ? over.d : (dates[it.id]?.[i] || '');
    const was = lastSaved.current[it.id]?.[i] || { a: 0, d: '' };
    if (r2(amount) === r2(was.a) && d === was.d) return;
    try {
      await api.savePdcAmount(year, i + 1, amount, it.id, d || null);
      lastSaved.current[it.id][i] = { a: amount, d };
      flash(`${it.label} · ${d ? fus(d) : MONTHS[i]} saved`);
    } catch (e) { setErr(e.message); }
  }

  // a new date typed in a row: the same month just changes the day; another month moves the row there
  async function changeDate(it, i, v) {
    const was = dates[it.id]?.[i] || '';
    if (!v) { setDates((x) => ({ ...x, [it.id]: x[it.id].map((d, k) => (k === i ? '' : d)) })); await commit(it, i, { d: '' }); return; }
    const ny = Number(v.slice(0, 4)); const nm = Number(v.slice(5, 7));
    if (ny === year && nm === i + 1) { setDates((x) => ({ ...x, [it.id]: x[it.id].map((d, k) => (k === i ? v : d)) })); await commit(it, i, { d: v }); return; }
    if (ny === year && existsRow(it, nm - 1)) { setErr(`${MONTHS[nm - 1]} ${ny} already has a row. Change that row instead.`); setDates((x) => ({ ...x })); return; }
    if (ny !== year && !window.confirm(`Move this row to ${fus(v)}? If ${MONTHS[nm - 1]} ${ny} already has a row, it is replaced.`)) { setDates((x) => ({ ...x })); return; }
    try {
      await api.savePdcAmount(ny, nm, num(typed[it.id]?.[i]), it.id, v);
      await api.savePdcAmount(year, i + 1, 0, it.id, null);
      flash(`${it.label} · moved to ${fus(v)}`); await load(ny);
    } catch (e) { setErr(e.message); }
  }
  const existsRow = (it, i) => !!(dates[it.id]?.[i]) || num(typed[it.id]?.[i]) > 0;

  // + Add row: the next month after the last row, on the same day as the first row (also into the next year)
  async function addRow(it) {
    let ny; let nm; let nd;
    if (it.last_date) {
      ny = Number(it.last_date.slice(0, 4)); nm = Number(it.last_date.slice(5, 7)) + 1;
      if (nm > 12) { nm = 1; ny += 1; }
      nd = ymd(ny, nm, clampDay(ny, nm, Number((it.first_date || it.last_date).slice(8, 10))));
    } else {
      nd = parseUs(firstTxt);
      if (!nd) { setErr('Type the first date as MM/DD/YYYY (for example 09/25/2026).'); return; }
      ny = Number(nd.slice(0, 4)); nm = Number(nd.slice(5, 7));
    }
    if (ny > 2100) { setErr('That year is too far ahead.'); return; }
    try { await api.savePdcAmount(ny, nm, 0, it.id, nd); setFirstTxt(''); flash(`Row ${fus(nd)} added`); await load(ny); } catch (e) { setErr(e.message); }
  }
  async function removeRow(it, i) {
    if (!window.confirm(`Remove the row ${dates[it.id]?.[i] ? fus(dates[it.id][i]) : MONTHS[i]} (${peso(num(typed[it.id]?.[i]))}) from ${it.label}?`)) return;
    try { await api.savePdcAmount(year, i + 1, 0, it.id, null); flash('Row removed'); await load(year); } catch (e) { setErr(e.message); }
  }

  // ---- the balance box of one item
  const setupBody = (it, patch = {}) => {
    const s = { ...(setup[it.id] || {}), ...patch };
    return { start_amount: s.amount === '' || s.amount === undefined ? null : num(s.amount), start_date: s.date || null, monthly: 0, pay_day: null };
  };
  async function commitSetup(it, patch) {
    const b = setupBody(it, patch);
    if ((b.start_amount ?? null) === (it.start_amount ?? null) && (b.start_date || '') === (it.start_date || '')) return;
    try { await api.savePdcItem(it.id, b); flash(`${it.label} balance saved`); await load(year); } catch (e) { setErr(e.message); }
  }
  // ---- paste from Excel: Date issued | Amount | Balance (or only the amounts). Paste into any row of the table.
  async function onPasteRows(e) {
    const text = e.clipboardData?.getData('text') || '';
    if (!/[\n\t]/.test(text.trim())) return; // one value: normal paste
    const tr = e.target.closest ? e.target.closest('tr[data-m]') : null;
    const it = items.find((x) => x.id === sel);
    const fromBox = !!(e.target.dataset && e.target.dataset.paste); // the First date box (no rows yet)
    if ((!tr && !fromBox) || !it) return;
    e.preventDefault();
    let y = year; let m = tr ? Number(tr.dataset.m) : new Date().getMonth() + 1;
    const entries = []; let start = null;
    for (const line of text.replace(/\r/g, '').split('\n')) {
      if (!line.trim()) continue;
      const cells = line.split('\t').map((c) => c.trim());
      // columns as in Excel: Date issued | Amount | Balance (two columns: Date | Amount, or Amount | Balance; one: Amount)
      let when = null; let amount = null; let balance = null;
      if (cells.length >= 3) { when = cellDate(cells[0]); amount = cellNum(cells[1]); balance = cellNum(cells[2]); }
      else if (cells.length === 2) { if (cellDate(cells[0])) { when = cellDate(cells[0]); amount = cellNum(cells[1]); } else { amount = cellNum(cells[0]); balance = cellNum(cells[1]); } }
      else amount = cellNum(cells[0]);
      if (amount === null && balance !== null && !entries.length && !start) { start = { amount: balance, date: when }; continue; } // the top row: the balance it starts from
      if (amount === null || amount < 0) continue;
      if (when) { entries.push({ year: Number(when.slice(0, 4)), month: Number(when.slice(5, 7)), amount: r2(amount), pay_date: when }); y = Number(when.slice(0, 4)); m = Number(when.slice(5, 7)) + 1; }
      else entries.push({ year: y, month: m, amount: r2(amount), pay_date: ymd(y, m, clampDay(y, m, it.first_date ? Number(it.first_date.slice(8, 10)) : 1)) });
      if (!when) m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
    if (!entries.length && !start) { setErr('Nothing to paste. Copy the Date issued and Amount columns from Excel.'); return; }
    const a = entries[0]; const z = entries[entries.length - 1];
    if (!window.confirm(`Paste into ${it.label}?${entries.length ? `\n\n${entries.length} month${entries.length === 1 ? '' : 's'}: ${mon(a.year, a.month)} to ${mon(z.year, z.month)} (replaces what is in those months).` : ''}${start ? `\nBalance ${peso(start.amount)}${start.date ? ` as of ${fus(start.date)}` : ''} (replaces the current balance).` : ''}`)) return;
    setBusy(true);
    try {
      if (start) { const b = setupBody(it); await api.savePdcItem(it.id, { ...b, start_amount: start.amount, start_date: start.date || b.start_date }); }
      if (entries.length) await api.savePdcBulk(it.id, entries);
      flash(`Pasted ${entries.length} month${entries.length === 1 ? '' : 's'} into ${it.label}`); await load(year);
    } catch (er) { setErr(er.message); }
    setBusy(false);
  }

  if (!data && !err) return <div className="loading-state">Loading…</div>;
  if (!data) return <div className="flash flash-error">{err}</div>;

  // beginning balance and the balance after each month, per item
  const items = data.items || [];
  const calc = (it) => {
    const startAmt = it.start_amount === null ? it.amount : it.start_amount; // typed balance, else the Future payables amount
    const sk = it.start_date ? Number(it.start_date.slice(0, 4)) * 12 + Number(it.start_date.slice(5, 7)) : 0;
    const begin = r2(startAmt - it.paid_before);
    const bal = []; let run = begin; let paid = 0;
    for (let i = 0; i < 12; i++) {
      const k = year * 12 + i + 1; const d = dates[it.id]?.[i] || '';
      if (sk && k < sk) { bal.push(null); continue; } // before the "as of" month there is no balance yet
      const counts = !sk || k > sk || (k === sk && d && d > it.start_date);
      if (counts) { const a = num(typed[it.id]?.[i]); run = r2(run - a); paid = r2(paid + a); }
      bal.push(run);
    }
    return { startAmt, begin, bal, paid, end: run };
  };
  const calcs = Object.fromEntries(items.map((it) => [it.id, calc(it)]));
  const sum = (k) => r2(items.reduce((t, it) => t + calcs[it.id][k], 0));
  const cur = items.find((it) => it.id === sel) || items[0];
  const cc = cur ? calcs[cur.id] : null;
  const su = cur ? setup[cur.id] || {} : {};
  const shown = (data.payables || []).filter((p) => {
    const mo = p.check_date ? Number(p.check_date.slice(5, 7)) : 0;
    return !pick || mo === pick;
  });
  const shownTotal = r2(shown.reduce((t, p) => t + p.amount, 0));
  const setSu = (patch) => setSetup((s) => ({ ...s, [cur.id]: { ...(s[cur.id] || {}), ...patch } }));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>PDC Tracker</h1>
          <div className="subtitle">Each future payable has its own card. Click a card, type its balance and the date of that balance, then the PDC for each month. Use ‹ › to go to other years.</div>
        </div>
        <div className="pdc-year">
          <button type="button" className="btn btn-secondary" onClick={() => load(year - 1)} aria-label="Previous year">‹</button>
          <b>{year}</b>
          <button type="button" className="btn btn-secondary" onClick={() => load(year + 1)} aria-label="Next year">›</button>
          {year !== data.this_year && <button type="button" className="btn btn-secondary" onClick={() => load(data.this_year)}>This year</button>}
        </div>
      </div>
      {err && <div className="flash flash-error" role="alert">{err}</div>}

      {items.length === 0 && (
        <div className="panel"><div className="pdc-foot"><span>No future payables yet. Add them in <Link to="/payables/cash-position" className="pay-link-btn">Cash Position</Link> and each one gets its own tracker here.</span></div></div>
      )}

      {items.length > 0 && (
        <div className="pdc-cards">
          <div className="pdc-card pdc-card-all">
            <span className="pdc-card-name">All future payables</span>
            <b className="pdc-card-bal">{sgn(sum('end'))}</b>
            <span className="pdc-card-sub">left at end of {year} · started {year} at {sgn(sum('begin'))}</span>
            <span className="pdc-card-sub">PDC in {year}: {peso(sum('paid'))}</span>
          </div>
          {items.map((it) => {
            const k = calcs[it.id];
            const share = k.startAmt > 0 ? Math.max(0, Math.min(100, ((k.startAmt - k.end) / k.startAmt) * 100)) : 0;
            const on = cur && cur.id === it.id;
            return (
              <button type="button" key={it.id} className={`pdc-card pdc-card-pick ${on ? 'on' : ''}`} onClick={() => setSel(it.id)} aria-pressed={on}>
                <span className="pdc-card-name">{it.label}</span>
                <b className={`pdc-card-bal ${k.end < 0 ? 'neg' : ''}`}>{sgn(k.end)}</b>
                <span className="pdc-card-sub">left at end of {year} · started at {sgn(k.startAmt)}{it.start_date ? ` (${fus(it.start_date)})` : ''}</span>
                <span className="pdc-card-bar"><i style={{ width: `${share}%` }} /></span>
                <span className="pdc-card-sub">{share.toFixed(0)}% paid · PDC in {year}: {peso(k.paid)}</span>
                <span className="pdc-card-open">{on ? 'Showing below ↓' : 'Click to open'}</span>
              </button>
            );
          })}
        </div>
      )}

      {cur && (
        <div className="panel">
          <div className="pdc-list-head"><h2>{cur.label} · {year}</h2></div>
          <div className="pdc-setup">
            <label><span>Balance</span><MoneyInput className="pdc-in" placeholder={peso(cur.amount)} aria-label="Balance" value={su.amount || ''} onChange={(v) => setSu({ amount: v })} onBlur={() => commitSetup(cur)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} /></label>
            <label><span>as of</span><DateBox value={su.date || ''} ariaLabel="Balance as of" onCommit={(v) => { setSu({ date: v }); commitSetup(cur, { date: v }); }} /></label>
            {!cur.last_date && <label><span>First date</span><input className="pdc-in pdc-date" inputMode="numeric" placeholder="09/25/2026" aria-label="First date" data-paste="1" onPaste={onPasteRows} value={firstTxt} onChange={(e) => setFirstTxt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addRow(cur); }} /></label>}
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => addRow(cur)}>+ Add row</button>
          </div>
          <p className="pdc-tip">{cur.last_date ? 'Each new row is the next month on the same day, and it goes on into the next year.' : 'Type the first date (like 09/25/2026) and press + Add row. The next rows follow month by month.'} The balance is typed here (blank = the Future payables amount). You can also copy rows from Excel and paste them into the table.</p>
          <div className="table-wrap" onPaste={onPasteRows}>
            <table className="data-table pdc-table">
              <thead>
                <tr>
                  <th>Date issued</th>
                  <th className="text-right">PDC amount (type here)</th>
                  <th className="text-right">Balance <span className="pdc-hint">hover an amount to see why</span></th>
                  <th />
                </tr>
              </thead>
              <tbody>
                <tr className="pdc-total">
                  <td>Beginning balance <small className="pdc-none">{cur.start_date ? `as of ${fus(cur.start_date)}` : cur.start_amount === null ? 'Future payables amount' : ''}{cur.paid_before ? ` less PDC paid before ${year}` : ''}</small></td>
                  <td />
                  <td className="text-right pdc-bal">
                    <span className="pdc-why" tabIndex={0} aria-label={`Why the beginning balance is ${sgn(cc.begin)}`}
                      onMouseEnter={(e) => openTip(cur.id, 0, e.currentTarget)} onMouseLeave={closeTip}
                      onFocus={(e) => openTip(cur.id, 0, e.currentTarget)} onBlur={closeTip}>{sgn(cc.begin)}</span>
                  </td>
                  <td />
                </tr>
                {MONTHS.map((name, i) => (!existsRow(cur, i) ? null : (
                  <tr key={name} data-m={i + 1}>
                    <td>
                      <DateBox value={dates[cur.id]?.[i] || ''} ariaLabel={`Date issued ${cur.label} ${name}`} placeholder={`${name.slice(0, 3)} ${year}`} onCommit={(v) => changeDate(cur, i, v)} />
                    </td>
                    <td className="text-right">
                      <MoneyInput className="pdc-in" aria-label={`PDC amount ${cur.label} ${name}`} placeholder="0.00" value={typed[cur.id]?.[i] || ''}
                        onChange={(v) => setTyped((t) => ({ ...t, [cur.id]: (t[cur.id] || []).map((x, k) => (k === i ? v : x)) }))}
                        onBlur={() => commit(cur, i)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
                    </td>
                    <td className="text-right pdc-bal">
                      {cc.bal[i] === null ? '—' : (
                        <span className="pdc-why" tabIndex={0} aria-label={`Why ${name} is ${sgn(cc.bal[i])}`}
                          onMouseEnter={(e) => openTip(cur.id, i + 1, e.currentTarget)} onMouseLeave={closeTip}
                          onFocus={(e) => openTip(cur.id, i + 1, e.currentTarget)} onBlur={closeTip}>{sgn(cc.bal[i])}{cc.bal[i] <= 0.004 && cc.bal[i] > -0.005 && num(typed[cur.id]?.[i]) > 0 ? ' · END' : ''}</span>
                      )}
                    </td>
                    <td className="text-right"><button type="button" className="at-x" onClick={() => removeRow(cur, i)} aria-label="Remove row" title="Remove this row">×</button></td>
                  </tr>
                )))}
                {!MONTHS.some((_, i) => existsRow(cur, i)) && <tr><td colSpan={4} className="pdc-none">No rows in {year}. {cur.last_date ? `Use ‹ › to find the other years, or press + Add row to continue after ${fus(cur.last_date)}.` : 'Type the first date above and press + Add row.'}</td></tr>}
                <tr className="pdc-total">
                  <td>Total PDC · balance at the end of {year}</td>
                  <td className="text-right">{peso(cc.paid)}</td>
                  <td className="text-right">{sgn(cc.end)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <div className="pdc-foot"><span>{busy ? 'Saving…' : saved || 'Amounts and dates save as soon as you leave the box.'}</span></div>
        </div>
      )}

      <div className="panel">
        <div className="pdc-list-head">
          <h2>Running payables {pick ? `· ${MONTHS[pick - 1]} ${year}` : `· ${year}`}</h2>
          <span>
            {showList && pick > 0 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPick(0)}>Show all months</button>}{' '}
            <button type="button" className="btn btn-secondary btn-sm" onClick={toggleList}>{showList ? 'Hide' : 'Show'}</button>
          </span>
        </div>
        {!showList && <div className="pdc-foot"><span>Hidden. {shown.length} unpaid payable{shown.length === 1 ? '' : 's'} ({peso(shownTotal)}). Click Show to see the list.</span></div>}
        {showList && <><div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Check date</th><th>Payee</th><th>Account title</th><th>Status</th><th className="text-right">Amount</th></tr>
            </thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={5} className="pdc-none">No unpaid running payables{pick ? ' in this month' : ''}.</td></tr>}
              {shown.map((p) => (
                <tr key={p.id}>
                  <td>{p.check_date ? fdate(p.check_date) : <span className="pdc-none">No check date</span>}</td>
                  <td>{p.payee}</td>
                  <td>{p.category}{p.title_name ? ` · ${p.title_name}` : ''}</td>
                  <td>{p.release_status}</td>
                  <td className="text-right">{peso(p.amount)}</td>
                </tr>
              ))}
              <tr className="pdc-total"><td colSpan={4}>Total · {shown.length} payable{shown.length === 1 ? '' : 's'}</td><td className="text-right">{peso(shownTotal)}</td></tr>
            </tbody>
          </table>
        </div>
        {!pick && due.none.count > 0 && <div className="pdc-foot"><span>{due.none.count} of these have no check date ({peso(due.none.total)}).</span></div>}</>}
      </div>
      {tip && (() => {
        const it = items.find((x) => x.id === tip.id);
        if (!it) return null;
        const k = calcs[it.id]; const m = tip.m;
        let before = k.begin;
        if (m > 1) { for (let q = m - 2; q >= 0; q--) { if (k.bal[q] !== null) { before = k.bal[q]; break; } } }
        const prevName = m > 1 ? MONTHS[m - 2] : '';
        return (
          <div className="pdc-pop" role="tooltip" style={{ left: tip.left, width: tip.w, top: tip.top, bottom: tip.bottom }}
            onMouseEnter={() => clearTimeout(tipTimer.current)} onMouseLeave={closeTip}>
            {m === 0 ? (
              <>
                <div className="pdc-pop-head"><b>{it.label}</b><span>Beginning balance {year}</span></div>
                <div className="pdc-pop-total"><span>{it.start_amount === null ? 'Future payables amount (Cash Position)' : `Balance typed${it.start_date ? ` as of ${fus(it.start_date)}` : ''}`}</span><b>{sgn(k.startAmt)}</b></div>
                {it.paid_before !== 0 && <div className="pdc-pop-total"><span>Less: PDC paid before {year}</span><b>− {peso(it.paid_before)}</b></div>}
                <div className="pdc-pop-total"><span>Beginning balance</span><b>{sgn(k.begin)}</b></div>
              </>
            ) : (
              <>
                <div className="pdc-pop-head"><b>{it.label} · {MONTHS[m - 1]} {year}</b><span>{m === 1 || before === k.begin ? 'Beginning balance' : `Balance after ${prevName}`} less this month's PDC</span></div>
                <div className="pdc-pop-total"><span>{m === 1 || before === k.begin ? 'Beginning balance' : `Balance after ${prevName}`}</span><b>{sgn(before)}</b></div>
                <div className="pdc-pop-total"><span>Less: PDC amount {MONTHS[m - 1]}</span><b>− {peso(num(typed[it.id]?.[m - 1]))}</b></div>
                <div className="pdc-pop-total"><span>Balance</span><b>{sgn(k.bal[m - 1])}</b></div>
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}