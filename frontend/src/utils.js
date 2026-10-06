export function money(n) {
  const v = Number(n) || 0;
  const formatted = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${formatted})` : formatted;
}

export function peso(n) {
  return `\u20b1${money(n)}`;
}

export function fdate(d, opts) {
  if (!d) return '—';
  const dt = new Date(d.includes('T') || d.includes(' ') ? d.replace(' ', 'T') : d + 'T00:00:00');
  if (isNaN(dt.getTime())) return d; // not a real date (e.g. free-text billing period) — show as-is
  return dt.toLocaleDateString('en-US', opts || { month: 'short', day: '2-digit', year: 'numeric' });
}

export const AGING_BADGE = {
  'Not Yet Due': 'badge-secondary',
  '0-30 days': 'badge-success',
  '31-60 days': 'badge-warning',
  '61-90 days': 'badge-orange',
  'Over 90 days': 'badge-danger',
  'Paid': 'badge-success',
  'N/A': 'badge-secondary',
};

export function timeAgo(dateStr) {
  if (!dateStr) return '';
  const iso = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T');
  const then = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso);
  if (isNaN(then.getTime())) return '';
  const diffMs = Date.now() - then.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Muted styling for zero amounts so real figures stand out in long tables.
export function numClass(n, extra = '') {
  const v = Number(n) || 0;
  return ['num', v === 0 ? 'zero' : '', v < 0 ? 'neg' : '', extra].filter(Boolean).join(' ');
}
/** Owner / accounting accounts: read-only reports (dashboard, summary, aging, past due). */
export function isExecutive(user) {
  return user?.role === 'executive';
}

// ---------------------------------------------------------------- long dates & periods
// Dates are stored as "YYYY-MM-DD" text. In the Ledger they are shown (and can be
// typed) as "January 16, 2026". A Period Date is the 1st of a month: "2026-06-01" = June 2026.

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const MONTH_LOOKUP = {};
MONTHS.forEach((name, i) => {
  MONTH_LOOKUP[name.toLowerCase()] = i + 1;
  MONTH_LOOKUP[name.slice(0, 3).toLowerCase()] = i + 1;
});
MONTH_LOOKUP.sept = 9;

const pad2 = (n) => String(n).padStart(2, '0');

function validYmd(y, m, d) {
  if (!(y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Reads what a person types ("January 16, 2026", "1/16/2026", "2026-01-16", "16 Jan 2026") -> "2026-01-16", or null. */
export function parseLooseDate(input) {
  const s = String(input ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return null;
  let m;
  let y; let mo; let d;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    y = +m[1]; mo = +m[2]; d = +m[3];
  } else if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) {
    mo = +m[1]; d = +m[2]; y = +m[3]; // month first, like the rest of the app
  } else if ((m = s.match(/^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})$/)) && MONTH_LOOKUP[m[1].toLowerCase()]) {
    mo = MONTH_LOOKUP[m[1].toLowerCase()]; d = +m[2]; y = +m[3];
  } else if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?,?\s+(\d{4})$/)) && MONTH_LOOKUP[m[2].toLowerCase()]) {
    d = +m[1]; mo = MONTH_LOOKUP[m[2].toLowerCase()]; y = +m[3];
  } else {
    return null;
  }
  return validYmd(y, mo, d) ? `${y}-${pad2(mo)}-${pad2(d)}` : null;
}

/** "2026-01-16" -> "January 16, 2026". Text that isn't a real date (old free-text entries) is returned as it is. */
export function formatLongDate(value) {
  if (value === null || value === undefined || value === '') return '';
  const iso = parseLooseDate(value);
  if (!iso) return String(value);
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** Period Date "2026-06-01" -> { y: 2026, m: 6 } (null if empty / unreadable). */
export function periodParts(value) {
  const m = String(value ?? '').match(/^(\d{4})-(\d{2})/);
  if (!m || +m[2] < 1 || +m[2] > 12) return null;
  return { y: +m[1], m: +m[2] };
}

export function periodLabel(value) {
  const p = periodParts(value);
  return p ? `${MONTHS[p.m - 1]} ${p.y}` : '';
}

export function periodValue(y, m) {
  return `${y}-${pad2(m)}-01`;
}

/**
 * Year to suggest when someone picks only a month for the Period Date.
 * A bill covers a month that has already started, so it is the latest such month
 * on or before the billing date (billing January 2027 + "December" -> December 2026).
 */
export function defaultPeriodYear(month, billingValue) {
  const iso = parseLooseDate(billingValue);
  let y; let m;
  if (iso) {
    [y, m] = iso.split('-').map(Number);
  } else {
    const now = new Date();
    y = now.getFullYear(); m = now.getMonth() + 1;
  }
  return month > m ? y - 1 : y;
}