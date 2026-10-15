import { useEffect, useRef, useState } from 'react';
import { formatLongDate, parseLooseDate } from './utils';

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="16.5" rx="2" /><path d="M3 10h18M8 2.5v4M16 2.5v4" />
    </svg>
  );
}

/**
 * A date field for forms that shows the date as "October 15, 2026" (month name, not mm/dd/yyyy).
 * Type a date (October 15, 2026 / 10/15/2026 / 2026-10-15) or click the calendar icon to pick one.
 * `value` and `onChange` use "YYYY-MM-DD" (or "" when empty), same as a normal date input.
 */
export default function LongDateInput({ value, onChange, min, ariaLabel, placeholder = 'Select date', style }) {
  const [text, setText] = useState(formatLongDate(value));
  const pickerRef = useRef(null);
  useEffect(() => setText(formatLongDate(value)), [value]);

  function commit() {
    const t = text.trim();
    const shown = formatLongDate(value);
    if (t === shown) { if (text !== shown) setText(shown); return; }
    if (t === '') { setText(''); onChange(''); return; }
    const iso = parseLooseDate(t);
    if (!iso) {
      alert('Please type a date like October 15, 2026, or click the calendar icon to pick one.');
      setText(shown);
      return;
    }
    setText(formatLongDate(iso));
    if (iso !== value) onChange(iso);
  }

  function openCalendar() {
    const el = pickerRef.current;
    if (!el) return;
    try { el.showPicker(); } catch { el.focus(); el.click(); }
  }

  const pickerValue = /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : '';

  return (
    <div className="long-date" style={style}>
      <input
        type="text"
        value={text}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); openCalendar(); }
        }}
      />
      <button type="button" className="long-date-btn" tabIndex={-1} title="Open calendar" aria-label="Open calendar" onClick={openCalendar}>
        <CalendarIcon />
      </button>
      <input
        ref={pickerRef}
        type="date"
        className="long-date-native"
        tabIndex={-1}
        aria-hidden="true"
        min={min || undefined}
        value={pickerValue}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}