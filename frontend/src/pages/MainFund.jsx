import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { peso, fdate } from '../utils';
import MoneyInput, { rawNum } from '../MoneyInput';

const num = (v) => Number(rawNum(v)) || 0;
const uid = () => Math.random().toString(36).slice(2, 10);
const sgn = (n) => (n < 0 ? `−${peso(-n)}` : peso(n));

// server data -> editable strings
const toForm = (d) => ({
  passbook: d.passbook ? String(d.passbook) : '',
  deposit: d.deposit ? String(d.deposit) : '',
  aub: d.aub ? String(d.aub) : '',
  pull: d.pull.map((p) => ({ label: p.label, amount: p.amount ? String(p.amount) : '' })),
  checks: d.checks.map((c) => ({ id: c.id, name: c.name, amount: c.amount ? String(c.amount) : '' })),
  receivables_label: d.receivables_label || '',
  receivables: d.receivables ? String(d.receivables) : '',
});
const toData = (f) => ({
  passbook: num(f.passbook), deposit: num(f.deposit), aub: num(f.aub),
  pull: f.pull.map((p) => ({ label: p.label, amount: num(p.amount) })),
  checks: f.checks.map((c) => ({ id: c.id, name: c.name, amount: num(c.amount) })),
  receivables_label: f.receivables_label, receivables: num(f.receivables),
});

