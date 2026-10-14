import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MONTHS, formatLongDate, parseLooseDate, periodParts, periodValue, defaultPeriodYear, coveredLabel } from './utils';

// Cells for the Ledger grid, plus the keyboard helpers every cell shares.
export const GRID_ID = 'ledger-grid';

export function focusCell(row, col) {
  const cell = `#${GRID_ID} [data-r="${row}"][data-c="${col}"]`;
  // the native <input type="date"> inside a DateCell is only there for the calendar popup
  const el = document.querySelector(`${cell} input:not([type="date"]), ${cell} select`);
  if (el) {
    el.focus();
    if (el.select) el.select();
  }
}

/** Spreadsheet-style keys: Enter / arrows move between cells. */
export function gridKeyDown(e, row, col, isText) {
  const { key, target } = e;
  if (key === 'Enter') { e.preventDefault(); target.blur(); focusCell(row + 1, col); return; }
  if (key === 'ArrowDown') { e.preventDefault(); focusCell(row + 1, col); return; }
  if (key === 'ArrowUp') { e.preventDefault(); focusCell(row - 1, col); return; }
  if (key === 'ArrowRight' || key === 'ArrowLeft') {
    // Only jump cells when the cursor is already at that edge of the text,
    // so normal left/right editing inside the field still works.
    let atEdge = true;
    try {
      if (isText) {
        atEdge = key === 'ArrowRight'
          ? target.selectionStart === target.value.length
          : target.selectionStart === 0;
      }
    } catch { /* selection API unsupported on this input type — treat as edge */ }
    if (atEdge) { focusCell(row, key === 'ArrowRight' ? col + 1 : col - 1); }
  }
}

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="16.5" rx="2" /><path d="M3 10h18M8 2.5v4M16 2.5v4" />
    </svg>
  );
}

/**
 * A date shown as "January 16, 2026". You can type a date (January 16, 2026 /
 * 1/16/2026 / 2026-01-16) or click the calendar icon to pick one. Stored as YYYY-MM-DD.
 * Old free-text values (e.g. "JULY 16-31, 2026") are shown as they are and left
 * untouched until you type a real date over them.
 */
export function DateCell({ value, onSave, row, col }) {
  const shown = formatLongDate(value);
  const [text, setText] = useState(shown);
  const [state, setState] = useState(''); // '', 'saving', 'saved', 'error'
  const pickerRef = useRef(null);
  useEffect(() => setText(formatLongDate(value)), [value]);

  const pickerValue = /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : '';

  async function save(next) {
    setState('saving');
    try {
      await onSave(next);
      setState('saved');
      setTimeout(() => setState(''), 700);
    } catch (e) {
      setState('error');
      alert(e.message);
      setText(shown);
    }
  }

  function commitText() {
    const t = text.trim();
    if (t === shown) { if (text !== shown) setText(shown); return; } // nothing changed
    if (t === '') { setText(''); if (value) save(''); return; }       // cleared
    const iso = parseLooseDate(t);
    if (!iso) {
      alert('Please type a date like January 16, 2026, or click the calendar icon to pick one.');
      setText(shown);
      return;
    }
    if (iso === value) { setText(formatLongDate(iso)); return; }
    save(iso);
  }

  function openCalendar() {
    const el = pickerRef.current;
    if (!el) return;
    try { el.showPicker(); } catch { el.focus(); el.click(); }
  }

  function onKeyDown(e) {
    if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); openCalendar(); return; }
    gridKeyDown(e, row, col, true);
  }

  return (
    <div className={`editable-cell date-cell ${state}`} data-r={row} data-c={col}>
      <input
        type="text"
        value={text}
        placeholder="Select date"
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={onKeyDown}
      />
      <button type="button" className="date-btn" tabIndex={-1} title="Open calendar" aria-label="Open calendar" onClick={openCalendar}>
        <CalendarIcon />
      </button>
      <input
        ref={pickerRef}
        type="date"
        className="date-native"
        tabIndex={-1}
        aria-hidden="true"
        value={pickerValue}
        onChange={(e) => {
          const v = e.target.value; // "" when the calendar's Clear button is used
          if (v && v !== value) save(v);
          else if (!v && value) save('');
        }}
      />
    </div>
  );
}

