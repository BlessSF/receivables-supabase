import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { peso, fdate, MONTHS } from '../utils';
import MoneyInput from '../MoneyInput';

const num = (v) => Number(v) || 0;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// PDC Tracker: the Future payables total (from Cash Position) is the beginning balance. Type the PDC amount paid each month
// (January to December) and it is taken off the balance month after month, like a loan schedule, until it is paid.
// The unpaid Running Payables are still listed below.
const sgn = (n) => (n < 0 ? `−${peso(-n)}` : peso(n));
export default function PdcTracker() {
  const [year, setYear] = useState(null);
  const [data, setData] = useState(null);
  const [typed, setTyped] = useState([]); // text boxes, one per month
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(''); // "Saved" note after a change
  const [pick, setPick] = useState(0); // month (1-12) the list below is filtered to, 0 = all
  const lastSaved = useRef([]);
  const [tip, setTip] = useState(null); // hover card: { m (1-12), left, top | bottom }
  const tipTimer = useRef(null);
  const [future, setFuture] = useState([]); // Future payables from Cash Position (the beginning balance)
  const [carry, setCarry] = useState(0); // PDC already paid in earlier years (when viewing a later year)
  function openTip(m, el) {
    clearTimeout(tipTimer.current);
    const r = el.getBoundingClientRect();
    const w = Math.min(420, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
    const down = r.top < window.innerHeight / 2;
    setTip({ m, left, w, ...(down ? { top: r.bottom + 6 } : { bottom: window.innerHeight - r.top + 6 }) });
  }
  const closeTip = () => { clearTimeout(tipTimer.current); tipTimer.current = setTimeout(() => setTip(null), 160); };

  function load(y) {
    setErr('');
    return api.getPdcTracker(y || '')
      .then(async (r) => {
        const yr = r.data.year, base = r.data.this_year;
        let carried = 0;
        if (yr > base && yr - base <= 10) { // a later year starts from what is left after the earlier years' PDC
          const prev = await Promise.all(Array.from({ length: yr - base }, (_, k) => api.getPdcTracker(base + k)));
          carried = r2(prev.reduce((t, x) => t + x.data.months.reduce((a, n) => a + num(n), 0), 0));
        }
        setCarry(carried);
        setData(r.data); setYear(r.data.year);
        const t = r.data.months.map((n) => (n ? String(n) : ''));
        setTyped(t); lastSaved.current = r.data.months.slice();
      })
      .catch((e) => setErr(e.message));
  }
  useEffect(() => {
    load();
    api.getCashPosition().then((r) => setFuture(r.future || [])).catch(() => {});
  }, []);

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
  const futureTotal = r2(future.reduce((t, x) => t + (Number(x.amount) || 0), 0));
  const begin = r2(futureTotal - carry); // beginning balance for this year
  const bal = []; // balance after each month's PDC
  { let run = begin; for (let i = 0; i < 12; i++) { run = r2(run - num(typed[i])); bal.push(run); } }
  const prevBal = (i) => (i === 0 ? begin : bal[i - 1]);
  const endBal = bal[11];
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
          <div className="subtitle">The Future payables total is the beginning balance. Type the PDC amount for each month and it is taken off the balance until it is paid.</div>
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
                <th className="text-right">Balance <span className="pdc-hint">hover an amount to see why</span></th>
              </tr>
            </thead>
            <tbody>
              <tr className="pdc-total">
                <td>Beginning balance <small className="pdc-none">Future payables{carry ? ` less PDC paid before ${year}` : ''}</small></td>
                <td />
                <td className="text-right pdc-bal">
                  <span className="pdc-why" tabIndex={0} aria-label={`Why the beginning balance is ${sgn(begin)}`}
                    onMouseEnter={(e) => openTip(0, e.currentTarget)} onMouseLeave={closeTip}
                    onFocus={(e) => openTip(0, e.currentTarget)} onBlur={closeTip}>{sgn(begin)}</span>
                </td>
              </tr>
              {MONTHS.map((name, i) => {
                return (
                  <tr key={name} className={pick === i + 1 ? 'pdc-picked' : ''}>
                    <td><button type="button" className="pdc-month" title="Show this month's payables below" onClick={() => { setPick(pick === i + 1 ? 0 : i + 1); }}>{name}</button></td>
                    <td className="text-right">
                      <MoneyInput className="pdc-in" aria-label={`PDC amount ${name}`} placeholder="0.00" value={typed[i] || ''}
                        onChange={(v) => setTyped((t) => t.map((x, k) => (k === i ? v : x)))}
                        onBlur={() => commit(i)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
                    </td>
                    <td className="text-right pdc-bal">
                      <span className="pdc-why" tabIndex={0} aria-label={`Why ${name} is ${sgn(bal[i])}`}
                        onMouseEnter={(e) => openTip(i + 1, e.currentTarget)} onMouseLeave={closeTip}
                        onFocus={(e) => openTip(i + 1, e.currentTarget)} onBlur={closeTip}>
                        {sgn(bal[i])}
                      </span>
                    </td>
                  </tr>
                );
              })}
              <tr className="pdc-total">
                <td>Total PDC · balance at the end of {year}</td>
                <td className="text-right">{peso(totalAmount)}</td>
                <td className="text-right">{sgn(endBal)}</td>
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
      {tip && (() => {
        const m = tip.m;
        return (
          <div className="pdc-pop" role="tooltip" style={{ left: tip.left, width: tip.w, top: tip.top, bottom: tip.bottom }}
            onMouseEnter={() => clearTimeout(tipTimer.current)} onMouseLeave={closeTip}>
            {m === 0 ? (
              <>
                <div className="pdc-pop-head"><b>Beginning balance {year}</b><span>The Future payables from Cash Position</span></div>
                <div className="pdc-pop-body">
                  {future.map((x) => (
                    <div className="pdc-pop-row" key={x.id}><span className="pdc-pop-date" /><span className="pdc-pop-who">{x.label || '(no label)'}</span><span className="pdc-pop-amt">{sgn(Number(x.amount) || 0)}</span></div>
                  ))}
                  {future.length === 0 && <div className="pdc-pop-row"><span className="pdc-pop-date" /><span className="pdc-pop-who">No future payables yet.</span><span /></div>}
                </div>
                <div className="pdc-pop-total"><span>Future payables total</span><b>{sgn(futureTotal)}</b></div>
                {carry !== 0 && <div className="pdc-pop-total"><span>Less: PDC paid in earlier years</span><b>− {peso(carry)}</b></div>}
                <div className="pdc-pop-total"><span>Beginning balance</span><b>{sgn(begin)}</b></div>
              </>
            ) : (
              <>
                <div className="pdc-pop-head"><b>{MONTHS[m - 1]} {year}</b><span>{m === 1 ? 'Beginning balance' : `Balance after ${MONTHS[m - 2]}`} less this month's PDC</span></div>
                <div className="pdc-pop-total"><span>{m === 1 ? 'Beginning balance' : `Balance after ${MONTHS[m - 2]}`}</span><b>{sgn(prevBal(m - 1))}</b></div>
                <div className="pdc-pop-total"><span>Less: PDC amount {MONTHS[m - 1]}</span><b>− {peso(num(typed[m - 1]))}</b></div>
                <div className="pdc-pop-total"><span>Balance</span><b>{sgn(bal[m - 1])}</b></div>
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}