import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
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
const flong = (d) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}` : ''); // 2026-01-11 -> January 11, 2026
const rkey = (y, m) => `${y}-${m}`;
// what you type -> YYYY-MM-DD: January 11, 2026 | Jan 11 2026 | 1/11/2026 | 01/11/26 | 2026-01-11 (null if it is not a real date)
function parseDate(t) {
  const s = String(t ?? '').trim().replace(/\s+/g, ' ');
  let y; let m; let d; let a;
  if ((a = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) { m = Number(a[1]); d = Number(a[2]); y = Number(a[3]); if (y < 100) y += 2000; }
  else if ((a = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) { y = Number(a[1]); m = Number(a[2]); d = Number(a[3]); }
  else if ((a = s.match(/^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/))) {
    const k = MONTHS.findIndex((n) => n.toLowerCase().startsWith(a[1].toLowerCase().slice(0, 3)) && n.toLowerCase().startsWith(a[1].toLowerCase()));
    if (k < 0) return null; m = k + 1; d = Number(a[2]); y = Number(a[3]);
  } else return null;
  if (m < 1 || m > 12 || d < 1 || d > lastDay(y, m) || y < 2000 || y > 2100) return null;
  return ymd(y, m, d);
}
// Date box shown like January 11, 2026: type it in any of those forms, paste it, or pick it from the calendar button
function DateBox({ value, onCommit, ariaLabel, placeholder = 'January 11, 2026', onPaste, pasteBox }) {
  const [t, setT] = useState(flong(value));
  const pick = useRef(null);
  useEffect(() => { setT(flong(value)); }, [value]);
  const done = () => {
    if (!t.trim()) { if (value) onCommit(''); return; }
    const v = parseDate(t);
    if (v) { setT(flong(v)); if (v !== value) onCommit(v); } else setT(flong(value));
  };
  const openCalendar = () => { const el = pick.current; if (!el) return; try { el.showPicker(); } catch { el.focus(); el.click(); } };
  return (
    <span className="pdc-datewrap">
      <input className="pdc-in pdc-date" value={t} placeholder={placeholder} aria-label={ariaLabel} data-paste={pasteBox ? '1' : undefined} onPaste={onPaste}
        onChange={(e) => setT(e.target.value)} onBlur={done} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
      <button type="button" className="pdc-cal" onClick={openCalendar} aria-label="Pick from the calendar" title="Pick from the calendar">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>
      </button>
      <input ref={pick} type="date" className="pdc-cal-native" tabIndex={-1} aria-hidden="true" value={value || ''} min="2000-01-01" max="2100-12-31"
        onChange={(e) => { const v = e.target.value; if (v && v !== value) { setT(flong(v)); onCommit(v); } }} />
    </span>
  );
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

// PDC Tracker: every Future payable (Cash Position) has its own card and its own list of rows, all years together.
// Type its balance and the "as of" date, press + Add row (the next month, same day), and type the PDC of each row.
export default function PdcTracker() {
  const [year, setYear] = useState(null); // this year (for the running payables below)
  const [data, setData] = useState(null);
  const [rows, setRows] = useState({}); // { itemId: [{ year, month, a (text), d ('YYYY-MM-DD' or '') }] }
  const [setup, setSetup] = useState({}); // { itemId: { amount, date } } the balance box
  const [sel, setSel] = useState('');
  const [ask, setAsk] = useState(null); // the confirm window: { title, lines, ok, danger, run }
  const [edit, setEdit] = useState(null); // the Edit window: { id, name, amount, date, del (asking to confirm the removal) }
  const [adding, setAdding] = useState(false); // the "+ Add future payable" form
  const [newName, setNewName] = useState('');
  const [newAmt, setNewAmt] = useState('');
  const [firstTxt, setFirstTxt] = useState(''); // the first date typed for an item that has no rows yet
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const lastSaved = useRef({}); // { itemId: { 'y-m': { a, d } } }
  const [tip, setTip] = useState(null); // hover card: { id, idx (-1 = beginning balance), left, w, top | bottom }
  const tipTimer = useRef(null);
  const [showList, setShowList] = useState(() => { try { return localStorage.getItem('pdc_show_list') === '1'; } catch { return false; } }); // Running payables list: hidden by default
  const toggleList = () => setShowList((v) => { const n = !v; try { localStorage.setItem('pdc_show_list', n ? '1' : '0'); } catch { /* ignore */ } return n; });
  const flash = (t) => { setSaved(t); setTimeout(() => setSaved(''), 2600); };
  function openTip(id, idx, el) {
    clearTimeout(tipTimer.current);
    const r = el.getBoundingClientRect();
    const w = Math.min(420, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
    const down = r.top < window.innerHeight / 2;
    setTip({ id, idx, left, w, ...(down ? { top: r.bottom + 6 } : { bottom: window.innerHeight - r.top + 6 }) });
  }
  const closeTip = () => { clearTimeout(tipTimer.current); tipTimer.current = setTimeout(() => setTip(null), 160); };

  function load() {
    setErr('');
    return api.getPdcTracker('')
      .then((r) => {
        setData(r.data); setYear(r.data.year);
        const rw = {}; const ls = {}; const su = {};
        for (const it of r.data.items || []) {
          rw[it.id] = (it.rows || []).map((x) => ({ year: x.year, month: x.month, a: x.amount ? String(x.amount) : '', d: x.date || '', p: !!x.paid }));
          ls[it.id] = Object.fromEntries((it.rows || []).map((x) => [rkey(x.year, x.month), { a: x.amount, d: x.date || '' }]));
          su[it.id] = { amount: it.start_amount === null ? '' : String(it.start_amount), date: it.start_date || '' };
        }
        setRows(rw); lastSaved.current = ls; setSetup(su);
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

  const patchRow = (id, idx, patch) => setRows((x) => ({ ...x, [id]: x[id].map((r, k) => (k === idx ? { ...r, ...patch } : r)) }));

  // ---- saving one row (amount + exact date)
  async function commit(it, idx, over = {}) {
    const r = rows[it.id][idx];
    const amount = num(over.a !== undefined ? over.a : r.a);
    const d = over.d !== undefined ? over.d : r.d;
    const k = rkey(r.year, r.month);
    const was = lastSaved.current[it.id]?.[k] || { a: 0, d: '' };
    if (r2(amount) === r2(was.a) && d === was.d) return;
    try {
      await api.savePdcAmount(r.year, r.month, amount, it.id, d || null);
      lastSaved.current[it.id][k] = { a: amount, d };
      flash(`${it.label} · ${d ? flong(d) : mon(r.year, r.month)} saved`);
    } catch (e) { setErr(e.message); }
  }

  // a new date typed in a row: the same month just changes the day; another month moves the row there
  async function togglePaid(it, idx) {
    const r = rows[it.id][idx]; const nv = !r.p;
    patchRow(it.id, idx, { p: nv });
    try { await api.setPdcPaid(it.id, r.year, r.month, nv); flash(`${r.d ? flong(r.d) : mon(r.year, r.month)} ${nv ? 'marked paid ✓' : 'unchecked'}`); }
    catch (e) { patchRow(it.id, idx, { p: !nv }); setErr(e.message); }
  }

  async function changeDate(it, idx, v) {
    const r = rows[it.id][idx];
    if (!v) { patchRow(it.id, idx, { d: '' }); await commit(it, idx, { d: '' }); return; }
    const ny = Number(v.slice(0, 4)); const nm = Number(v.slice(5, 7));
    if (ny === r.year && nm === r.month) { patchRow(it.id, idx, { d: v }); await commit(it, idx, { d: v }); return; }
    if (rows[it.id].some((x) => x.year === ny && x.month === nm)) { setErr(`${MONTHS[nm - 1]} ${ny} already has a row. Change that row instead.`); patchRow(it.id, idx, {}); return; }
    try {
      await api.savePdcAmount(ny, nm, num(r.a), it.id, v);
      if (r.p) await api.setPdcPaid(it.id, ny, nm, true);
      await api.savePdcAmount(r.year, r.month, 0, it.id, null);
      flash(`${it.label} · moved to ${flong(v)}`); await load();
    } catch (e) { setErr(e.message); }
  }

  // + Add row: the next month after the last row, on the same day as the first row (also into the next year)
  async function addRow(it) {
    const list = rows[it.id] || [];
    let ny; let nm; let nd;
    if (list.length) {
      const last = list[list.length - 1]; const first = list[0];
      ny = last.year; nm = last.month + 1; if (nm > 12) { nm = 1; ny += 1; }
      nd = ymd(ny, nm, clampDay(ny, nm, Number((first.d || ymd(first.year, first.month, 1)).slice(8, 10))));
    } else {
      nd = parseDate(firstTxt);
      if (!nd) { setErr('Type the first date, like September 25, 2026.'); return; }
      ny = Number(nd.slice(0, 4)); nm = Number(nd.slice(5, 7));
    }
    if (ny > 2100) { setErr('That year is too far ahead.'); return; }
    try { await api.savePdcAmount(ny, nm, 0, it.id, nd); setFirstTxt(''); flash(`Row ${flong(nd)} added`); await load(); } catch (e) { setErr(e.message); }
  }
  function removeRow(it, idx) {
    const r = rows[it.id][idx];
    setAsk({
      title: 'Remove this PDC row?', danger: true, ok: 'Yes, remove it',
      lines: [`${it.label}`, `${r.d ? flong(r.d) : mon(r.year, r.month)} · ${peso(num(r.a))}${r.p ? ' · marked paid' : ''}`, 'The balance and the Cash Position list are updated. This cannot be undone.'],
      run: async () => { try { await api.savePdcAmount(r.year, r.month, 0, it.id, null); flash('Row removed'); await load(); } catch (e) { setErr(e.message); } },
    });
  }

  // ---- future payables live here now: add, rename, remove (Cash Position shows the next unpaid row of each)
  async function addItem() {
    if (!newName.trim()) { setErr('Type the name of the future payable.'); return; }
    try {
      const r = await api.managePdcItem({ op: 'add', label: newName.trim(), amount: num(newAmt) });
      setNewName(''); setNewAmt(''); setAdding(false); flash(`${r.label} added`);
      await load(); setSel(r.item_id);
    } catch (e) { setErr(e.message); }
  }
  const openEdit = (it) => { const k = calcs[it.id]; setEdit({ id: it.id, name: it.label, amount: String(k ? k.startAmt : it.amount), date: it.start_date || '', del: false }); };
  async function saveEdit() {
    const it = items.find((x) => x.id === edit.id); if (!it) return;
    const name = edit.name.trim();
    if (!name) { setErr('Type the name.'); return; }
    const amount = edit.amount === '' ? null : num(edit.amount);
    setBusy(true);
    try {
      if (name !== it.label) await api.managePdcItem({ op: 'rename', item_id: it.id, label: name });
      if ((amount ?? null) !== (it.start_amount ?? null) || (edit.date || '') !== (it.start_date || '')) await api.savePdcItem(it.id, { start_amount: amount, start_date: edit.date || null, monthly: 0, pay_day: null });
      flash(`${name} saved`); setEdit(null); await load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }
  async function removeItem() {
    const it = items.find((x) => x.id === edit.id); if (!it) return;
    setBusy(true);
    try { await api.managePdcItem({ op: 'delete', item_id: it.id }); flash(`${it.label} removed`); setEdit(null); await load(); } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  // ---- the balance box of one item
  const setupBody = (it, patch = {}) => {
    const s = { ...(setup[it.id] || {}), ...patch };
    return { start_amount: s.amount === '' || s.amount === undefined ? null : num(s.amount), start_date: s.date || null, monthly: 0, pay_day: null };
  };
  async function commitSetup(it, patch) {
    const b = setupBody(it, patch);
    if ((b.start_amount ?? null) === (it.start_amount ?? null) && (b.start_date || '') === (it.start_date || '')) return;
    try { await api.savePdcItem(it.id, b); flash(`${it.label} balance saved`); await load(); } catch (e) { setErr(e.message); }
  }

  // ---- paste from Excel: Date issued | Amount | Balance (or only the amounts). Paste into any row, or into the First date box.
  async function onPasteRows(e) {
    const text = e.clipboardData?.getData('text') || '';
    if (!/[\n\t]/.test(text.trim())) return; // one value: normal paste
    const tr = e.target.closest ? e.target.closest('tr[data-ym]') : null;
    const it = items.find((x) => x.id === sel);
    const fromBox = !!(e.target.dataset && e.target.dataset.paste);
    if ((!tr && !fromBox) || !it) return;
    e.preventDefault();
    const list = rows[it.id] || [];
    let y; let m;
    if (tr) { [y, m] = tr.dataset.ym.split('-').map(Number); }
    else if (list.length) { const l = list[list.length - 1]; y = l.year; m = l.month + 1; if (m > 12) { m = 1; y += 1; } }
    else { y = new Date().getFullYear(); m = new Date().getMonth() + 1; }
    const anchor = list.length ? Number((list[0].d || ymd(list[0].year, list[0].month, 1)).slice(8, 10)) : 1;
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
      else { entries.push({ year: y, month: m, amount: r2(amount), pay_date: ymd(y, m, clampDay(y, m, anchor)) }); m += 1; }
      if (m > 12) { m = 1; y += 1; }
    }
    if (!entries.length && !start) { setErr('Nothing to paste. Copy the Date issued and Amount columns from Excel.'); return; }
    const a = entries[0]; const z = entries[entries.length - 1];
    setAsk({
      title: `Paste into ${it.label}?`, ok: 'Yes, paste',
      lines: [
        ...(entries.length ? [`${entries.length} row${entries.length === 1 ? '' : 's'}: ${mon(a.year, a.month)} to ${mon(z.year, z.month)}`, 'This replaces what is in those months.'] : []),
        ...(start ? [`Balance ${peso(start.amount)}${start.date ? ` as of ${flong(start.date)}` : ''} (replaces the current balance).`] : []),
      ],
      run: async () => {
        setBusy(true);
        try {
          if (start) { const b = setupBody(it); await api.savePdcItem(it.id, { ...b, start_amount: start.amount, start_date: start.date || b.start_date }); }
          if (entries.length) await api.savePdcBulk(it.id, entries);
          flash(`Pasted ${entries.length} row${entries.length === 1 ? '' : 's'} into ${it.label}`); await load();
        } catch (er) { setErr(er.message); }
        setBusy(false);
      },
    });
  }

  if (!data && !err) return <div className="loading-state">Loading…</div>;
  if (!data) return <div className="flash flash-error">{err}</div>;

  // the balance after every row, per item (all years together)
  const items = data.items || [];
  const calc = (it) => {
    const startAmt = it.start_amount === null ? it.amount : it.start_amount; // typed balance, else the Future payables amount
    const sd = it.start_date || '';
    let run = startAmt; let paid = 0; let done = 0;
    const bal = (rows[it.id] || []).map((r) => {
      const eff = r.d || ymd(r.year, r.month, 1);
      if (sd && eff < sd) return null; // before the "as of" date there is no balance yet
      const a = num(r.a); run = r2(run - a); paid = r2(paid + a);
      if (r.p) done = r2(done + a); // only the rows with the check mark are really paid
      return run;
    });
    return { startAmt, bal, paid, end: run, done, left: r2(startAmt - done) };
  };
  const calcs = Object.fromEntries(items.map((it) => [it.id, calc(it)]));
  // the next unpaid row of each item: this is what Cash Position shows under Future payables
  const nextDue = (it) => (rows[it.id] || []).find((r) => !r.p && num(r.a) > 0 && (!it.start_date || (r.d || ymd(r.year, r.month, 1)) >= it.start_date));
  const sum = (k) => r2(items.reduce((t, it) => t + calcs[it.id][k], 0));
  const cur = items.find((it) => it.id === sel) || items[0];
  const cc = cur ? calcs[cur.id] : null;
  const curRows = cur ? rows[cur.id] || [] : [];
  const su = cur ? setup[cur.id] || {} : {};
  const shown = data.payables || [];
  const shownTotal = r2(shown.reduce((t, p) => t + p.amount, 0));
  const setSu = (patch) => setSetup((s) => ({ ...s, [cur.id]: { ...(s[cur.id] || {}), ...patch } }));
  const yearPaid = (y) => r2(curRows.reduce((t, r, k) => (r.year === y && cc.bal[k] !== null ? t + num(r.a) : t), 0));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>PDC Tracker</h1>
          <div className="subtitle">Add each future payable here. Click a card, type its balance and the date of that balance, then press + Add row for every PDC. Cash Position shows the next unpaid row of each one.</div>
        </div>
      </div>
      {err && <div className="flash flash-error" role="alert">{err}</div>}

      {items.length === 0 && (
        <div className="panel"><div className="pdc-foot"><span>No future payables yet. Press <b>+ Add future payable</b> below to start one.</span></div></div>
      )}

      {(
        <div className="pdc-cards">
          {items.length > 0 && (() => {
            const nexts = items.map((it) => nextDue(it)).filter(Boolean);
            const nextTotal = r2(nexts.reduce((t, n) => t + num(n.a), 0));
            return (
              <div className="pdc-card pdc-card-all">
                <span className="pdc-card-name">All future payables</span>
                <span className="pdc-card-lbl">Next payable · all items</span>
                <b className="pdc-card-bal">{peso(nextTotal)}</b>
                <span className="pdc-card-sub">{nexts.length} of {items.length} item{items.length === 1 ? '' : 's'} still to pay (the next one of each)</span>
                <span className="pdc-card-sub"><b>Total paid:</b> {peso(sum('done'))}</span>
                <span className="pdc-card-sub"><b>Balance left:</b> {sgn(sum('left'))} of {sgn(sum('startAmt'))}</span>
              </div>
            );
          })()}
          {items.map((it) => {
            const k = calcs[it.id];
            const share = k.startAmt > 0 ? Math.max(0, Math.min(100, (k.done / k.startAmt) * 100)) : 0;
            const n = nextDue(it);
            const on = cur && cur.id === it.id;
            return (
              <div role="button" tabIndex={0} key={it.id} className={`pdc-card pdc-card-pick ${on ? 'on' : ''}`} onClick={() => setSel(it.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(it.id); } }} aria-pressed={on}>
                <button type="button" className="pdc-card-edit" onClick={(e) => { e.stopPropagation(); openEdit(it); }} onKeyDown={(e) => e.stopPropagation()} title="Edit the name and the first amount" aria-label={`Edit ${it.label}`}>✎ Edit</button>
                <span className="pdc-card-name">{it.label}</span>
                <span className="pdc-card-lbl">Next payable</span>
                <b className="pdc-card-bal">{n ? peso(num(n.a)) : '—'}</b>
                <span className="pdc-card-sub">{n ? <><b>Due:</b> {n.d ? flong(n.d) : mon(n.year, n.month)}</> : 'Nothing left to pay'}</span>
                <span className="pdc-card-bar"><i style={{ width: `${share}%` }} /></span>
                <span className="pdc-card-sub"><b>Total paid:</b> {peso(k.done)} · {share.toFixed(0)}%</span>
                <span className="pdc-card-sub"><b>Balance left:</b> <span className={k.left < 0 ? 'pdc-neg' : ''}>{sgn(k.left)}</span> · first amount <b className="pdc-card-first" onClick={(e) => { e.stopPropagation(); openEdit(it); }} title="Click to change the first amount">{sgn(k.startAmt)}</b>{it.start_date ? ` (${flong(it.start_date)})` : ''}</span>
                <span className="pdc-card-open">{on ? 'Showing below ↓' : 'Click to open'}</span>
              </div>
            );
          })}
          <div className="pdc-card pdc-card-add">
            {!adding ? <button type="button" className="pdc-add-btn" onClick={() => setAdding(true)}>+ Add future payable</button> : (
              <>
                <span className="pdc-card-name">New future payable</span>
                <input className="pdc-in" placeholder="Name (for example Machine)" aria-label="Name of the future payable" value={newName} autoFocus onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }} />
                <MoneyInput className="pdc-in" placeholder="Balance 0.00" aria-label="Balance" value={newAmt} onChange={(v) => setNewAmt(v)} onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }} />
                <span><button type="button" className="btn btn-sm" onClick={addItem}>Add</button>{' '}<button type="button" className="btn btn-secondary btn-sm" onClick={() => { setAdding(false); setNewName(''); setNewAmt(''); }}>Cancel</button></span>
              </>
            )}
          </div>
        </div>
      )}

      {cur && (
        <div className="panel">
          <div className="pdc-list-head"><h2>{cur.label}</h2><span><button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(cur)}>✎ Edit name / first amount</button></span></div>
          <div className="pdc-setup">
            <label><span>Balance</span><MoneyInput className="pdc-in" placeholder={peso(cur.amount)} aria-label="Balance" value={su.amount || ''} onChange={(v) => setSu({ amount: v })} onBlur={() => commitSetup(cur)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} /></label>
            <label><span>as of</span><DateBox value={su.date || ''} ariaLabel="Balance as of" onCommit={(v) => { setSu({ date: v }); commitSetup(cur, { date: v }); }} /></label>
            {curRows.length === 0 && <label><span>First date</span><DateBox value={firstTxt} ariaLabel="First date" placeholder="September 25, 2026" pasteBox onPaste={onPasteRows} onCommit={(v) => setFirstTxt(v)} /></label>}
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => addRow(cur)}>+ Add row</button>
          </div>
          <p className="pdc-tip">{curRows.length ? 'Each new row is the next month on the same day, and it goes on into the next year.' : 'Type the first date (like September 25, 2026) and press + Add row. The next rows follow month by month.'} The next row that is not checked paid shows in Cash Position under Future payables; check it paid and the next month shows there. The balance is typed here (blank = the amount typed when the item was added). You can also copy rows from Excel and paste them into the table.</p>
          <div className="table-wrap" onPaste={onPasteRows}>
            <table className="data-table pdc-table">
              <thead>
                <tr>
                  <th>Date issued</th>
                  <th style={{ textAlign: 'center' }}>Paid?</th>
                  <th className="text-right">PDC amount (type here)</th>
                  <th className="text-right">Balance <span className="pdc-hint">hover an amount to see why</span></th>
                  <th />
                </tr>
              </thead>
              <tbody>
                <tr className="pdc-total">
                  <td>Beginning balance <small className="pdc-none">{cur.start_date ? `as of ${flong(cur.start_date)}` : cur.start_amount === null ? 'Future payables amount' : ''}</small></td>
                  <td />
                  <td />
                  <td className="text-right pdc-bal">
                    <span className="pdc-why" tabIndex={0} aria-label={`Why the beginning balance is ${sgn(cc.startAmt)}`}
                      onMouseEnter={(e) => openTip(cur.id, -1, e.currentTarget)} onMouseLeave={closeTip}
                      onFocus={(e) => openTip(cur.id, -1, e.currentTarget)} onBlur={closeTip}>{sgn(cc.startAmt)}</span>
                  </td>
                  <td />
                </tr>
                {curRows.map((r, idx) => (
                  <Fragment key={rkey(r.year, r.month)}>
                    {(idx === 0 || curRows[idx - 1].year !== r.year) && (
                      <tr key={`y${r.year}`} className="pdc-yearrow"><td colSpan={3}>{r.year}</td><td className="text-right">PDC {r.year}: {peso(yearPaid(r.year))}</td><td /></tr>
                    )}
                    <tr data-ym={rkey(r.year, r.month)} className={r.p ? 'pdc-paid' : ''}>
                      <td>
                        <DateBox value={r.d} ariaLabel={`Date issued ${cur.label} ${MONTHS[r.month - 1]} ${r.year}`} placeholder={`${MONTHS[r.month - 1]} ${r.year}`} onCommit={(v) => changeDate(cur, idx, v)} />
                      </td>
                      <td style={{ textAlign: 'center' }}><button type="button" className={`pdc-check ${r.p ? 'on' : ''}`} aria-pressed={!!r.p} aria-label={r.p ? 'Paid. Click to uncheck' : 'Mark as paid'} title={r.p ? 'Already paid (click to uncheck)' : 'Click when this is already paid'} onClick={() => togglePaid(cur, idx)}>{r.p ? '✓ Paid' : 'Mark paid'}</button></td>
                      <td className="text-right">
                        <MoneyInput className="pdc-in" aria-label={`PDC amount ${cur.label} ${MONTHS[r.month - 1]} ${r.year}`} placeholder="0.00" value={r.a}
                          onChange={(v) => patchRow(cur.id, idx, { a: v })}
                          onBlur={() => commit(cur, idx)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
                      </td>
                      <td className="text-right pdc-bal">
                        {cc.bal[idx] === null ? '—' : (
                          <span className="pdc-why" tabIndex={0} aria-label={`Why ${MONTHS[r.month - 1]} ${r.year} is ${sgn(cc.bal[idx])}`}
                            onMouseEnter={(e) => openTip(cur.id, idx, e.currentTarget)} onMouseLeave={closeTip}
                            onFocus={(e) => openTip(cur.id, idx, e.currentTarget)} onBlur={closeTip}>{sgn(cc.bal[idx])}{Math.abs(cc.bal[idx]) < 0.005 && num(r.a) > 0 ? ' · END' : ''}</span>
                        )}
                      </td>
                      <td className="text-right"><button type="button" className="at-x" onClick={() => removeRow(cur, idx)} aria-label="Remove row" title="Remove this row">×</button></td>
                    </tr>
                  </Fragment>
                ))}
                {curRows.length === 0 && <tr><td colSpan={5} className="pdc-none">No rows yet. Type the first date above and press + Add row.</td></tr>}
                <tr>
                  <td colSpan={5}><button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => addRow(cur)}>+ Add row</button>{curRows.length === 0 && <span className="pdc-none"> Type the first date above first.</span>}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td>Total PDC · balance left</td>
                  <td style={{ textAlign: 'center' }}><small className="pdc-none">{curRows.filter((r) => r.p).length} of {curRows.length} paid ✓</small></td>
                  <td className="text-right">{peso(cc.paid)}</td>
                  <td className="text-right">{sgn(cc.end)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="pdc-foot"><span>{busy ? 'Saving…' : saved || 'Amounts and dates save as soon as you leave the box.'}</span></div>
        </div>
      )}

      <div className="panel">
        <div className="pdc-list-head">
          <h2>Running payables · {year}</h2>
          <span>
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
              {shown.length === 0 && <tr><td colSpan={5} className="pdc-none">No unpaid running payables.</td></tr>}
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
        {due.none.count > 0 && <div className="pdc-foot"><span>{due.none.count} of these have no check date ({peso(due.none.total)}).</span></div>}</>}
      </div>
      {ask && (
        <div className="pdc-modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) setAsk(null); }} onKeyDown={(e) => { if (e.key === 'Escape') setAsk(null); }}>
          <div className="pdc-modal pdc-modal-sm" role="alertdialog" aria-modal="true" aria-label={ask.title}>
            <h3>{ask.title}</h3>
            <div className={ask.danger ? 'pdc-modal-del' : 'pdc-modal-info'}>
              {ask.lines.map((l, i) => (i === 0 ? <p key={i}><b>{l}</b></p> : <p key={i}>{l}</p>))}
            </div>
            <div className="pdc-modal-actions">
              <button type="button" className="btn btn-secondary" autoFocus={!ask.danger} onClick={() => setAsk(null)}>Cancel</button>
              <button type="button" className={ask.danger ? 'btn btn-danger' : 'btn'} autoFocus={ask.danger} onClick={() => { const run = ask.run; setAsk(null); run(); }}>{ask.ok}</button>
            </div>
          </div>
        </div>
      )}
      {edit && (
        <div className="pdc-modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) setEdit(null); }} onKeyDown={(e) => { if (e.key === 'Escape') setEdit(null); }}>
          <div className="pdc-modal" role="dialog" aria-modal="true" aria-label="Edit future payable">
            <h3>Edit future payable</h3>
            <p className="pdc-modal-sub">The first amount is the balance the PDC rows go down from.</p>
            <label className="pdc-modal-field"><span>Name</span>
              <input className="pdc-in" value={edit.name} autoFocus maxLength={120} onChange={(e) => setEdit((x) => ({ ...x, name: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); }} />
            </label>
            <label className="pdc-modal-field"><span>First amount (balance)</span>
              <MoneyInput className="pdc-in" placeholder="0.00" value={edit.amount} onChange={(v) => setEdit((x) => ({ ...x, amount: v }))} onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); }} />
            </label>
            <label className="pdc-modal-field"><span>As of (date of that amount)</span>
              <DateBox value={edit.date} ariaLabel="First amount as of" onCommit={(v) => setEdit((x) => ({ ...x, date: v }))} />
            </label>
            {edit.del ? (
              <div className="pdc-modal-del">
                <p>Remove <b>{edit.name}</b> and all its rows? It also leaves the Future payables in Cash Position. This cannot be undone.</p>
                <div className="pdc-modal-actions"><button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={removeItem}>Yes, remove it</button><button type="button" className="btn btn-secondary btn-sm" onClick={() => setEdit((x) => ({ ...x, del: false }))}>Back</button></div>
              </div>
            ) : (
              <div className="pdc-modal-actions">
                <button type="button" className="btn btn-danger btn-sm pdc-modal-left" onClick={() => setEdit((x) => ({ ...x, del: true }))}>Remove</button>
                <button type="button" className="btn btn-secondary" onClick={() => setEdit(null)}>Cancel</button>
                <button type="button" className="btn" disabled={busy} onClick={saveEdit}>{busy ? 'Saving…' : 'Save'}</button>
              </div>
            )}
          </div>
        </div>
      )}
      {tip && (() => {
        const it = items.find((x) => x.id === tip.id);
        if (!it) return null;
        const k = calcs[it.id]; const list = rows[it.id] || []; const idx = tip.idx;
        let before = k.startAmt; let prev = null;
        if (idx > 0) { for (let q = idx - 1; q >= 0; q--) { if (k.bal[q] !== null) { before = k.bal[q]; prev = list[q]; break; } } }
        const r = idx >= 0 ? list[idx] : null;
        return (
          <div className="pdc-pop" role="tooltip" style={{ left: tip.left, width: tip.w, top: tip.top, bottom: tip.bottom }}
            onMouseEnter={() => clearTimeout(tipTimer.current)} onMouseLeave={closeTip}>
            {!r ? (
              <>
                <div className="pdc-pop-head"><b>{it.label}</b><span>Beginning balance</span></div>
                <div className="pdc-pop-total"><span>{it.start_amount === null ? 'Future payables amount (Cash Position)' : `Balance typed${it.start_date ? ` as of ${flong(it.start_date)}` : ''}`}</span><b>{sgn(k.startAmt)}</b></div>
              </>
            ) : (
              <>
                <div className="pdc-pop-head"><b>{it.label} · {r.d ? flong(r.d) : mon(r.year, r.month)}</b><span>{prev ? `Balance after ${prev.d ? flong(prev.d) : mon(prev.year, prev.month)}` : 'Beginning balance'} less this row's PDC</span></div>
                <div className="pdc-pop-total"><span>{prev ? `Balance after ${prev.d ? flong(prev.d) : mon(prev.year, prev.month)}` : 'Beginning balance'}</span><b>{sgn(before)}</b></div>
                <div className="pdc-pop-total"><span>Less: PDC amount</span><b>− {peso(num(r.a))}</b></div>
                <div className="pdc-pop-total"><span>Balance</span><b>{sgn(k.bal[idx])}</b></div>
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}