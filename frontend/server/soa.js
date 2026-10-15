// Reads a "Statement of Account" Excel file (the Report4 layout) and pulls out
// the details Billing needs. It finds values by their LABEL ("Total Amount Due :",
// "Company Name :", "Series No. :" ...) rather than by fixed cell addresses, so the
// Total Amount Due can sit in a different place from one file to the next.
// The patient lines are found by their header row (No. / Tran. Date / ... / Amount).

import ExcelJS from 'exceljs';
import JSZip from 'jszip';

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** "PHP 34,200.00" / "9,350.00" / 9350 / "(1,200.00)" -> number (NaN when it isn't one). */
export function parseMoney(v) {
  if (v === null || v === undefined || v === '') return NaN;
  if (typeof v === 'number') return v;
  let s = clean(v).toUpperCase().replace(/PHP|₱|PESOS?/g, '').replace(/,/g, '').trim();
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-');
  s = s.replace(/[()\-\s]/g, '');
  if (s === '' || !/^\d*\.?\d+$/.test(s)) return NaN;
  const n = Number(s);
  return neg ? -n : n;
}

const pad = (n) => String(n).padStart(2, '0');

/** Excel date / "7/15/2026" / "2026-07-15" -> "YYYY-MM-DD" (null when it isn't a date). */
export function parseDateYmd(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  }
  if (typeof v === 'number') {
    // Excel serial date
    if (v < 20000 || v > 80000) return null;
    return parseDateYmd(new Date(Math.round((v - 25569) * 86400 * 1000)));
  }
  const s = clean(v);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/); // month/day/year, as printed on the SOA
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return valid(y, +m[1], +m[2]);
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : parseDateYmd(new Date(t - new Date(t).getTimezoneOffset() * 60000));
}
function valid(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** Plain text of an ExcelJS cell value (handles rich text, formulas, hyperlinks). */
function cellValue(cell) {
  let v = cell.value;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if (Array.isArray(v.richText)) v = v.richText.map((t) => t.text).join('');
    else if ('result' in v) v = v.result;
    else if ('text' in v) v = v.text;
    else v = null;
  }
  return v;
}

/** Every non-empty "real" cell (merged cells count once, with the rows/cols they span). */
function collectCells(ws) {
  const cells = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (cell.isMerged && cell.master && cell.master.address !== cell.address) return; // skip the hidden parts of a merge
      const value = cellValue(cell);
      if (value === null || value === undefined || clean(value) === '') return;
      let r2 = rowNumber;
      let c2 = colNumber;
      if (cell.isMerged) {
        const m = ws._merges && ws._merges[cell.address];
        const mm = m && m.model;
        if (mm) { r2 = mm.bottom; c2 = mm.right; }
      }
      cells.push({ r1: rowNumber, c1: colNumber, r2, c2, value, text: clean(value) });
    });
  });
  return cells;
}

/** The value that belongs to a label: nearest cell to its right on the same row(s), else the cell under it. */
function valueFor(cells, labelRe, { notRe } = {}) {
  const label = cells.find((c) => typeof c.value !== 'number' && labelRe.test(c.text) && !(notRe && notRe.test(c.text)));
  if (!label) return null;
  const sameRow = cells
    .filter((c) => c !== label && c.c1 > label.c2 && c.r1 <= label.r2 && c.r2 >= label.r1)
    .sort((a, b) => a.c1 - b.c1)[0];
  if (sameRow) return sameRow;
  return cells
    .filter((c) => c !== label && c.r1 > label.r2 && c.c1 <= label.c2 && c.c2 >= label.c1)
    .sort((a, b) => a.r1 - b.r1)[0] || null;
}


// ---------------------------------------------------------------------------
// Fallback reader. ExcelJS refuses some files (e.g. ones with unusual drawings),
// so if it fails we read the sheet XML straight out of the .xlsx zip instead.
const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
const colNum = (letters) => letters.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const textOf = (xml) => [...xml.replace(/<rPh[\s\S]*?<\/rPh>/g, '').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1])).join('');

