import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { peso, fdate } from '../utils';
import { computeMain } from '../mainCalc';

const sgn = (n) => (n < 0 ? `−${peso(-n)}` : peso(n));
const LONG = { month: 'long', day: 'numeric', year: 'numeric' }; // January 11, 2026

export default function CashPosition() {
  const { user } = useAuth();
  const bank = user?.bank_name || 'Security Bank';
  const [d, setD] = useState(null);
  const [mf, setMf] = useState(null); // the typed "Receivables as of <date>" from the Main page
  const [err, setErr] = useState('');

  useEffect(() => {
    api.getCashPosition()
      .then((r) => setD(r))
      .catch((e) => setErr(e.message || 'Could not load.'));
    api.getMainFund().then((r) => setMf(r.data)).catch(() => {}); // if this fails, the figures from Cash Position are used
  }, []);

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
    const future = d.future || []; // read-only: the next unpaid PDC of each item (from the PDC Tracker)
    const futureTotal = future.reduce((t, x) => t + (Number(x.amount) || 0), 0);
    const allAP = current + futureTotal;
    return {
      m, bank, due, notYet, typedAR, typedDate, ledgerAR, totalAR, released, running, current, future, futureTotal, allAP,
      net1: bank - current, net2: bank + due - current, net3: bank + totalAR - allAP,
    };
  }, [d, mf]);

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
      </div>
      {err && <div className="flash flash-error">{err}</div>}

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

          <div className="mf-block">Future payables <span className="cp-edit">from the PDC Tracker</span></div>
          <p className="at-help cp-note" style={{ marginTop: 0 }}>Each item shows its next PDC that is not paid yet: the date, the name and the amount to pay. When you check it paid in the <Link to="/payables/pdc" className="pay-link-btn">PDC Tracker</Link>, the next month shows here. Add or change items there.</p>
          <ul className="cp-fro">
            {c.future.map((x) => (
              <li key={x.id}>
                <span className="cp-fdate">{x.date ? fdate(x.date, LONG) : `${x.month}/${x.year}`}</span>
                <span className="cp-fname">{x.label}</span>
                <b>{peso(x.amount)}</b>
              </li>
            ))}
            {c.future.length === 0 && <li className="at-empty">Nothing to pay yet. Add a future payable in the PDC Tracker.</li>}
          </ul>
          <div className="mf-row mf-sub" style={{ marginTop: 12 }}><span className="mf-lbl">Future payables total</span><span className="mf-val">{sgn(c.futureTotal)}</span></div>
          <div className="mf-row mf-sub mf-key"><span className="mf-lbl">Total payables incl. future</span><span className="mf-val">{peso(c.allAP)}</span></div>
        </section>
      </div>
    </div>
  );
}