import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { peso, fdate } from '../utils';
import MoneyInput, { rawNum } from '../MoneyInput';
import LongDateInput from '../LongDateInput';
import { computeMain } from '../mainCalc';
import { parsePaste } from '../pasteParse';

const num = (v) => Number(rawNum(v)) || 0;
const ymdLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const sgn = (n) => (n < 0 ? `−${peso(-n)}` : peso(n));

// server data -> editable strings
const toForm = (d) => ({
  passbook: d.passbook ? String(d.passbook) : '',
  deposit: d.deposit ? String(d.deposit) : '',
  aub: d.aub ? String(d.aub) : '',
  aub_label: d.aub_label || '',
  pull: d.pull.map((p) => ({ label: p.label, amount: p.amount ? String(p.amount) : '' })),
  checks: d.checks.map((c) => ({ id: c.id, name: c.name, amount: c.amount ? String(c.amount) : '' })),
  receivables_label: d.receivables_label || '',
  receivables_date: d.receivables_date || '',
  receivables: d.receivables ? String(d.receivables) : '',
});
const toData = (f) => ({
  passbook: num(f.passbook), deposit: num(f.deposit), aub: num(f.aub), aub_label: f.aub_label,
  pull: f.pull.map((p) => ({ label: p.label, amount: num(p.amount) })),
  checks: f.checks.map((c) => ({ id: c.id, name: c.name, amount: num(c.amount) })),
  receivables_label: f.receivables_label, receivables_date: f.receivables_date, receivables: num(f.receivables),
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
  const [find, setFind] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
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

  // Rows copied from Excel (name, date, amount) are saved to Running Payables as Paid + Released,
  // so they show up here in Released check monitoring with a Cleared button.
  async function importChecks(text) {
    const { rows: got, skipped } = parsePaste(text, ymdLocal());
    if (!got.length) { setNotice({ type: 'error', msg: 'Nothing to paste. Copy the rows from Excel (name, date, amount) and try again.' }); return false; }
    try {
      for (let i = 0; i < got.length; i += 100) {
        await api.addPayablesBulk(got.slice(i, i + 100).map((g) => ({ check_date: g.check_date, payee: g.payee, amount: g.amount, status: 'Paid', category: 'Other' })), true);
      }
      const r = await api.getMainFund();
      setLinked(r.released_payables || []); setRunning(r.running_payables); setRunningN(r.running_count);
      const sum = got.reduce((t, g) => t + Number(g.amount), 0);
      setNotice({ type: 'success', msg: `Pasted ${got.length} ${got.length === 1 ? 'check' : 'checks'} (${peso(sum)}). Saved to Running Payables as Paid and Released${skipped ? `; skipped ${skipped} without an amount` : ''}.` });
      return true;
    } catch (e) { setNotice({ type: 'error', msg: e.message }); return false; }
  }
  const importRef = useRef(importChecks);
  importRef.current = importChecks;
  useEffect(() => {
    function onPaste(e) {
      const text = e.clipboardData?.getData('text/plain') || '';
      if (e.target?.tagName === 'TEXTAREA') return; // the paste box handles its own text
      if (!/[\t\n]/.test(text.trim())) return; // single value: paste normally into the box
      if (!latest.current) return;
      e.preventDefault();
      importRef.current(text);
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  const calc = useMemo(() => (f ? computeMain(toData(f), linked, running) : null), [f, running, linked]);

  if (!f || !calc) {
    return (
      <div>
        <div className="page-header"><div><h1>Main</h1></div></div>
        {err ? <div className="flash flash-error">{err}</div> : <div className="empty-state">Loading…</div>}
      </div>
    );
  }

  async function clearLinked(c) {
    try {
      await api.clearReleasedPayable(c.id);
      setLinked((cur) => cur.filter((x) => x.id !== c.id));
      // the bank has now taken the money out, so the passbook balance drops by the same amount
      // (the "less: released checks" line no longer counts it, so available funds stay correct)
      edit((cur) => ({ passbook: String(Math.round((num(cur.passbook) - Number(c.amount || 0)) * 100) / 100) }));
      setNotice({ type: 'success', msg: `${c.payee} cleared. Passbook balance reduced by ${peso(c.amount)}.` });
    } catch (e) { setNotice({ type: 'error', msg: e.message }); }
  }
  const shownLinked = linked.filter((c) => c.payee.toLowerCase().includes(find.trim().toLowerCase()));
  const shown = f.checks.filter((c) => c.name.toLowerCase().includes(find.trim().toLowerCase()));

  return (
    <div className="mf">
      <div className="page-header">
        <div>
          <h1>Main</h1>
          <div className="subtitle">Cash fund{updated ? ` · last updated ${fdate(updated)}` : ''}</div>
        </div>
        <div className="dlc-right"><span className="dlc-badge" title="Demic Lab Main"><span className="dlc-a">DLC</span><span className="dlc-b">MAIN</span></span></div>
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
          <p className="at-help">Filled in automatically from Running Payables: every paid check marked <strong>Released</strong> shows here. Press Cleared once the bank clears it.</p>
          <div className="rec-paste mf-paste">
            <div className="rec-paste-text"><strong>Paste from Excel</strong><span>Copy the rows (name, date, amount), click anywhere on this page and press Ctrl+V. They are saved to Running Payables as Paid and Released.</span></div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPasteOpen((o) => !o)}>{pasteOpen ? 'Close' : 'Paste box'}</button>
          </div>
          {pasteOpen && (
            <div className="rec-paste-box mf-paste-box">
              <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Paste your Excel rows here (Ctrl+V)…" rows={6} autoFocus />
              <div className="rec-paste-actions">
                <button type="button" className="btn btn-sm" disabled={!pasteText.trim()} onClick={async () => { if (await importChecks(pasteText)) { setPasteText(''); setPasteOpen(false); } }}>Add to list</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setPasteText(''); setPasteOpen(false); }}>Cancel</button>
              </div>
            </div>
          )}
          {notice && <div className={`flash flash-${notice.type}`} style={{ margin: '0 0 10px' }}>{notice.msg}</div>}
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
            {f.checks.length + linked.length === 0 && <li className="at-empty">No released checks yet. Mark a paid payable as Released in Running Payables and it shows here.</li>}
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
            <input className="mf-lbl-in" value={f.aub_label} onChange={(e) => edit({ aub_label: e.target.value })} placeholder="AUB account (e.g. AUB 1051)" maxLength={60} aria-label="Account name" />
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
            <span className="mf-lbl">Receivables as of</span>
            <span className="mf-date"><LongDateInput value={f.receivables_date} onChange={(v) => edit({ receivables_date: v })} ariaLabel="Receivables date" /></span>
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