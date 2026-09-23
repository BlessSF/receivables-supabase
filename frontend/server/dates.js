// Date handling that matches the PHP backend (timezone Asia/Manila).
//
// Dates in this database are stored as free text (VARCHAR) -- mostly
// "YYYY-MM-DD", but a few rows hold things like "7/15/2025" or
// "January 2026". PHP read them with strtotime(); parseDate() below
// understands the same formats strtotime() accepted for your data and
// returns null for anything it couldn't read (e.g. "JULY 1-15, 2026").
//
// All values are "naive" day numbers: milliseconds as if the date were
// UTC, so no timezone shifting can creep in. "Today" is taken in Manila.

const TZ = 'Asia/Manila';
const DAY = 86400000;

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11,
};

function utc(y, m, d, hh = 0, mm = 0, ss = 0) {
  const dt = new Date(0);
  dt.setUTCFullYear(y, m, d); // setUTCFullYear keeps years < 100 as-is
  dt.setUTCHours(hh, mm, ss, 0);
  return dt.getTime();
}

/** strtotime() equivalent for the formats used in this app. Returns ms or null. */
export function parseDate(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (s === '') return null;
  let m;

  // 2026-09-23, 2026-09-23 10:15:00, 2026-09-23T10:15
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/))) {
    return utc(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }
  // 9/23/2026 or 9/23/26 (American month/day/year, like strtotime)
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})$/))) {
    let y = +m[3];
    if (m[3].length === 2) y += y < 70 ? 2000 : 1900;
    return utc(y, +m[1] - 1, +m[2]);
  }
  // "January 2026", "Jan 2026", "July 0224"
  if ((m = s.match(/^([A-Za-z]+)\.?\s+(\d{4})$/)) && MONTHS[m[1].toLowerCase()] !== undefined) {
    return utc(+m[2], MONTHS[m[1].toLowerCase()], 1);
  }
  // "January 5, 2026", "Jan 5 2026"
  if ((m = s.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/)) && MONTHS[m[1].toLowerCase()] !== undefined) {
    return utc(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  }
  // "5 January 2026"
  if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\.?,?\s+(\d{4})$/)) && MONTHS[m[2].toLowerCase()] !== undefined) {
    return utc(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  }
  return null;
}

/** Today's date in Manila as naive ms at midnight. */
export function todayMs() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date()); // "2026-09-23"
  const [y, mo, d] = parts.split('-').map(Number);
  return utc(y, mo - 1, d);
}

/** "YYYY-MM-DD" for today in Manila (PHP date('Y-m-d')). */
export function todayYmd() {
  return ymd(todayMs());
}

export function ymd(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${y < 0 ? '-' : ''}${pad(Math.abs(y), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Days between a date and today. Positive = overdue. null if unreadable. */
export function daysOverdue(dueDate) {
  if (!dueDate) return null;
  const due = parseDate(dueDate);
  if (due === null) return null;
  const diff = (todayMs() - due) / DAY;
  return Math.sign(diff) * Math.round(Math.abs(diff));
}

/** billing date + grace days, as YYYY-MM-DD (null if unreadable). */
export function addDaysYmd(dateStr, days) {
  const ms = parseDate(dateStr);
  if (ms === null) return null;
  const d = new Date(ms);
  d.setUTCDate(d.getUTCDate() + days);
  return ymd(d.getTime());
}

/** Excel serial date number (days since 1899-12-30) or null. */
export function excelSerial(dateStr) {
  const ms = parseDate(dateStr);
  if (ms === null) return null;
  const epoch = utc(1899, 11, 30);
  return Math.round((ms - epoch) / DAY);
}
