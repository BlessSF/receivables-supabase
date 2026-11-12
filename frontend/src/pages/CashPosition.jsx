import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { peso, fdate } from '../utils';
import MoneyInput, { rawNum } from '../MoneyInput';
import { computeMain } from '../mainCalc';

const sgn = (n) => (n < 0 ? `−${peso(-n)}` : peso(n));
const uid = () => Math.random().toString(36).slice(2, 10);
const toRow = (x) => ({ id: x.id, label: x.label, neg: x.amount < 0, amount: x.amount ? String(Math.abs(x.amount)) : '' });
const rowVal = (x) => (Number(rawNum(x.amount)) || 0) * (x.neg ? -1 : 1);

export default function CashPosition() {
  const { user } = useAuth();
  const bank = user?.bank_name || 'Security Bank';
  const [d, setD] = useState(null);
  const [mf, setMf] = useState(null); // the typed "Receivables as of <date>" from the Main page
  const [future, setFuture] = useState([]);
  const [state, setState] = useState('idle');
  const [err, setErr] = useState('');
  const dirty = useRef(false);
  const timer = useRef(null);
  const latest = useRef([]);

  useEffect(() => {
    api.getCashPosition()
      .then((r) => { setD(r); setFuture(r.future.map(toRow)); })
      .catch((e) => setErr(e.message || 'Could not load.'));
    api.getMainFund().then((r) => setMf(r.data)).catch(() => {}); // if this fails, the figures from Cash Position are used
  }, []);

  latest.current = future;
  function editFuture(fn) {
    setFuture((cur) => fn(cur));
    dirty.current = true; setState('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 800);
  }
  async function flush() {
    if (!dirty.current) return;
    dirty.current = false;
    try {
      await api.saveCashPosition(latest.current.map((x) => ({ id: x.id, label: x.label, amount: rowVal(x) })));
      setErr(''); setState(dirty.current ? 'saving' : 'saved');
    } catch (e) { setErr(e.message || 'Could not save.'); setState('error'); dirty.current = true; }
  }
  useEffect(() => () => { clearTimeout(timer.current); if (dirty.current) flush(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const c = useMemo(() => {
    if (!d) return null;
    const m = d.main;
    const main = computeMain(m, d.released_payables, d.running_payables);
    const bank = m.passbook + m.deposit + m.aub;
    const due = d.receivables.due;
    const notYet = d.receivables.not_yet;
    const typedAR = Number(mf?.receivables ?? m.receivables) || 0; // typed on Main: Receivables as of <date>
    const typedDate = mf?.receivables_date ?? m.receivables_date ?? '';
    const ledgerAR = due + notYet;
    const totalAR = ledgerAR + typedAR;
    const released = main.checksTotal;
    const running = d.running_payables;
    const current = released + running;
    const futureTotal = future.reduce((t, x) => t + rowVal(x), 0);
    const allAP = current + futureTotal;
    return {
      m, bank, due, notYet, typedAR, typedDate, ledgerAR, totalAR, released, running, current, futureTotal, allAP,
      net1: bank - current, net2: bank + due - current, net3: bank + totalAR - allAP,
    };
  }, [d, mf, future]);

  if (!d || !c) {
    return (
      <div>
        <div className="page-header"><div><h1>Cash Position</h1></div></div>
        {err ? <div className="flash flash-error">{err}</div> : <div className="empty-state">Loading…</div>}
      </div>
    );
  }

  const dueShare = c.ledgerAR > 0 ? (c.due / c.ledgerAR) * 100 : 0;
  const bars = [
    { label: 'Bank balance', value: c.bank, cls: 'cash' },
    { label: 'Due receivables', value: c.due, cls: 'in' },
    { label: 'All receivables', value: c.totalAR, cls: 'in2' },
    { label: 'Current payables', value: c.current, cls: 'out' },
    { label: 'Payables incl. future', value: c.allAP, cls: 'out2' },
  ];
  const max = Math.max(1, ...bars.map((b) => Math.abs(b.value)));

  return (
    <div className="cp">
      <div className="page-header">
        <div>
          <h1>Cash Position</h1>
          <div className="subtitle">As of {fdate(d.as_of)} · figures update by themselves from Main, Running Payables and your ledger</div>
        </div>
        <div className="dlc-right"><span className="dlc-badge" title="Demic Lab Main"><span className="dlc-a">DLC</span><span className="dlc-b">MAIN</span></span></div>
        <span className={`at-status mf-state ${state}`}>{state === 'saving' ? 'Saving…' : state === 'error' ? 'Not saved' : ''}</span>
      </div>
      {state === 'error' && err && <div className="flash flash-error">{err}</div>}

      <div className="mf-hero cp-hero">
        <div className="mf-card">
          <div className="mf-card-label">Bank less current payables</div>
          <div className={`mf-card-value ${c.net1 < 0 ? 'neg' : ''}`}>{sgn(c.net1)}</div>
          <div className="mf-card-sub">What is left today if every current payable is paid</div>
        </div>
        <div className="mf-card">
          <div className="mf-card-label">Including due receivables</div>
          <div className={`mf-card-value ${c.net2 < 0 ? 'neg' : ''}`}>{sgn(c.net2)}</div>
          <div className="mf-card-sub">Bank + due receivables − current payables</div>
        </div>
        <div className="mf-card mf-card-main">
          <div className="mf-card-label">After all receivables and payables</div>
          <div className="mf-card-value">{sgn(c.net3)}</div>
          <div className="mf-card-sub">Bank + all receivables − all payables incl. future</div>
        </div>
      </div>

      <section className="panel cp-bars">
        <h2>Where the money stands</h2>
        <ul>
          {bars.map((b) => (
            <li key={b.label}>
              <span className="cp-bar-label">{b.label}</span>
              <span className="cp-bar-track"><i className={`cp-bar ${b.cls}`} style={{ width: `${Math.max(1.5, (Math.abs(b.value) / max) * 100)}%` }} /></span>
              <span className="cp-bar-val">{sgn(b.value)}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="cp-grid">
        <section className="panel">
          <div className="mf-block">Bank balances</div>
          <div className="mf-row mf-auto"><span className="mf-lbl">Passbook balance · {bank}</span><span className="mf-val">{peso(c.m.passbook)}</span></div>
          <div className="mf-row mf-auto"><span className="mf-lbl">Sales deposit in transit</span><span className="mf-val">{peso(c.m.deposit)}</span></div>
          <div className="mf-row mf-auto"><span className="mf-lbl">{c.m.aub_label || 'AUB account'}</span><span className="mf-val">{peso(c.m.aub)}</span></div>
          <div className="mf-row mf-sub mf-key"><span className="mf-lbl">Available bank balance</span><span className="mf-val">{peso(c.bank)}</span></div>
          <p className="at-help cp-note">These come from the <Link to="/payables/main" className="pay-link-btn">Main</Link> page. Edit them there.</p>
        </section>

        <section className="panel">
          <div className="mf-block">Receivables</div>
          <div className="mf-row mf-auto"><span className="mf-lbl">Due receivables <i>auto</i></span><span className="mf-val">{peso(c.due)}</span></div>
          <div className="mf-row mf-auto"><span className="mf-lbl">Not yet due receivables <i>auto</i></span><span className="mf-val">{peso(c.notYet)}</span></div>
          {c.typedAR !== 0 && (
            <div className="mf-row mf-auto"><span className="mf-lbl">Receivables as of {c.typedDate ? fdate(c.typedDate) : 'the date on Main'} <i>from Main</i></span><span className="mf-val">{sgn(c.typedAR)}</span></div>
          )}
          <div className="mf-row mf-sub mf-key"><span className="mf-lbl">Total account receivables</span><span className="mf-val">{peso(c.totalAR)}</span></div>
          <Link className="dash-due-link" to="/">View in Dashboard →</Link>
          <div className="cp-split" title={`${dueShare.toFixed(0)}% of receivables are already due`}>
            <i style={{ width: `${dueShare}%` }} />
          </div>
          <div className="cp-split-key"><span>{dueShare.toFixed(0)}% due ({d.receivables.due_count} entries)</span><span>{d.receivables.not_yet_count} not yet due</span></div>
          {c.typedAR !== 0 && <p className="at-help cp-note">The "Receivables as of" line is the amount typed on the <Link to="/payables/main" className="pay-link-btn">Main</Link> page{c.typedDate ? `, receivables as of ${fdate(c.typedDate)}` : ''}. Edit it there. The percentage below counts only the ledger entries.</p>}
          <p className="at-help cp-note">Due = past due plus this month, the same as <Link to="/reports-by-month" className="pay-link-btn">Reports by Month</Link> (its own Due Date, else billing month + {d.payment_terms ?? 2} months).{d.receivables.unplaced_count ? ` ${d.receivables.unplaced_count} unpaid ${d.receivables.unplaced_count === 1 ? 'entry has' : 'entries have'} no period or due date and ${d.receivables.unplaced_count === 1 ? 'is' : 'are'} counted as not yet due.` : ''}</p>
        </section>

        <section className="panel">
          <div className="mf-block">Payables</div>
          <div className="mf-row mf-auto"><span className="mf-lbl">Released checks <i>auto</i></span><span className="mf-val">{peso(c.released)}</span></div>
          <div className="mf-row mf-auto"><span className="mf-lbl">Payables for releasing <i>auto</i> <Link to="/payables/running" className="pay-link-btn">{d.running_count} unpaid</Link></span><span className="mf-val">{peso(c.running)}</span></div>
          <div className="mf-row mf-sub mf-key"><span className="mf-lbl">Total current accounts payable</span><span className="mf-val">{peso(c.current)}</span></div>

          <div className="mf-block">Future payables <span className="cp-edit">can be edited</span></div>
          <p className="at-help cp-note" style={{ marginTop: 0 }}>For example machine, Jaro capex, incorporator. Use − for something taken off.</p>
          <ul className="cp-future">
            {future.map((x) => (
              <li key={x.id}>
                <input className="mf-lbl-in" value={x.label} placeholder="What is it for?" maxLength={120} onChange={(e) => editFuture((cur) => cur.map((y) => (y.id === x.id ? { ...y, label: e.target.value } : y)))} aria-label="Label" />
                <button type="button" className={`cp-sign ${x.neg ? 'neg' : ''}`} onClick={() => editFuture((cur) => cur.map((y) => (y.id === x.id ? { ...y, neg: !y.neg } : y)))} title={x.neg ? 'Taken off (click for add)' : 'Added (click for take off)'} aria-label="Add or take off">{x.neg ? '−' : '+'}</button>
                <MoneyInput className="mf-in" value={x.amount} placeholder="0.00" onChange={(v) => editFuture((cur) => cur.map((y) => (y.id === x.id ? { ...y, amount: v } : y)))} aria-label="Amount" />
                <button type="button" className="at-x" onClick={() => editFuture((cur) => cur.filter((y) => y.id !== x.id))} aria-label="Remove" title="Remove">×</button>
              </li>
            ))}
            {future.length === 0 && <li className="at-empty">No future payables yet.</li>}
          </ul>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => editFuture((cur) => [...cur, { id: uid(), label: '', neg: false, amount: '' }])}>+ Add item</button>
          <div className="mf-row mf-sub" style={{ marginTop: 12 }}><span className="mf-lbl">Future payables total</span><span className="mf-val">{sgn(c.futureTotal)}</span></div>
          <div className="mf-row mf-sub mf-key"><span className="mf-lbl">Total payables incl. future</span><span className="mf-val">{peso(c.allAP)}</span></div>
        </section>
      </div>
    </div>
  );
}