async function cellsFromRawXlsx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/(\d+)\.xml/)[1], 10) - parseInt(b.match(/(\d+)\.xml/)[1], 10));
  if (!names.length) throw new Error('no worksheet');
  const sharedFile = zip.file('xl/sharedStrings.xml');
  const shared = sharedFile ? [...(await sharedFile.async('string')).matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1])) : [];
  const xml = await zip.file(names[0]).async('string');

  const merges = {};
  for (const m of xml.matchAll(/<mergeCell\s+ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/g)) {
    merges[`${m[1]}${m[2]}`] = { r2: +m[4], c2: colNum(m[3]) };
  }
  const cells = [];
  for (const m of xml.matchAll(/<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = m[1];
    const body = m[2];
    if (!body) continue;
    const ref = (attrs.match(/\br="([A-Z]+)(\d+)"/) || []);
    if (!ref[1]) continue;
    const type = (attrs.match(/\bt="(\w+)"/) || [])[1];
    const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
    let value;
    if (type === 's') value = shared[+v];
    else if (type === 'inlineStr') value = textOf(body);
    else if (type === 'str') value = v === undefined ? undefined : unxml(v);
    else if (type === 'b' || type === 'e') continue;
    else value = v === undefined ? undefined : Number(v);
    if (value === undefined || value === null || clean(value) === '' || (typeof value === 'number' && Number.isNaN(value))) continue;
    const r1 = +ref[2];
    const c1 = colNum(ref[1]);
    const mg = merges[`${ref[1]}${ref[2]}`];
    cells.push({ r1, c1, r2: mg ? mg.r2 : r1, c2: mg ? mg.c2 : c1, value, text: clean(value) });
  }
  return cells;
}

/** Cells of the first sheet: ExcelJS first, raw XML if ExcelJS can't open the file. */
async function loadCells(buffer) {
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets.find((sheet) => sheet.actualRowCount > 0);
    if (ws) {
      const cells = collectCells(ws);
      if (cells.length) return cells;
    }
  } catch { /* fall through to the raw reader */ }
  return cellsFromRawXlsx(buffer);
}

const HEADERS = [
  ['date', /^tran/i],
  ['last', /^last/i],
  ['first', /^first/i],
  ['middle', /^middle/i],
  ['birth', /^birth/i],
  ['amount', /^amount$/i],
  ['type', /^type$/i],
];

