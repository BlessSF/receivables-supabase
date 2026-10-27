import { useEffect, useRef, useState } from 'react';

/**
 * Name / company box for a payable: type to search the names saved under the account title,
 * click one to pick it, or just type any other name. Works with long lists.
 */
export default function TitleNameSelect({ category, value, onChange, titleNames, className = '', placeholder }) {
  const names = (titleNames && titleNames[category]) || [];
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [hi, setHi] = useState(0);
  const box = useRef(null);

  const text = value || '';
  const needle = text.trim().toLowerCase();
  const matches = names.filter((n) => n.toLowerCase().includes(needle)).slice(0, 50);
  const exact = names.some((n) => n.toLowerCase() === needle);

  function place() {
    const r = box.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left, top: r.bottom + 4, width: Math.max(r.width, 220) });
  }
  useEffect(() => {
    if (!open) return undefined;
    place();
    const h = () => place();
    window.addEventListener('scroll', h, true);
    window.addEventListener('resize', h);
    return () => { window.removeEventListener('scroll', h, true); window.removeEventListener('resize', h); };
  }, [open]);
  useEffect(() => { setHi(0); }, [text, category]);

  const pick = (n) => { onChange(n); setOpen(false); };
  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter' && open && matches[hi] && !exact) { e.preventDefault(); pick(matches[hi]); }
    else if (e.key === 'Escape') setOpen(false);
  }

  return (
    <div className="tn-box" ref={box}>
      <input
        className={className}
        value={text}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKey}
        placeholder={placeholder || (names.length ? 'Search or type a name' : 'Type a name')}
        autoComplete="off"
      />
      {open && pos && names.length > 0 && (
        <ul className="tn-list" style={{ left: pos.left, top: pos.top, width: pos.width }} role="listbox">
          {matches.map((n, i) => (
            <li key={n} role="option" aria-selected={n === text} className={(i === hi ? 'hi ' : '') + (n === text ? 'on' : '')} onMouseDown={(e) => { e.preventDefault(); pick(n); }} onMouseEnter={() => setHi(i)}>{n}</li>
          ))}
          {matches.length === 0 && <li className="tn-none">No saved name matches. “{text.trim()}” will be used as typed.</li>}
          {text && (
            <li className="tn-clear" onMouseDown={(e) => { e.preventDefault(); pick(''); }}>Clear</li>
          )}
        </ul>
      )}
    </div>
  );
}