/**
 * Period Date: the month a bill covers. Pick a month (January – December) and a year.
 * Saved as the 1st of that month ("2026-06-01").
 */
export function PeriodCell({ value, billingDate, years, onSave, row, col }) {
  const parts = periodParts(value);
  const [state, setState] = useState('');

  async function save(next) {
    setState('saving');
    try {
      await onSave(next);
      setState('saved');
      setTimeout(() => setState(''), 700);
    } catch (e) {
      setState('error');
      alert(e.message);
    }
  }

  function onMonth(e) {
    const m = Number(e.target.value);
    if (!m) { if (value) save(''); return; }
    const y = parts ? parts.y : defaultPeriodYear(m, billingDate);
    save(periodValue(y, m));
  }

  function onYear(e) {
    if (parts) save(periodValue(Number(e.target.value), parts.m));
  }

  // Left/right move between cells (up/down change the month, like any dropdown).
  function onKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); focusCell(row + 1, col); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); focusCell(row, col - 1); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); focusCell(row, col + 1); }
  }

  const yearList = parts && !years.includes(parts.y) ? [...years, parts.y].sort((a, b) => a - b) : years;

  return (
    <div className={`editable-cell period-cell ${state}`} data-r={row} data-c={col}>
      <select
        className={parts ? '' : 'is-empty'}
        value={parts ? parts.m : ''}
        onChange={onMonth}
        onKeyDown={onKeyDown}
        aria-label="Period month"
      >
        <option value="">—</option>
        {MONTHS.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
      </select>
      {parts && (
        <select className="period-year" value={parts.y} onChange={onYear} onKeyDown={onKeyDown} aria-label="Period year">
          {yearList.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      )}
    </div>
  );
}

/**
 * Remarks: in the grid it is one tidy line (the full text shows as a tooltip on hover).
 * Click it and the text opens in a roomier box that wraps and grows, floating over the
 * table -- so long notes can be read and edited in full without widening the column or
 * pushing anything around. Enter saves (and moves down), Shift+Enter adds a new line,
 * Esc cancels, clicking away saves.
 */
export function RemarksCell({ value, onSave, row, col }) {
  const [val, setVal] = useState(value ?? '');
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(''); // '', 'saving', 'saved', 'error'
  const [box, setBox] = useState(null);
  const inputRef = useRef(null);
  const areaRef = useRef(null);
  const cancelRef = useRef(false);
  useEffect(() => { if (!open) setVal(value ?? ''); }, [value, open]);

  function place() {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const width = Math.min(Math.max(r.width, 380), vw - 16);
    let left = r.right - width;           // grow to the left: Remarks sits at the right edge of the grid
    if (left + width > vw - 8) left = vw - 8 - width;
    if (left < 8) left = 8;
    setBox({ top: r.top, left, width });
  }

  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    const again = () => place();
    window.addEventListener('resize', again);
    window.addEventListener('scroll', again, true);
    return () => {
      window.removeEventListener('resize', again);
      window.removeEventListener('scroll', again, true);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // focus on open, and grow the box to fit the text (scrolls inside after ~12 lines)
  useLayoutEffect(() => {
    const ta = areaRef.current;
    if (!open || !box || !ta) return;
    ta.style.height = 'auto';
    const h = Math.min(ta.scrollHeight + 2, 260);
    ta.style.height = `${h}px`;
    const vh = window.innerHeight;
    ta.style.top = `${Math.max(8, Math.min(box.top, vh - h - 8))}px`;
    if (document.activeElement !== ta) {
      ta.focus();
      const end = ta.value.length;
      ta.setSelectionRange(end, end);
    }
  }, [open, box, val]);

  async function commit() {
    const next = val;
    setOpen(false);
    setBox(null);
    if (cancelRef.current) { cancelRef.current = false; setVal(value ?? ''); return; }
    if ((next || '') === (value ?? '')) return;
    setState('saving');
    try {
      await onSave(next);
      setState('saved');
      setTimeout(() => setState(''), 700);
    } catch (e) {
      setState('error');
      alert(e.message);
      setVal(value ?? '');
    }
  }

  function onKeyDown(e) {
    const t = e.target;
    const atStart = t.selectionStart === 0 && t.selectionEnd === 0;
    const atEnd = t.selectionStart === t.value.length && t.selectionEnd === t.value.length;
    if (e.key === 'Escape') { e.preventDefault(); cancelRef.current = true; t.blur(); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); t.blur(); focusCell(row + 1, col); return; }
    if (e.key === 'ArrowUp' && atStart) { e.preventDefault(); t.blur(); focusCell(row - 1, col); return; }
    if (e.key === 'ArrowDown' && atEnd) { e.preventDefault(); t.blur(); focusCell(row + 1, col); return; }
    if (e.key === 'ArrowLeft' && atStart) { e.preventDefault(); t.blur(); focusCell(row, col - 1); }
  }

  return (
    <div className={`editable-cell remarks-cell ${state}`} data-r={row} data-c={col}>
      <input
        ref={inputRef}
        readOnly
        value={(val || '').replace(/\s*\n\s*/g, ' ')}
        title={val || undefined}
        onFocus={() => setOpen(true)}
      />
      {open && createPortal(
        <textarea
          ref={areaRef}
          className="remarks-pop"
          value={val}
          rows={1}
          style={box ? { left: box.left, top: box.top, width: box.width } : { left: 0, top: 0, visibility: 'hidden' }}
          onChange={(e) => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />,
        document.body
      )}
    </div>
  );
}


/**
 * Covered Period: shows "Sept 18 to Sept 30". Click it to pick the From and To dates in a small
 * popup that floats over the table (so the grid layout never changes).
 */
export function CoveredCell({ from, to, periodDate, onSave, row, col }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(from || '');
  const [t, setT] = useState(to || '');
  const [state, setState] = useState('');
  const [pos, setPos] = useState(null);
  const inputRef = useRef(null);
  const popRef = useRef(null);
  const skipFocus = useRef(false);
  const label = coveredLabel(from, to, periodDate);

  useEffect(() => { if (!open) { setF(from || ''); setT(to || ''); } }, [from, to, open]);

  function openPop() {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = 290;
    let left = r.left;
    if (left + width > window.innerWidth - 8) left = window.innerWidth - 8 - width;
    if (left < 8) left = 8;
    let top = r.bottom + 4;
    if (top + 190 > window.innerHeight) top = Math.max(8, r.top - 194);
    setPos({ left, top, width });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (popRef.current && popRef.current.contains(e.target)) return;
      if (inputRef.current && inputRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  async function save(next) {
    setOpen(false);
    skipFocus.current = true;
    if (inputRef.current) inputRef.current.focus();
    setState('saving');
    try {
      await onSave(next);
      setState('saved');
      setTimeout(() => setState(''), 700);
    } catch (e) {
      setState('error');
      alert(e.message);
    }
  }

  function apply() {
    if (!f || !t) { alert('Pick both the From and To dates.'); return; }
    if (f > t) { alert('The "to" date cannot be before the "from" date.'); return; }
    save(`${f}|${t}`);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); if (!open) openPop(); return; }
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(false); focusCell(row + 1, col); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setOpen(false); focusCell(row - 1, col); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); setOpen(false); focusCell(row, col - 1); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); setOpen(false); focusCell(row, col + 1); }
  }

  return (
    <div className={`editable-cell covered-cell ${state}`} data-r={row} data-c={col}>
      <input
        ref={inputRef}
        readOnly
        placeholder="—"
        value={label}
        title={from && to ? `${from} to ${to}` : undefined}
        onFocus={() => { if (skipFocus.current) { skipFocus.current = false; return; } openPop(); }}
        onClick={() => { if (!open) openPop(); }}
        onKeyDown={onKeyDown}
      />
      {open && pos && createPortal(
        <div ref={popRef} className="covered-pop" style={{ left: pos.left, top: pos.top, width: pos.width }}
          onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); if (inputRef.current) { skipFocus.current = true; inputRef.current.focus(); } } if (e.key === 'Enter') { e.preventDefault(); apply(); } }}>
          <label>From<input type="date" value={f} onChange={(e) => setF(e.target.value)} autoFocus /></label>
          <label>To<input type="date" value={t} min={f || undefined} onChange={(e) => setT(e.target.value)} /></label>
          <div className="covered-actions">
            <button type="button" className="btn btn-sm" onClick={apply}>Save</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(false)}>Cancel</button>
            {(from || to || periodDate) && <button type="button" className="btn btn-secondary btn-sm" onClick={() => save('')}>Clear</button>}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}