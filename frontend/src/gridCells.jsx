import { useEffect, useRef, useState } from 'react';
import { MONTHS, formatLongDate, parseLooseDate, periodParts, periodValue, defaultPeriodYear } from './utils';

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