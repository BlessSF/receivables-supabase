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