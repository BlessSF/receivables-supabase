import { useLayoutEffect, useRef } from 'react';

// Formats a typed amount with thousands commas: "1234567.5" -> "1,234,567.5" (max 2 decimals).
export function fmtNum(raw) {
  const s = String(raw ?? '').replace(/[^0-9.]/g, '');
  const i = s.indexOf('.');
  let int = i < 0 ? s : s.slice(0, i);
  const dec = i < 0 ? null : s.slice(i + 1).replace(/\./g, '').slice(0, 2);
  int = int.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dec === null ? int : `${int}.${dec}`;
}

// "1,234.50" -> "1234.50" (what gets saved / sent to the server)
export const rawNum = (v) => fmtNum(v).replace(/,/g, '');

/**
 * A text box for money amounts that puts the commas in as you type.
 * `value` is the plain number text ("1234567.50"); `onChange` receives the plain text too.
 */
export default function MoneyInput({ value, onChange, ...rest }) {
  const ref = useRef(null);
  const caret = useRef(null); // how many digits/dots sit left of the cursor
  const shown = fmtNum(value);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || caret.current === null || document.activeElement !== el) return;
    let pos = 0;
    let seen = 0;
    while (pos < shown.length && seen < caret.current) {
      if (/[0-9.]/.test(shown[pos])) seen++;
      pos++;
    }
    el.setSelectionRange(pos, pos);
    caret.current = null;
  });

  return (
    <input
      {...rest}
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={shown}
      onChange={(e) => {
        const el = e.target;
        caret.current = (el.value.slice(0, el.selectionStart ?? el.value.length).match(/[0-9.]/g) || []).length;
        onChange(rawNum(el.value));
      }}
    />
  );
}