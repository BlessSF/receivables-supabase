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
/**
 * Covered-period rules (editable in Settings). Each rule says: when the billing date is in `month`
 * (0 = every month) and its day is day_from..day_to, the covered period runs from
 * (from_offset months away, from_day) to (to_offset months away, to_day). Offsets: -1 previous month,
 * 0 same month, 1 next month. A day of 0 means "last day of that month". A rule for one month wins over an
 * "every month" rule.
 */
export const DEFAULT_COVERED_RULES = [
  { month: 0, day_from: 16, day_to: 31, from_offset: 0, from_day: 1, to_offset: 0, to_day: 15 },
  { month: 0, day_from: 1, day_to: 15, from_offset: -1, from_day: 16, to_offset: -1, to_day: 0 },
];

/** Checks a rules list from Settings; returns the cleaned list or throws an Error with a plain message. */
export function normalizeCoveredRules(raw) {
  if (!Array.isArray(raw)) throw new Error('Rules must be a list.');
  if (raw.length > 60) throw new Error('Too many rules (limit 60).');
  const int = (v) => (Number.isInteger(Number(v)) && String(v).trim() !== '' ? Number(v) : NaN);
  return raw.map((r, i) => {
    const n = i + 1;
    const x = {
      month: int(r?.month ?? 0), day_from: int(r?.day_from), day_to: int(r?.day_to),
      from_offset: int(r?.from_offset), from_day: int(r?.from_day), to_offset: int(r?.to_offset), to_day: int(r?.to_day),
    };
    if (!(x.month >= 0 && x.month <= 12)) throw new Error(`Rule ${n}: pick a month.`);
    if (!(x.day_from >= 1 && x.day_from <= 31 && x.day_to >= 1 && x.day_to <= 31)) throw new Error(`Rule ${n}: billing days must be between 1 and 31.`);
    if (x.day_from > x.day_to) throw new Error(`Rule ${n}: the first billing day is after the last one.`);
    if (![-1, 0, 1].includes(x.from_offset) || ![-1, 0, 1].includes(x.to_offset)) throw new Error(`Rule ${n}: pick the month of the covered period.`);
    if (!(x.from_day >= 0 && x.from_day <= 31 && x.to_day >= 0 && x.to_day <= 31)) throw new Error(`Rule ${n}: covered days must be between 1 and 31 (or the last day).`);
    return x;
  });
}

/**
 * Covered period for a billing date under the rules (default: the two semi-monthly rules).
 * Default: billed 16th-31st -> 1st-15th of the same month; billed 1st-15th -> 16th-end of the previous month.
 * Returns { from, to } as "YYYY-MM-DD", or null when the date is invalid or no rule matches.
 */
export function coveredPeriodForBilling(billingDate, rules = DEFAULT_COVERED_RULES) {
  const m = String(billingDate ?? '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const hits = (rules || []).filter((r) => d >= r.day_from && d <= r.day_to && (!r.month || r.month === mo));
  const rule = hits.find((r) => r.month === mo) || hits[0];
  if (!rule) return null;
  const p2 = (n) => String(n).padStart(2, '0');
  const at = (offset, day) => {
    let yy = y, mm = mo + offset;
    if (mm < 1) { mm = 12; yy -= 1; } else if (mm > 12) { mm = 1; yy += 1; }
    const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    return `${yy}-${p2(mm)}-${p2(day === 0 ? last : Math.min(day, last))}`;
  };
  return { from: at(rule.from_offset, rule.from_day), to: at(rule.to_offset, rule.to_day) };
}
/** Accounting accounts: everything in Receivables except Users, Branches, Settings and Payables. */
export function isAccounting(user) {
  return user?.role === 'accounting';
}
// Sidebar pages that can be switched on / off per role (Users > Sidebar access).
export const NAV_PAGE_PATHS = ['/', '/summary', '/reports-by-month', '/companies', '/hmos', '/company-charges', '/billing', '/ledger', '/aging', '/past-due', '/soa-tracker', '/monitoring'];
/** May this person open this sidebar page? (Admin and anything not switchable is always yes.) */
export function navAllowed(user, path) {
  if (!user?.nav_access || !NAV_PAGE_PATHS.includes(path)) return true;
  return path === '/' || user.nav_access.includes(path);
}
/** Staff accounts: see every company's ledger, edit only Payment Date, Check Ref and Paid. */
export function isStaff(user) {
  return user?.role === 'staff';
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

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

/** Covered period as text: "Sept 18 to Sept 30" (the year is added only when the two dates are in different years). */
export function coveredLabel(from, to, periodDate) {
  const p = (v) => { const m = String(v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; };
  const a = p(from), b = p(to);
  if (!a || !b) return periodLabel(periodDate);
  const yr = a.y !== b.y;
  const f = (x) => `${SHORT_MONTHS[x.m - 1]} ${x.d}${yr ? `, ${x.y}` : ''}`;
  return `${f(a)} to ${f(b)}`;
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