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
const dayBefore = (ymd) => { if (!ymd) return ''; const [y, m, d] = ymd.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d - 1)); return t.toISOString().slice(0, 10); };
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

// One saved day, opened from the History list: its figures laid out like the Main page, the change against the
// day before, and (for recent days) which payables were running and which checks were out.
function DayOverview({ history, date, todayD, onClose, onPick }) {
  const idx = history.findIndex((x) => x.d === date);
  const h = history[idx];
  const prev = idx > 0 ? history[idx - 1] : null;
  const next = idx >= 0 && idx < history.length - 1 ? history[idx + 1] : null;
  const [det, setDet] = useState(undefined); // undefined = loading, null = not saved for that day
  useEffect(() => {
    let live = true;
    setDet(undefined);
    api.getMainDay(date).then((r) => { if (live) setDet(r.detail || null); }).catch(() => { if (live) setDet(null); });
    return () => { live = false; };
  }, [date]);
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  if (!h) return null;

  const long = new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const tag = date === todayD ? 'Today' : date === dayBefore(todayD) ? 'Yesterday' : '';
  const chg = (key, kind) => {
    if (!prev) return null;
    const diff = Math.round((Number(h[key] || 0) - Number(prev[key] || 0)) * 100) / 100;
    if (!diff) return <span className="mf-chg same">—</span>;
    const good = (diff > 0) === (kind === 'fund');
    return <span className={`mf-chg ${good ? 'good' : 'bad'}`}>{diff > 0 ? '▲' : '▼'} {peso(Math.abs(diff))}</span>;
  };
  const Line = ({ label, value, k, kind = 'fund', sub, strong, minus }) => (
    <div className={`mf-dl${strong ? ' strong' : ''}`}>
      <span className="mf-dl-lbl">{label}{sub ? <small>{sub}</small> : null}</span>
      <span className="mf-dl-val">{minus ? sgn(-value) : sgn(value)}</span>
      <span className="mf-dl-chg">{k ? chg(k, kind) : null}</span>
    </div>
  );
  const Group = ({ title, children }) => <div className="mf-dgrp"><div className="mf-dgrp-t">{title}</div>{children}</div>;
  const List = ({ title, rows, total, empty, tagManual }) => (
    <div className="mf-dlist">
      <div className="mf-dlist-t"><span>{title}</span><b>{rows ? rows.length : 0}</b></div>
      {rows && rows.length > 0 ? (
        <>
          <ul>{rows.map((r, i) => (
            <li key={i}><span className="mf-dp">{r.p}{tagManual && r.manual ? <i>typed</i> : null}{r.d ? <small>{fdate(r.d)}</small> : null}</span><span className="num">{peso(r.a)}</span></li>
          ))}</ul>
          <div className="mf-dlist-sum"><span>Total</span><strong>{peso(total)}</strong></div>
        </>
      ) : <div className="mf-dempty">{empty}</div>}
    </div>
  );
  const runRows = det?.running || [];
  const relRows = det ? [...(det.released || []), ...(det.manual || []).map((m) => ({ ...m, manual: true }))] : [];

  return (
    <div className="pm-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pm-card mf-day" role="dialog" aria-label={`Overview for ${long}`}>
        <div className="mf-day-head">
          <div>
            <div className="mf-day-kicker">Overview{tag ? ` · ${tag}` : ''}</div>
            <h3>{long}</h3>
            <div className="mf-day-sub">{prev ? `Changes are against ${fdate(prev.d)}.` : 'First saved day, nothing earlier to compare with.'}</div>
          </div>
          <button type="button" className="mf-day-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="mf-day-body">
          <Group title="Operations · Security Bank">
            <Line label="Passbook balance" value={h.passbook} k="passbook" />
            <Line label="Less: released checks" sub={`${h.checks_n} ${h.checks_n === 1 ? 'check' : 'checks'}`} value={h.checks} k="checks" kind="debt" minus />
            <Line label="Available funds" value={h.available} k="available" strong />
            <Line label="Add: sales deposit in transit" value={h.deposit} k="deposit" />
            <Line label="Less: running payables" sub={`${h.running_n} unpaid`} value={h.running} k="running" kind="debt" minus />
            <Line label="Excess fund · Security Bank" value={h.excess} k="excess" strong />
          </Group>
          <Group title="AUB">
            <Line label={det?.aub_label || 'AUB balance'} value={h.aub} k="aub" />
          </Group>
          <Group title="Fund for pull out">
            {(det?.pull || []).map((p, i) => <Line key={i} label={p.l || 'Other'} value={p.a} minus />)}
            <Line label="Total pull outs" value={h.pulls} k="pulls" kind="debt" minus />
            <Line label="Cashflow after pull out" value={h.after} k="after" strong />
          </Group>
          <Group title="Add">
            <Line label="Receivables" sub={det?.receivables_date ? `as of ${fdate(det.receivables_date)}` : ''} value={h.receivables} k="receivables" />
          </Group>
          <div className="mf-dtotal"><span>Total net fund</span><strong>{sgn(h.total)}</strong><span className="mf-dl-chg">{chg('total', 'fund')}</span></div>
        </div>

        <div className="mf-day-lists">
          {det === undefined ? <div className="mf-dempty">Loading details…</div> : det === null ? (
            <div className="mf-dempty wide">The list of payables and checks was not saved for this day, only the totals above.</div>
          ) : (
            <>
              <List title="Running payables that day (unpaid)" rows={runRows} total={h.running} empty="No unpaid payables." />
              <List title="Released checks not yet cleared" rows={relRows} total={h.checks} empty="No released checks." tagManual />
            </>
          )}
        </div>

        <div className="mf-day-foot">
          <button type="button" className="btn btn-secondary btn-sm" disabled={!prev} onClick={() => prev && onPick(prev.d)}>‹ {prev ? fdate(prev.d) : 'Older'}</button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={!next} onClick={() => next && onPick(next.d)}>{next ? fdate(next.d) : 'Newer'} ›</button>
        </div>
      </div>
    </div>
  );
}

