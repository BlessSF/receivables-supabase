import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { peso, fdate, MONTHS } from '../utils';
import MoneyInput from '../MoneyInput';

const num = (v) => Number(v) || 0;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const sgn = (n) => (n < 0 ? `−${peso(-n)}` : peso(n));

// PDC Tracker: every Future payable (Cash Position) has its own tracker. The item's amount is its beginning balance;
// type the PDC paid each month and it is taken off month after month until the item is paid. New items show up by themselves.
export default function PdcTracker() {
  const [year, setYear] = useState(null);
  const [data, setData] = useState(null);
  const [typed, setTyped] = useState({}); // { itemId: [12 text boxes] }
  const [sel, setSel] = useState(''); // the item shown below the summary
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState('');
  const [pick, setPick] = useState(0); // month (1-12) the running payables list is filtered to, 0 = all
  const lastSaved = useRef({});
  const [tip, setTip] = useState(null); // hover card: { id, m (0 = beginning, 1-12), left, w, top | bottom }
  const tipTimer = useRef(null);
  const [showList, setShowList] = useState(() => { try { return localStorage.getItem('pdc_show_list') === '1'; } catch { return false; } }); // Running payables list: hidden by default
  const toggleList = () => setShowList((v) => { const n = !v; try { localStorage.setItem('pdc_show_list', n ? '1' : '0'); } catch { /* ignore */ } return n; });
  function openTip(id, m, el) {
    clearTimeout(tipTimer.current);
    const r = el.getBoundingClientRect();
    const w = Math.min(420, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
    const down = r.top < window.innerHeight / 2;
    setTip({ id, m, left, w, ...(down ? { top: r.bottom + 6 } : { bottom: window.innerHeight - r.top + 6 }) });
  }
  const closeTip = () => { clearTimeout(tipTimer.current); tipTimer.current = setTimeout(() => setTip(null), 160); };

  function load(y) {
    setErr('');
    return api.getPdcTracker(y || '')
      .then((r) => {
        setData(r.data); setYear(r.data.year);
        const t = {}; const ls = {};
        for (const it of r.data.items || []) { t[it.id] = it.months.map((n) => (n ? String(n) : '')); ls[it.id] = it.months.slice(); }
        setTyped(t); lastSaved.current = ls;
        setSel((cur) => ((r.data.items || []).some((it) => it.id === cur) ? cur : (r.data.items?.[0]?.id || '')));
      })
      .catch((e) => setErr(e.message));
  }
  useEffect(() => { load(); }, []);

  // unpaid running payables with no check date (for the list below)
  const due = useMemo(() => {
    const none = { total: 0, count: 0 };
    for (const p of data?.payables || []) if (!p.check_date) { none.total += p.amount; none.count++; }
    return { none };
  }, [data]);

  async function commit(it, i) {
    const amount = num(typed[it.id]?.[i]);
    if (r2(amount) === r2(lastSaved.current[it.id]?.[i])) return;
    try {
      await api.savePdcAmount(year, i + 1, amount, it.id);
      lastSaved.current[it.id][i] = amount;
      setSaved(`${it.label} · ${MONTHS[i]} saved`); setTimeout(() => setSaved(''), 2200);
    } catch (e) { setErr(e.message); }
  }

  if (!data && !err) return <div className="loading-state">Loading…</div>;
  if (!data) return <div className="flash flash-error">{err}</div>;

  // beginning balance and the balance after each month, per item
  const calc = (it) => {
    const begin = r2(it.amount - it.paid_before);
    const bal = []; let run = begin;
    for (let i = 0; i < 12; i++) { run = r2(run - num(typed[it.id]?.[i])); bal.push(run); }
    const paid = r2((typed[it.id] || []).reduce((t, v) => t + num(v), 0));
    return { begin, bal, paid, end: bal[11] };
  };
  const items = data.items || [];
  const calcs = Object.fromEntries(items.map((it) => [it.id, calc(it)]));
  const sum = (k) => r2(items.reduce((t, it) => t + calcs[it.id][k], 0));
  const cur = items.find((it) => it.id === sel) || items[0];
  const cc = cur ? calcs[cur.id] : null;
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
          <div className="subtitle">Each future payable has its own card. Click a card to open its tracker, type the PDC for each month and it comes off the balance until it is paid.</div>
        </div>
        <div className="pdc-year">
          <button type="button" className="btn btn-secondary" onClick={() => load(year - 1)} aria-label="Previous year">‹</button>
          <b>{year}</b>
          <button type="button" className="btn btn-secondary" onClick={() => load(year + 1)} aria-label="Next year">›</button>
          {year !== data.this_year && <button type="button" className="btn btn-secondary" onClick={() => load(data.this_year)}>This year</button>}
        </div>
      </div>
      {err && <div className="flash flash-error" role="alert">{err}</div>}

      {items.length === 0 && (
        <div className="panel"><div className="pdc-foot"><span>No future payables yet. Add them in <Link to="/payables/cash-position" className="pay-link-btn">Cash Position</Link> and each one gets its own tracker here.</span></div></div>
      )}

      {items.length > 0 && (
        <div className="pdc-cards">
          <div className="pdc-card pdc-card-all">
            <span className="pdc-card-name">All future payables</span>
            <b className="pdc-card-bal">{sgn(sum('end'))}</b>
            <span className="pdc-card-sub">left at end of {year} · started at {sgn(sum('begin'))}</span>
            <span className="pdc-card-sub">PDC in {year}: {peso(sum('paid'))}</span>
          </div>
          {items.map((it) => {
            const k = calcs[it.id];
            const share = it.amount > 0 ? Math.max(0, Math.min(100, ((it.amount - k.end) / it.amount) * 100)) : 0;
            const on = cur && cur.id === it.id;
            return (
              <button type="button" key={it.id} className={`pdc-card pdc-card-pick ${on ? 'on' : ''}`} onClick={() => setSel(it.id)} aria-pressed={on}>
                <span className="pdc-card-name">{it.label}</span>
                <b className={`pdc-card-bal ${k.end < 0 ? 'neg' : ''}`}>{sgn(k.end)}</b>
                <span className="pdc-card-sub">left at end of {year} · started at {sgn(k.begin)}</span>
                <span className="pdc-card-bar"><i style={{ width: `${share}%` }} /></span>
                <span className="pdc-card-sub">{share.toFixed(0)}% paid · PDC in {year}: {peso(k.paid)}</span>
                <span className="pdc-card-open">{on ? 'Showing below ↓' : 'Click to open'}</span>
              </button>
            );
          })}
        </div>
      )}

      {cur && (
        <div className="panel">
          <div className="pdc-list-head"><h2>{cur.label} · {year}</h2></div>
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
                  <td>Beginning balance <small className="pdc-none">{cur.label}{cur.paid_before ? ` less PDC paid before ${year}` : ''}</small></td>
                  <td />
                  <td className="text-right pdc-bal">
                    <span className="pdc-why" tabIndex={0} aria-label={`Why the beginning balance is ${sgn(cc.begin)}`}
                      onMouseEnter={(e) => openTip(cur.id, 0, e.currentTarget)} onMouseLeave={closeTip}
                      onFocus={(e) => openTip(cur.id, 0, e.currentTarget)} onBlur={closeTip}>{sgn(cc.begin)}</span>
                  </td>
                </tr>
                {MONTHS.map((name, i) => (
                  <tr key={name}>
                    <td><span style={{ fontWeight: 600 }}>{name}</span></td>
                    <td className="text-right">
                      <MoneyInput className="pdc-in" aria-label={`PDC amount ${cur.label} ${name}`} placeholder="0.00" value={typed[cur.id]?.[i] || ''}
                        onChange={(v) => setTyped((t) => ({ ...t, [cur.id]: (t[cur.id] || []).map((x, k) => (k === i ? v : x)) }))}
                        onBlur={() => commit(cur, i)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
                    </td>
                    <td className="text-right pdc-bal">
                      <span className="pdc-why" tabIndex={0} aria-label={`Why ${name} is ${sgn(cc.bal[i])}`}
                        onMouseEnter={(e) => openTip(cur.id, i + 1, e.currentTarget)} onMouseLeave={closeTip}
                        onFocus={(e) => openTip(cur.id, i + 1, e.currentTarget)} onBlur={closeTip}>{sgn(cc.bal[i])}</span>
                    </td>
                  </tr>
                ))}
                <tr className="pdc-total">
                  <td>Total PDC · balance at the end of {year}</td>
                  <td className="text-right">{peso(cc.paid)}</td>
                  <td className="text-right">{sgn(cc.end)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="pdc-foot"><span>{saved || 'Amounts save as soon as you leave the box.'}</span></div>
        </div>
      )}

      <div className="panel">
        <div className="pdc-list-head">
          <h2>Running payables {pick ? `· ${MONTHS[pick - 1]} ${year}` : `· ${year}`}</h2>
          <span>
            {showList && pick > 0 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPick(0)}>Show all months</button>}{' '}
            <button type="button" className="btn btn-secondary btn-sm" onClick={toggleList}>{showList ? 'Hide' : 'Show'}</button>
          </span>
        </div>
        {!showList && <div className="pdc-foot"><span>Hidden. {shown.length} unpaid payable{shown.length === 1 ? '' : 's'} ({peso(shownTotal)}). Click Show to see the list.</span></div>}
        {showList && <><div className="table-wrap">
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
        {!pick && due.none.count > 0 && <div className="pdc-foot"><span>{due.none.count} of these have no check date ({peso(due.none.total)}).</span></div>}</>}
      </div>
      {tip && (() => {
        const it = items.find((x) => x.id === tip.id);
        if (!it) return null;
        const k = calcs[it.id]; const m = tip.m;
        const before = m === 1 ? k.begin : k.bal[m - 2];
        return (
          <div className="pdc-pop" role="tooltip" style={{ left: tip.left, width: tip.w, top: tip.top, bottom: tip.bottom }}
            onMouseEnter={() => clearTimeout(tipTimer.current)} onMouseLeave={closeTip}>
            {m === 0 ? (
              <>
                <div className="pdc-pop-head"><b>{it.label}</b><span>Beginning balance {year}</span></div>
                <div className="pdc-pop-total"><span>Future payable amount (Cash Position)</span><b>{sgn(it.amount)}</b></div>
                {it.paid_before !== 0 && <div className="pdc-pop-total"><span>Less: PDC paid before {year}</span><b>− {peso(it.paid_before)}</b></div>}
                <div className="pdc-pop-total"><span>Beginning balance</span><b>{sgn(k.begin)}</b></div>
              </>
            ) : (
              <>
                <div className="pdc-pop-head"><b>{it.label} · {MONTHS[m - 1]} {year}</b><span>{m === 1 ? 'Beginning balance' : `Balance after ${MONTHS[m - 2]}`} less this month's PDC</span></div>
                <div className="pdc-pop-total"><span>{m === 1 ? 'Beginning balance' : `Balance after ${MONTHS[m - 2]}`}</span><b>{sgn(before)}</b></div>
                <div className="pdc-pop-total"><span>Less: PDC amount {MONTHS[m - 1]}</span><b>− {peso(num(typed[it.id]?.[m - 1]))}</b></div>
                <div className="pdc-pop-total"><span>Balance</span><b>{sgn(k.bal[m - 1])}</b></div>
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}