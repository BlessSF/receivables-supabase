import { Fragment, useState } from 'react';
import { peso, MONTHS, coveredLabel } from './utils';

// The month an entry belongs to = the month of its actual Covered Period (its end date; the start date if
// only that is known). Entries with no Covered Period are NOT guessed from the billing date: they are listed
// separately as "No covered period".
export const billingYm = (r) => { const m = String(r.period_to || r.period_from || r.period_date || '').match(/^(\d{4})-(\d{2})/); return m ? { y: +m[1], m: +m[2] } : null; };

/** January - December totals for a list of entries, for one year (+ a "No covered period" row if needed). */
export function buildMonths(list, year) {
  const blank = (name, extra = {}) => ({ name, entries: 0, overdue: 0, billed: 0, paid: 0, owed: 0, list: [], ...extra });
  const out = MONTHS.map((name) => blank(name));
  const none = blank('No covered period', { none: true });
  const add = (t, r) => {
    t.entries += 1;
    if (r.is_overdue) t.overdue += 1;
    t.billed += Number(r.amount || 0);
    t.paid += Number(r.paid_amount || 0);
    t.owed += Number(r.deduction ?? r.balance ?? 0);
    t.list.push(r);
  };
  (list || []).forEach((r) => {
    const p = billingYm(r);
    if (!p) { add(none, r); return; }
    if (String(p.y) !== String(year)) return;
    add(out[p.m - 1], r);
  });
  const byPeriod = (a, b) => String(a.period_from || a.period_to || '').localeCompare(String(b.period_from || b.period_to || '')) || String(a.soa_number || '').localeCompare(String(b.soa_number || ''));
  out.forEach((t) => t.list.sort(byPeriod));
  return none.entries > 0 ? [...out, none] : out;
}
export const sumMonths = (months) => months.reduce((a, m) => ({ entries: a.entries + m.entries, overdue: a.overdue + m.overdue, billed: a.billed + m.billed, paid: a.paid + m.paid, owed: a.owed + m.owed }), { entries: 0, overdue: 0, billed: 0, paid: 0, owed: 0 });

// One January - December table (used for all companies combined, and for each company)
export function MonthTable({ months, totalLabel, owedLabel }) {
  const total = sumMonths(months);
  const bold = { fontWeight: 700 };
  const [open, setOpen] = useState(() => new Set());
  const toggle = (name) => setOpen((cur) => { const n = new Set(cur); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Month (Covered Period)</th><th className="text-right">Entries</th><th className="text-right">Past Due</th>
            <th className="text-right">Billed</th><th className="text-right">Paid</th><th className="text-right">{owedLabel}</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <Fragment key={m.name}>
              <tr
                style={{ ...(m.entries === 0 ? { color: 'var(--slate)', opacity: 0.6 } : { cursor: 'pointer' }), ...(m.none ? { background: 'var(--amber-soft)' } : {}) }}
                onClick={m.entries > 0 ? () => toggle(m.name) : undefined}
                title={m.entries > 0 ? 'Click to show or hide the entries' : undefined}
              >
                <td style={{ fontWeight: 600 }}>{m.entries > 0 && <span style={{ display: 'inline-block', width: 14 }}>{open.has(m.name) ? '▾' : '▸'}</span>}{m.name}</td>
                <td className="text-right num">{m.entries}</td>
                <td className="text-right num">{m.overdue}</td>
                <td className="text-right num">{peso(m.billed)}</td>
                <td className="text-right num">{peso(m.paid)}</td>
                <td className="text-right num" style={bold}>{peso(m.owed)}</td>
              </tr>
              {open.has(m.name) && m.list.map((r) => (
                <tr key={r.id} style={{ background: 'var(--surface-2, #f7f8fa)', fontSize: 12.5 }}>
                  <td style={{ paddingLeft: 30 }}>{coveredLabel(r.period_from, r.period_to, r.period_date) || 'No covered period'}{r.soa_number ? ` · ${r.soa_number}` : ''}{r.company_name ? ` · ${r.company_name}` : ''}</td>
                  <td className="text-right num">1</td>
                  <td className="text-right num">{r.is_overdue ? 1 : 0}</td>
                  <td className="text-right num">{peso(r.amount)}</td>
                  <td className="text-right num">{peso(r.paid_amount)}</td>
                  <td className="text-right num">{peso(r.deduction ?? r.balance)}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td style={bold}>{totalLabel}</td>
            <td className="text-right num" style={bold}>{total.entries}</td>
            <td className="text-right num" style={bold}>{total.overdue}</td>
            <td className="text-right num" style={bold}>{peso(total.billed)}</td>
            <td className="text-right num" style={bold}>{peso(total.paid)}</td>
            <td className="text-right num" style={bold}>{peso(total.owed)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}