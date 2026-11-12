import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { peso, fdate, MONTHS } from '../utils';
import MoneyInput from '../MoneyInput';

const num = (v) => Number(v) || 0;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// PDC Tracker: type the PDC amount for each month (January to December); the Balance is that amount minus the
// unpaid Running Payables whose check date falls in the month. The running payables are listed below.
export default function PdcTracker() {
  const [year, setYear] = useState(null);
  const [data, setData] = useState(null);
  const [typed, setTyped] = useState([]); // text boxes, one per month
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(''); // "Saved" note after a change
  const [pick, setPick] = useState(0); // month (1-12) the list below is filtered to, 0 = all
  const lastSaved = useRef([]);

  function load(y) {
    setErr('');
    return api.getPdcTracker(y || '')
      .then((r) => {
        setData(r.data); setYear(r.data.year);
        const t = r.data.months.map((n) => (n ? String(n) : ''));
        setTyped(t); lastSaved.current = r.data.months.slice();
      })
      .catch((e) => setErr(e.message));
  }
  useEffect(() => { load(); }, []);

  // unpaid running payables per month (by check date) + the ones with no check date
  const due = useMemo(() => {
    const m = Array.from({ length: 12 }, () => ({ total: 0, count: 0 }));
    let none = { total: 0, count: 0 };
    for (const p of data?.payables || []) {
      const mo = p.check_date ? Number(p.check_date.slice(5, 7)) : 0;
      if (mo >= 1 && mo <= 12) { m[mo - 1].total += p.amount; m[mo - 1].count++; } else { none.total += p.amount; none.count++; }
    }
    return { m, none };
  }, [data]);

  async function commit(i) {
    const amount = num(typed[i]);
    if (r2(amount) === r2(lastSaved.current[i])) return;
    try {
      await api.savePdcAmount(year, i + 1, amount);
      lastSaved.current[i] = amount;
      setSaved(`${MONTHS[i]} saved`); setTimeout(() => setSaved(''), 2200);
    } catch (e) { setErr(e.message); }
  }

  if (!data && !err) return <div className="loading-state">Loading…</div>;
  if (!data) return <div className="flash flash-error">{err}</div>;

  const totalAmount = r2(typed.reduce((t, v) => t + num(v), 0));
  const totalDue = r2(due.m.reduce((t, x) => t + x.total, 0));
  const shown = (data.payables || []).filter((p) => {
    const mo = p.check_date ? Number(p.check_date.slice(5, 7)) : 0;
    return !pick || mo === pick;
  });
  const shownTotal = r2(shown.reduce((t, p) => t + p.amount, 0));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>PDC Tracker</h1>
          <div className="subtitle">Type the PDC amount for each month. Balance = PDC amount − unpaid running payables with a check date in that month.</div>
        </div>
        <div className="pdc-year">
          <button type="button" className="btn btn-secondary" onClick={() => load(year - 1)} aria-label="Previous year">‹</button>
          <b>{year}</b>
          <button type="button" className="btn btn-secondary" onClick={() => load(year + 1)} aria-label="Next year">›</button>
          {year !== data.this_year && <button type="button" className="btn btn-secondary" onClick={() => load(data.this_year)}>This year</button>}
        </div>
      </div>
      {err && <div className="flash flash-error" role="alert">{err}</div>}

      <div className="panel">
        <div className="table-wrap">
          <table className="data-table pdc-table">
            <thead>
              <tr>
                <th>Month</th>
                <th className="text-right">PDC amount (type here)</th>
                <th className="text-right">Running payables</th>
                <th className="text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {MONTHS.map((name, i) => {
                const bal = r2(num(typed[i]) - due.m[i].total);
                const has = num(typed[i]) > 0 || due.m[i].count > 0;
                return (
                  <tr key={name} className={pick === i + 1 ? 'pdc-picked' : ''}>
                    <td><button type="button" className="pdc-month" title="Show this month's payables below" onClick={() => { setPick(pick === i + 1 ? 0 : i + 1); }}>{name}</button></td>
                    <td className="text-right">
                      <MoneyInput className="pdc-in" aria-label={`PDC amount ${name}`} placeholder="0.00" value={typed[i] || ''}
                        onChange={(v) => setTyped((t) => t.map((x, k) => (k === i ? v : x)))}
                        onBlur={() => commit(i)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
                    </td>
                    <td className="text-right pdc-due">{due.m[i].count ? <>{peso(due.m[i].total)} <span className="pdc-n">{due.m[i].count}</span></> : '—'}</td>
                    <td className={`text-right pdc-bal${bal < 0 ? ' neg' : ''}`}>{has ? peso(bal) : '—'}</td>
                  </tr>
                );
              })}
              <tr className="pdc-total">
                <td>Total</td>
                <td className="text-right">{peso(totalAmount)}</td>
                <td className="text-right">{peso(totalDue)}</td>
                <td className={`text-right${r2(totalAmount - totalDue) < 0 ? ' pdc-neg' : ''}`}>{peso(r2(totalAmount - totalDue))}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="pdc-foot">
          <span>{saved || 'Amounts save as soon as you leave the box.'}</span>
          {data.other_years.count > 0 && <span>{data.other_years.count} unpaid payable{data.other_years.count === 1 ? '' : 's'} ({peso(data.other_years.total)}) have a check date in another year.</span>}
        </div>
      </div>

      <div className="panel">
        <div className="pdc-list-head">
          <h2>Running payables {pick ? `· ${MONTHS[pick - 1]} ${year}` : `· ${year}`}</h2>
          {pick > 0 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPick(0)}>Show all months</button>}
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Check date</th><th>Payee</th><th>Account title</th><th>Status</th><th className="text-right">Amount</th></tr>
            </thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={5} className="pdc-none">No unpaid running payables{pick ? ' in this month' : ''}.</td></tr>}
              {shown.map((p) => (
                <tr key={p.id}>
                  <td>{p.check_date ? fdate(p.check_date) : <span className="pdc-none">No check date</span>}</td>
                  <td>{p.payee}</td>
                  <td>{p.category}{p.title_name ? ` · ${p.title_name}` : ''}</td>
                  <td>{p.release_status}</td>
                  <td className="text-right">{peso(p.amount)}</td>
                </tr>
              ))}
              <tr className="pdc-total"><td colSpan={4}>Total · {shown.length} payable{shown.length === 1 ? '' : 's'}</td><td className="text-right">{peso(shownTotal)}</td></tr>
            </tbody>
          </table>
        </div>
        {!pick && due.none.count > 0 && <div className="pdc-foot"><span>{due.none.count} of these have no check date, so they are not counted in any month above ({peso(due.none.total)}).</span></div>}
      </div>
    </div>
  );
}