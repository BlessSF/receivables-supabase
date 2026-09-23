// Small helpers that reproduce PHP's type juggling, so request values are
// interpreted exactly the way the original api.php interpreted them.

/** PHP (int) cast */
export function toInt(v) {
  if (v === null || v === undefined || v === false) return 0;
  if (v === true) return 1;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : 0;
  const m = String(v).match(/^\s*([+-]?\d+(\.\d+)?([eE][+-]?\d+)?)/);
  return m ? Math.trunc(Number(m[1])) : 0;
}

/** PHP (float) cast */
export function toFloat(v) {
  if (v === null || v === undefined || v === false) return 0;
  if (v === true) return 1;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const m = String(v).match(/^\s*([+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?)/);
  return m ? Number(m[1]) : 0;
}

/** PHP (string) cast */
export function toStr(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v === true) return '1';
  return String(v);
}

/** PHP trim() (default character set) */
export function trim(v) {
  return toStr(v).replace(/^[ \t\n\r\0\x0B]+|[ \t\n\r\0\x0B]+$/g, '');
}

/** PHP truthiness (used by `?:` and `!empty()`) */
export function truthy(v) {
  if (v === null || v === undefined || v === false) return false;
  if (v === 0 || v === '' || v === '0') return false;
  if (Array.isArray(v) && v.length === 0) return false;
  if (typeof v === 'number' && Number.isNaN(v)) return true;
  return true;
}

/** PHP `$a ?: $b` */
export function elvis(a, b) {
  return truthy(a) ? a : b;
}

/** PHP round() (half away from zero) */
export function round(n, precision = 0) {
  const f = 10 ** precision;
  return (Math.sign(n) * Math.round(Math.abs(n) * f)) / f;
}