export default function MainFund() {
  const [f, setF] = useState(null);
  const [linked, setLinked] = useState([]); // paid + released payables from Running Payables
  const [notice, setNotice] = useState(null);
  const [running, setRunning] = useState(0);
  const [runningN, setRunningN] = useState(0);
  const [updated, setUpdated] = useState(null);
  const [history, setHistory] = useState([]); // one saved row per day, newest last
  const [viewDay, setViewDay] = useState(null); // date opened in the day overview
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
      .then((r) => { setF(toForm(r.data)); setRunning(r.running_payables); setRunningN(r.running_count); setLinked(r.released_payables || []); setUpdated(r.data.updated_at); setHistory(r.history || []); })
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
      setUpdated(r.data.updated_at); setErr(''); if (r.history) setHistory(r.history);
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

      {(() => {
        // today (live numbers on screen) against the last day saved before today
        const todayD = history.length ? history[history.length - 1].d : null;
        const prev = history.length > 1 ? history[history.length - 2] : null;
        const items = [
          ['Total net fund', 'total', calc.total, 'fund'],
          ['Excess fund · Security Bank', 'excess', calc.excess, 'fund'],
          ['Cashflow after pull out', 'after', calc.after, 'fund'],
          ['Passbook balance', 'passbook', num(f.passbook), 'fund'],
          ['Running payables (unpaid)', 'running', running, 'debt', runningN, prev?.running_n, 'unpaid'],
          ['Released checks', 'checks', calc.checksTotal, 'debt', calc.checksCount, prev?.checks_n, 'checks'],
          ['Receivables', 'receivables', num(f.receivables), 'fund'],
        ];
        const tone = (diff, kind) => (Math.abs(diff) < 0.005 ? 'same' : (diff > 0) === (kind === 'fund') ? 'good' : 'bad');
        const days = [...history].reverse().slice(0, 30);
        return (
          <section className="panel mf-hist">
            <div className="mf-head">
              <h2>Today vs {prev ? (prev.d === dayBefore(todayD) ? 'yesterday' : fdate(prev.d)) : 'yesterday'}</h2>
              <span className="mf-hist-note">Figures are saved automatically each day, so you can look back.</span>
            </div>
            {!prev ? (
              <div className="at-empty" style={{ padding: '14px 4px' }}>History starts today. Tomorrow you will see how today compares with the day before.</div>
            ) : (
              <div className="table-wrap">
                <table className="data-table mf-cmp">
                  <thead><tr><th>Item</th><th className="text-right">{fdate(prev.d)}</th><th className="text-right">Today{todayD ? ` · ${fdate(todayD)}` : ''}</th><th className="text-right">Change</th></tr></thead>
                  <tbody>
                    {items.map(([label, key, now, kind, nowN, prevN, unit]) => {
                      const before = Number(prev[key] || 0);
                      const diff = Math.round((now - before) * 100) / 100;
                      return (
                        <tr key={key}>
                          <td>{label}</td>
                          <td className="num text-right">{sgn(before)}{unit && prevN !== undefined ? <small className="mf-cnt"> · {prevN} {unit}</small> : null}</td>
                          <td className="num text-right"><strong>{sgn(now)}</strong>{unit ? <small className="mf-cnt"> · {nowN} {unit}</small> : null}</td>
                          <td className="num text-right"><span className={`mf-chg ${tone(diff, kind)}`}>{diff === 0 ? 'no change' : `${diff > 0 ? '▲' : '▼'} ${peso(Math.abs(diff))}`}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {history.length > 0 && (
              <details className="mf-hist-list">
                <summary>History · last {days.length} {days.length === 1 ? 'day' : 'days'}</summary>
                <div className="table-wrap">
                  <table className="data-table mf-cmp">
                    <thead><tr><th>Date</th><th className="text-right">Total net fund</th><th className="text-right">Change</th><th className="text-right">Excess fund</th><th className="text-right">Running payables</th><th className="text-right">Released checks</th><th aria-label="View" /></tr></thead>
                    <tbody>
                      {days.map((h, i) => {
                        const before = days[i + 1];
                        const diff = before ? Math.round((h.total - before.total) * 100) / 100 : null;
                        return (
                          <tr key={h.d}>
                            <td className="nowrap">{fdate(h.d)}{i === 0 && h.d === todayD ? <span className="mf-today">Today</span> : null}</td>
                            <td className="num text-right">{sgn(h.total)}</td>
                            <td className="num text-right">{diff === null ? '—' : <span className={`mf-chg ${tone(diff, 'fund')}`}>{diff === 0 ? 'no change' : `${diff > 0 ? '▲' : '▼'} ${peso(Math.abs(diff))}`}</span>}</td>
                            <td className="num text-right">{sgn(h.excess)}</td>
                            <td className="num text-right">{peso(h.running)}</td>
                            <td className="num text-right">{peso(h.checks)}</td>
                            <td className="text-right"><button type="button" className="btn btn-secondary btn-sm" onClick={() => setViewDay(h.d)}>View</button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </section>
        );
      })()}

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
      {viewDay && <DayOverview history={history} date={viewDay} todayD={history.length ? history[history.length - 1].d : null} onClose={() => setViewDay(null)} onPick={setViewDay} />}
    </div>
  );
}