function readTable(cells) {
  // Header row = a row holding both a "Tran. Date" and an "Amount" heading.
  const rows = [...new Set(cells.map((c) => c.r1))].sort((a, b) => a - b);
  let headerRow = null;
  for (const r of rows) {
    const t = cells.filter((c) => c.r1 === r).map((c) => c.text);
    if (t.some((x) => /^tran/i.test(x)) && t.some((x) => /^amount$/i.test(x))) { headerRow = r; break; }
  }
  if (!headerRow) return { rows: [], found: false };

  const cols = {};
  cells.filter((c) => c.r1 === headerRow).forEach((c) => {
    const hit = HEADERS.find(([, re]) => re.test(c.text));
    if (hit && !cols[hit[0]]) cols[hit[0]] = c;
  });
  if (!cols.date || !cols.amount) return { rows: [], found: false };
  const inCol = (r, col) => cells.find((c) => c.r1 <= r && c.r2 >= r && c.c1 <= col.c2 && c.c2 >= col.c1);

  const out = [];
  let blanks = 0;
  const lastRow = Math.max(...cells.map((c) => c.r2));
  for (let r = headerRow + 1; r <= lastRow; r++) {
    const d = inCol(r, cols.date);
    const a = inCol(r, cols.amount);
    const date = d ? parseDateYmd(d.value) : null;
    const amount = a ? parseMoney(a.value) : NaN;
    if (!date || Number.isNaN(amount)) {
      // A gap of two empty/odd rows ends the table (the "CURRENT AMOUNT DUE" line follows it).
      if (++blanks >= 2 || (a && Number.isNaN(amount) && /[a-z]/i.test(a.text))) break;
      continue;
    }
    blanks = 0;
    const t = (k) => (cols[k] && inCol(r, cols[k]) ? inCol(r, cols[k]).text : '');
    out.push({
      date,
      last_name: t('last'),
      first_name: t('first'),
      middle_name: t('middle'),
      birth_date: cols.birth && inCol(r, cols.birth) ? parseDateYmd(inCol(r, cols.birth).value) : null,
      amount,
      type: t('type'),
    });
  }
  return { rows: out, found: true };
}

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Parse one SOA workbook buffer. Never throws on a odd layout: it returns what it found plus warnings. */
export async function parseSoa(buffer, fileName = '') {
  let cells;
  try {
    cells = await loadCells(buffer);
  } catch {
    return { file: fileName, error: 'This does not look like a valid .xlsx file.' };
  }
  if (!cells.length) return { file: fileName, error: 'The workbook is empty.' };
  const warnings = [];
  const text = (re, opts) => {
    const c = valueFor(cells, re, opts);
    return c ? c.text : '';
  };

  const soaNumber = (text(/^series\s*no\.?\s*:?$/i) || text(/^soa\s*(no\.?|number|#)\s*:?$/i)).toUpperCase();
  const company = text(/^company\s*name\s*:?$/i) || text(/^company\s*\/\s*hmo\s*:?$/i) || text(/^hmo\s*:?$/i);
  const dateCell = valueFor(cells, /^date\s*:?$/i);
  const date = dateCell ? parseDateYmd(dateCell.value) : null;
  const terms = text(/^terms\s*:?$/i);

  const money = (re) => {
    const c = valueFor(cells, re);
    const n = c ? parseMoney(c.value) : NaN;
    return Number.isNaN(n) ? null : n;
  };
  const totalDue = money(/^total\s*amount\s*due\s*:?$/i);
  const currentDue = money(/^current\s*amount\s*due\s*:?$/i) ?? money(/^amount\s*due\s*:?$/i);
  const previousBalance = money(/^previous\s*balance\s*:?$/i);
  const discountText = text(/^discount\s*:?$/i);

  const table = readTable(cells);
  const rowTotal = r2(table.rows.reduce((t, r) => t + r.amount, 0));
  const dates = table.rows.map((r) => r.date).sort();

  if (!soaNumber) warnings.push('No Series No. / SOA No. found.');
  if (!company) warnings.push('No Company Name found.');
  if (!date) warnings.push('No valid Date found.');
  if (totalDue === null) warnings.push('No Total Amount Due found.');
  if (!table.found) warnings.push('Could not find the patient table.');
  else if (table.rows.length === 0) warnings.push('The patient table has no rows.');
  if (currentDue !== null && table.rows.length && Math.abs(currentDue - rowTotal) > 0.005) {
    warnings.push(`The patient lines add up to ${rowTotal.toFixed(2)} but Current Amount Due says ${currentDue.toFixed(2)}.`);
  }
  if (totalDue !== null && currentDue !== null && previousBalance !== null) {
    const disc = parseFloat(discountText) || 0;
    const expected = r2(previousBalance + currentDue * (1 - disc / 100));
    if (Math.abs(expected - totalDue) > 0.5) warnings.push(`Previous balance + current amount due (${expected.toFixed(2)}) does not match Total Amount Due (${totalDue.toFixed(2)}).`);
  }

  return {
    file: fileName,
    soa_number: soaNumber,
    company_name: company,
    date,
    terms,
    total_due: totalDue,
    current_due: currentDue ?? (table.rows.length ? rowTotal : null),
    previous_balance: previousBalance,
    discount: discountText,
    line_count: table.rows.length,
    lines_total: rowTotal,
    period_from: dates[0] || null,
    period_to: dates[dates.length - 1] || null,
    warnings,
  };
}

const norm = (s) => clean(s).toUpperCase().replace(/&/g, ' AND ').replace(/\b(INC|INCORPORATED|CORP|CORPORATION|CO|LTD|PHILIPPINES|PHIL)\b\.?/g, ' ').replace(/[^A-Z0-9]+/g, '');

/** Match the company name on the SOA to one of the HMO accounts. exact > only close match. */
export function matchHmo(name, hmos) {
  const n = norm(name);
  if (!n) return { hmo: null, how: 'none' };
  const exact = hmos.filter((h) => norm(h.name) === n || (h.code && norm(h.code) === n));
  if (exact.length === 1) return { hmo: exact[0], how: 'exact' };
  const close = hmos.filter((h) => {
    const m = norm(h.name);
    return m.length >= 3 && n.length >= 3 && (m.includes(n) || n.includes(m));
  });
  if (close.length === 1) return { hmo: close[0], how: 'close' };
  return { hmo: null, how: close.length > 1 || exact.length > 1 ? 'ambiguous' : 'none' };
}