export default function MainFund() {
  const [f, setF] = useState(null);
  const [linked, setLinked] = useState([]); // paid + released payables from Running Payables
  const [notice, setNotice] = useState(null);
  const [running, setRunning] = useState(0);
  const [runningN, setRunningN] = useState(0);
  const [updated, setUpdated] = useState(null);
  const [state, setState] = useState('idle'); // idle | saving | saved | error
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const [amt, setAmt] = useState('');
  const [find, setFind] = useState('');
  const dirty = useRef(false);
  const timer = useRef(null);
  const latest = useRef(null);

  useEffect(() => {
    api.getMainFund()
      .then((r) => { setF(toForm(r.data)); setRunning(r.running_payables); setRunningN(r.running_count); setLinked(r.released_payables || []); setUpdated(r.data.updated_at); })
      .catch((e) => { setErr(e.message); setState('error'); });
  }, []);

  // every change is saved automatically a moment after you stop typing
  latest.current = f;
  function edit(patch) {
    setF((cur) => ({ ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) }));
    dirty.current = true; setState('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 800);
  }
  async function flush() {
    if (!dirty.current || !latest.current) return;
    dirty.current = false;
    try {
      const r = await api.saveMainFund(toData(latest.current));
      setUpdated(r.data.updated_at); setErr('');
      setState(dirty.current ? 'saving' : 'saved');
    } catch (e) { setErr(e.message || 'Could not save.'); setState('error'); dirty.current = true; }
  }
  useEffect(() => () => { clearTimeout(timer.current); if (dirty.current) flush(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const calc = useMemo(() => {
    if (!f) return null;
    // a typed check that is the same payee + amount as a released payable is not counted twice
    const key = (n, a) => `${String(n).trim().toLowerCase()}|${Number(a).toFixed(2)}`;
    const linkedKeys = new Set(linked.map((c) => key(c.payee, c.amount)));
    const dupIds = new Set(f.checks.filter((c) => linkedKeys.has(key(c.name, num(c.amount)))).map((c) => c.id));
    const linkedTotal = linked.reduce((t, c) => t + c.amount, 0);
    const manualTotal = f.checks.reduce((t, c) => (dupIds.has(c.id) ? t : t + num(c.amount)), 0);
    const checksTotal = linkedTotal + manualTotal;
    const checksCount = linked.length + f.checks.length - dupIds.size;
    const available = num(f.passbook) - checksTotal;
    const excess = available + num(f.deposit) - running;
    const pulls = f.pull.reduce((t, p) => t + num(p.amount), 0);
    const after = num(f.aub) + excess - pulls;
    const total = after + num(f.receivables);
    return { checksTotal, checksCount, dupIds, linkedKeys, available, excess, pulls, after, total };
  }, [f, running, linked]);

  if (!f || !calc) {
    return (
      <div>
        <div className="page-header"><div><h1>Main</h1></div></div>
        {err ? <div className="flash flash-error">{err}</div> : <div className="empty-state">Loading…</div>}
      </div>
    );
  }

  function addCheck(e) {
    e.preventDefault();
    if (!name.trim() && !amt) return;
    const k = `${name.trim().toLowerCase()}|${num(amt).toFixed(2)}`;
    const exists = calc.linkedKeys.has(k) || f.checks.some((c) => `${c.name.trim().toLowerCase()}|${num(c.amount).toFixed(2)}` === k);
    if (exists) { setNotice({ type: 'error', msg: `"${name.trim()}" for ${peso(num(amt))} is already in the list.` }); return; }
    setNotice(null);
    edit((cur) => ({ checks: [...cur.checks, { id: uid(), name: name.trim().toUpperCase(), amount: amt }] }));
    setName(''); setAmt('');
  }
  async function clearLinked(c) {
    try {
      await api.clearReleasedPayable(c.id);
      setLinked((cur) => cur.filter((x) => x.id !== c.id));
      setNotice({ type: 'success', msg: `${c.payee} marked cleared and removed from the list.` });
    } catch (e) { setNotice({ type: 'error', msg: e.message }); }
  }
  const shownLinked = linked.filter((c) => c.payee.toLowerCase().includes(find.trim().toLowerCase()));
  const shown = f.checks.filter((c) => c.name.toLowerCase().includes(find.trim().toLowerCase()));

  return (
    <div className="mf">
      <div className="page-header">
        <div>
          <h1>Main</h1>
          <div className="subtitle">Demic Lab Main · cash fund{updated ? ` · last updated ${fdate(updated)}` : ''}</div>
        </div>
        <span className={`at-status mf-state ${state}`}>
          {state === 'saving' ? 'Saving…' : state === 'error' ? 'Not saved' : 'Saved automatically'}
        </span>
      </div>
      {state === 'error' && err && <div className="flash flash-error">{err}</div>}

      <div className="mf-hero">
        <div className="mf-card mf-card-main">
          <div className="mf-card-label">Total net fund</div>
          <div className="mf-card-value">{sgn(calc.total)}</div>
          <div className="mf-card-sub">Cashflow after pull out + receivables</div>
        </div>
        <div className="mf-card">
          <div className="mf-card-label">Excess fund · Security Bank</div>
          <div className={`mf-card-value ${calc.excess < 0 ? 'neg' : ''}`}>{sgn(calc.excess)}</div>
          <div className="mf-card-sub">after released checks and running payables</div>
        </div>
        <div className="mf-card">
          <div className="mf-card-label">Cashflow after pull out</div>
          <div className={`mf-card-value ${calc.after < 0 ? 'neg' : ''}`}>{sgn(calc.after)}</div>
          <div className="mf-card-sub">AUB + excess fund − pull outs</div>
        </div>
        <div className="mf-card">
          <div className="mf-card-label">Released checks</div>
          <div className="mf-card-value">{peso(calc.checksTotal)}</div>
          <div className="mf-card-sub">{calc.checksCount} {calc.checksCount === 1 ? 'check' : 'checks'} not yet cleared</div>
        </div>
      </div>

      <div className="mf-grid">
        <section className="panel mf-checks">
          <div className="mf-head">
            <h2>Released check monitoring</h2>
            <span className="at-count">{calc.checksCount}</span>
          </div>
          <p className="at-help">Checks already released but not yet cleared by the bank. Paid payables marked Released in Running Payables appear here by themselves. Remove a check once it clears.</p>
          {notice && <div className={`flash flash-${notice.type}`} style={{ margin: '0 0 10px' }}>{notice.msg}</div>}
          <form className="mf-add" onSubmit={addCheck}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Payee, e.g. CONVERGE" maxLength={160} />
            <MoneyInput value={amt} onChange={setAmt} placeholder="0.00" />
            <button type="submit" className="btn">Add</button>
          </form>
          {f.checks.length + linked.length > 8 && <input className="at-find" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search checks…" />}
          <ul className="mf-list">
            {shownLinked.map((c) => (
              <li key={`p${c.id}`} className="mf-linked">
                <span className="mf-linkname"><span>{c.payee}</span><span className="mf-tag" title="Paid and marked Released in Running Payables">Running Payables</span></span>
                <span className="mf-linkamt">{peso(c.amount)}</span>
                <button type="button" className="btn btn-secondary btn-sm mf-clear" onClick={() => clearLinked(c)} title="The bank cleared this check: remove it from this list">Cleared</button>
              </li>
            ))}
            {shown.map((c) => (
              <li key={c.id} className={calc.dupIds.has(c.id) ? 'mf-dup' : ''} title={calc.dupIds.has(c.id) ? 'Already counted from Running Payables, so not added again' : undefined}>
                <input className="mf-name" value={c.name} onChange={(e) => edit((cur) => ({ checks: cur.checks.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)) }))} aria-label="Payee" />
                <MoneyInput className="mf-amt" value={c.amount} onChange={(v) => edit((cur) => ({ checks: cur.checks.map((x) => (x.id === c.id ? { ...x, amount: v } : x)) }))} aria-label="Amount" />
                <button type="button" className="at-x" onClick={() => edit((cur) => ({ checks: cur.checks.filter((x) => x.id !== c.id) }))} aria-label="Remove check" title="Remove">×</button>
              </li>
            ))}
            {f.checks.length + linked.length === 0 && <li className="at-empty">No released checks. Mark a paid payable as Released, or add one above.</li>}
            {f.checks.length + linked.length > 0 && shown.length + shownLinked.length === 0 && <li className="at-empty">No match.</li>}
          </ul>
          <div className="mf-total"><span>Total released checks</span><strong>{peso(calc.checksTotal)}</strong></div>
        </section>

        <section className="panel mf-stmt">
          <div className="mf-block">Operations · Security Bank</div>
          <div className="mf-row">
            <span className="mf-lbl">Passbook balance</span>
            <MoneyInput className="mf-in" value={f.passbook} onChange={(v) => edit({ passbook: v })} placeholder="0.00" />
          </div>
          <div className="mf-row mf-auto">
            <span className="mf-lbl">Less: released checks <i>auto</i></span>
            <span className="mf-val">{sgn(-calc.checksTotal)}</span>
          </div>
          <div className="mf-row mf-sub">
            <span className="mf-lbl">Available funds</span>
            <span className="mf-val">{sgn(calc.available)}</span>
          </div>
          <div className="mf-row">
            <span className="mf-lbl">Add: sales deposit in transit</span>
            <MoneyInput className="mf-in" value={f.deposit} onChange={(v) => edit({ deposit: v })} placeholder="0.00" />
          </div>
          <div className="mf-row mf-auto">
            <span className="mf-lbl">Less: running payables <i>auto</i> <Link to="/payables/running" className="pay-link-btn">{runningN} unpaid</Link></span>
            <span className="mf-val">{sgn(-running)}</span>
          </div>
          <div className="mf-row mf-sub mf-key">
            <span className="mf-lbl">Excess fund · Security Bank</span>
            <span className={`mf-val ${calc.excess < 0 ? 'neg' : ''}`}>{sgn(calc.excess)}</span>
          </div>

          <div className="mf-block">AUB</div>
          <div className="mf-row">
            <span className="mf-lbl">AUB account balance</span>
            <MoneyInput className="mf-in" value={f.aub} onChange={(v) => edit({ aub: v })} placeholder="0.00" />
          </div>

          <div className="mf-block">Fund for pull out</div>
          {f.pull.map((p, i) => (
            <div className="mf-row" key={i}>
              <input className="mf-lbl-in" value={p.label} onChange={(e) => edit((cur) => ({ pull: cur.pull.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) }))} placeholder="Other" aria-label="Label" />
              <MoneyInput className="mf-in" value={p.amount} onChange={(v) => edit((cur) => ({ pull: cur.pull.map((x, j) => (j === i ? { ...x, amount: v } : x)) }))} placeholder="0.00" />
            </div>
          ))}
          <div className="mf-row mf-sub mf-key">
            <span className="mf-lbl">Cashflow after pull out</span>
            <span className={`mf-val ${calc.after < 0 ? 'neg' : ''}`}>{sgn(calc.after)}</span>
          </div>

          <div className="mf-block">Add</div>
          <div className="mf-row">
            <input className="mf-lbl-in" value={f.receivables_label} onChange={(e) => edit({ receivables_label: e.target.value })} placeholder="Receivables (e.g. Oct 25, 2026)" aria-label="Receivables label" />
            <MoneyInput className="mf-in" value={f.receivables} onChange={(v) => edit({ receivables: v })} placeholder="0.00" />
          </div>
          <div className="mf-row mf-final">
            <span className="mf-lbl">Total net fund</span>
            <span className="mf-val">{sgn(calc.total)}</span>
          </div>
        </section>
      </div>
    </div>
  );
}