// Turns text copied from Excel / Google Sheets (tab separated) into Payment Record rows.
// Columns can be in any order: dates, amounts and Paid/Unpaid are recognised by what they look like;
// the first leftover text becomes the Payee, the next one the Note.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

// Splits tab-separated text into rows of cells (handles Excel's "quoted" cells).
export function parseTsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  const s = String(text).replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const pad = (n) => String(n).padStart(2, '0');
function ymd(y, m, d) {
  if (y < 100) y += 2000;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

// 8/3/2026 (month first, like Excel), 2026-08-03, Aug 3, 2026, 3-Aug-2026, August 3 2026
export function toDate(str) {
  const t = String(str).trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    let a = +m[1]; let b = +m[2];
    if (a > 12 && b <= 12) [a, b] = [b, a]; // clearly day/month
    return ymd(+m[3], a, b);
  }
  m = t.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return ymd(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
  m = t.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})\.?,?[-\s](\d{2,4})$/);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return ymd(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
  return null;
}

// "33,436.50", "₱5,000", "P 1,200.5", "(500)" -> "33436.5"; null if it is not a plain money value
export function toAmount(str) {
  const t = String(str).trim().replace(/^(?:₱|PHP|Php|P|\$)\s*/, '');
  if (!/^\(?-?[\d,]*\.?\d+\)?$/.test(t) || !/\d/.test(t)) return null;
  const n = Number(t.replace(/[(),-]/g, ''));
  if (!isFinite(n) || n <= 0) return null;
  return n.toFixed(2);
}

function toStatus(str) {
  const t = String(str).trim().toLowerCase();
  if (!t) return null;
  if (/^(paid|released|settled|done|cleared)$/.test(t)) return 'Paid';
  if (/^(unpaid|not paid|pending|unreleased|open|for release|for payment)$/.test(t)) return 'Unpaid';
  return null;
}

const HEADER_WORDS = /^(date|date check|check date|check|name|payee|amount|remarks?|status|note|notes|particulars|description)$/i;

/**
 * @returns {{ rows: Array, skipped: number }}  rows: { check_date, payee, amount, status, note }
 */
export function parsePaste(text, fallbackDate = '') {
  const lines = parseTsv(text);
  const out = [];
  let skipped = 0;
  let lastDate = fallbackDate;
  for (const cells of lines) {
    const cs = cells.map((c) => c.replace(/\s+/g, ' ').trim());
    if (cs.every((c) => !c)) continue; // blank line
    let date = null; let amount = null; let status = null; const texts = [];
    for (const c of cs) {
      if (!c) continue;
      if (date === null && toDate(c)) { date = toDate(c); continue; }
      const st = toStatus(c);
      if (st && status === null) { status = st; continue; }
      const am = toAmount(c);
      if (amount === null && am !== null) { amount = am; continue; }
      texts.push(c);
    }
    const isHeader = texts.length > 0 && texts.every((t) => HEADER_WORDS.test(t));
    if (amount === null || isHeader || !texts.length || /^total\b/i.test(texts[0])) { skipped++; continue; } // title/header/total lines
    if (date) lastDate = date; // blank date cells reuse the date above, like in the sheet
    out.push({ check_date: date || lastDate, payee: texts[0], amount, status: status || 'Unpaid', note: texts.slice(1).join(' · ') });
  }
  return { rows: out, skipped };
}