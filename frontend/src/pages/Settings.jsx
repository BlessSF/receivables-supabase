import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import LongDateInput from '../LongDateInput';
import { coveredPeriodForBilling, DEFAULT_COVERED_RULES, formatLongDate } from '../utils';

const I = {
  shield: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><ellipse cx="12" cy="5.5" rx="8" ry="3" /><path d="M4 5.5v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6M4 11.5v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></svg>,
  cal: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16.5" rx="2" /><path d="M3 10h18M8 2.5v4M16 2.5v4" /></svg>,
  clock: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  arrow: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  trash: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>,
};

function CardHead({ icon, title, children, tone = '' }) {
  return (
    <div className="st-head">
      <span className={`st-ic ${tone}`}>{icon}</span>
      <div><h2>{title}</h2><p>{children}</p></div>
    </div>
  );
}

function Switch({ checked, onChange, disabled, label, hint }) {
  return (
    <label className={`st-switch${disabled ? ' off' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="st-track" aria-hidden="true" />
      <span className="st-switch-text"><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
    </label>
  );
}

// Settings -> Backup: download the whole database (Excel to read, SQL to restore), see when it was last done.
function BackupPanel() {
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const load = () => api.getBackupInfo().then((r) => { setInfo(r.data); setErr(''); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  // download through fetch so a failure shows a message instead of a broken page, then refresh "last backup"
  async function download(format) {
    setBusy(format); setErr('');
    try {
      const res = await fetch(`/export_xlsx.php?type=backup&format=${format}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error((await res.text()) || 'Backup failed.');
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || `backup.${format === 'sql' ? 'sql' : 'xlsx'}`;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      await load();
      window.dispatchEvent(new Event('backup-done'));
    } catch (e) { setErr(e.message || 'Backup failed.'); }
    setBusy('');
  }

  const when = (iso) => new Date(iso).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const days = info?.days;
  const state = !info ? '' : days === null ? 'bad' : days >= 7 ? 'warn' : 'ok';
  const totalRows = (info?.tables || []).reduce((n, t) => n + t.rows, 0);

  return (
    <section className="st-card bk-panel" id="backup">
      <CardHead icon={I.shield} title="Backup" tone="teal">Download a copy of everything in the system. It only reads the data, nothing is changed. Keep a copy somewhere else too (Google Drive or another computer).</CardHead>
      {err && <div className="flash flash-error">{err}</div>}
      <div className={`bk-last ${state}`}>
        {!info ? 'Loading…' : info.last
          ? <><strong>Last backup: {when(info.last.at)}</strong><span>{days === 0 ? 'today' : `${days} ${days === 1 ? 'day' : 'days'} ago`} · {info.last.kind}{info.last.by ? ` · by ${info.last.by}` : ''}</span></>
          : <><strong>No backup yet</strong><span>Download one now.</span></>}
      </div>
      <div className="bk-grid">
        <div className="bk-card">
          <div className="bk-title">Excel copy</div>
          <p>One sheet per table. Easy to open and read. Password hashes are left out. Not for restoring.</p>
          <button type="button" className="btn" disabled={!!busy} onClick={() => download('xlsx')}>{busy === 'xlsx' ? 'Preparing…' : 'Download Excel'}</button>
        </div>
        <div className="bk-card">
          <div className="bk-title">Full backup (SQL)</div>
          <p>The whole database, exactly as it is. Used to restore everything. It contains user password hashes, so keep it private.</p>
          <button type="button" className="btn" disabled={!!busy} onClick={() => download('sql')}>{busy === 'sql' ? 'Preparing…' : 'Download SQL'}</button>
        </div>
      </div>
      {info && (
        <details className="bk-details">
          <summary>What is included · {info.tables.length} tables · {totalRows.toLocaleString('en-US')} rows</summary>
          <div className="bk-tables">{info.tables.map((t) => <span key={t.name}>{t.name} <b>{t.rows.toLocaleString('en-US')}</b></span>)}</div>
        </details>
      )}
      {info && info.log.length > 0 && (
        <details className="bk-details">
          <summary>Recent downloads</summary>
          <ul className="bk-log">{info.log.map((l, i) => <li key={i}><span>{when(l.at)}</span><span>{l.kind}</span><span>{l.by}</span></li>)}</ul>
        </details>
      )}
      <p className="bk-help" style={{ marginBottom: 0 }}>To restore: open the Supabase SQL Editor of an empty project, paste the SQL file and run it. Take a backup before any big clean-up.</p>
    </section>
  );
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// One end of a covered period: which month (relative to the billing date's month) and which day.
function PeriodEnd({ offset, day, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <select className="select-inline" value={offset} onChange={(e) => onChange({ offset: +e.target.value, day })}>
        <option value={-1}>Previous month</option>
        <option value={0}>Same month</option>
        <option value={1}>Next month</option>
      </select>
      <select className="select-inline" value={day} onChange={(e) => onChange({ offset, day: +e.target.value })}>
        <option value={0}>Last day</option>
        {Array.from({ length: 31 }, (_, k) => <option key={k + 1} value={k + 1}>Day {k + 1}</option>)}
      </select>
    </div>
  );
}

export default function Settings() {
  const { user } = useAuth();
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState(null);
  const [busy, setBusy] = useState(false);
  const [graceOn, setGraceOn] = useState(false);
  const [graceDays, setGraceDays] = useState('30');
  const [autoPeriod, setAutoPeriod] = useState(true);
  const [periodBusy, setPeriodBusy] = useState(false);
  const [rules, setRules] = useState(DEFAULT_COVERED_RULES);
  const [rulesBusy, setRulesBusy] = useState(false);
  const [tryDate, setTryDate] = useState('');
  const [tab, setTab] = useState(() => (window.location.hash === '#backup' ? 'backup' : 'period'));

  useEffect(() => {
    api.getSettings()
      .then((r) => {
        setGraceOn(!!r.data.aging_grace_enabled);
        setGraceDays(String(r.data.aging_grace_days > 0 ? r.data.aging_grace_days : 30));
        setAutoPeriod(r.data.auto_covered_period_enabled !== false);
        if (r.data.covered_period_rules) setRules(r.data.covered_period_rules);
        setLoaded(true);
      })
      .catch((e) => setErr(e.message));
  }, []);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setFlash(null);
    try {
      const r = await api.saveAgingSetting(graceOn, parseInt(graceDays, 10) || 0);
      setFlash({ type: 'success', msg: r.message });
    } catch (ex) {
      setFlash({ type: 'error', msg: ex.message });
    }
    setBusy(false);
  }

  async function savePeriod(next) {
    setAutoPeriod(next);
    setPeriodBusy(true);
    setFlash(null);
    try {
      const r = await api.saveCoveredPeriodSetting(next);
      setFlash({ type: 'success', msg: r.message });
    } catch (ex) {
      setAutoPeriod(!next);
      setFlash({ type: 'error', msg: ex.message });
    }
    setPeriodBusy(false);
  }

  const patchRule = (i, patch) => setRules((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const addRule = () => setRules((rs) => [...rs, { month: 0, day_from: 1, day_to: 31, from_offset: 0, from_day: 1, to_offset: 0, to_day: 0 }]);
  const removeRule = (i) => setRules((rs) => rs.filter((_, k) => k !== i));

  async function saveRules() {
    setRulesBusy(true);
    setFlash(null);
    try {
      const r = await api.saveCoveredPeriodRules(rules.map((x) => ({ ...x, month: +x.month, day_from: +x.day_from, day_to: +x.day_to, from_offset: +x.from_offset, from_day: +x.from_day, to_offset: +x.to_offset, to_day: +x.to_day })));
      setFlash({ type: 'success', msg: r.message });
    } catch (ex) {
      setFlash({ type: 'error', msg: ex.message });
    }
    setRulesBusy(false);
  }

  if (!user?.is_admin) return <div className="flash flash-error">Only an admin can open Settings.</div>;
  if (err) return <div className="flash flash-error">{err}</div>;
  if (!loaded) return <div className="loading-state">Loading…</div>;

  const days = parseInt(graceDays, 10) || 0;
  const numRules = rules.map((x) => ({ ...x, month: +x.month, day_from: +x.day_from, day_to: +x.day_to, from_offset: +x.from_offset, from_day: +x.from_day, to_offset: +x.to_offset, to_day: +x.to_day }));
  const TABS = [['period', 'Covered period', I.cal], ['aging', 'Aging & grace', I.clock], ['backup', 'Backup', I.shield]];

  return (
    <div className="st">
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <div className="subtitle">Rules that apply to the whole system</div>
        </div>
      </div>

      <div className="st-tabs" role="tablist">
        {TABS.map(([k2, label, icon]) => (
          <button key={k2} type="button" role="tab" aria-selected={tab === k2} className={`st-tab${tab === k2 ? ' active' : ''}`} onClick={() => { setTab(k2); setFlash(null); }}>
            <span className="st-tab-ic">{icon}</span>{label}
          </button>
        ))}
      </div>

      {flash && tab !== 'backup' && <div className={`flash flash-${flash.type}`}>{flash.msg}</div>}

      {tab === 'backup' && user.is_admin_role && <BackupPanel />}

      {tab === 'period' && (
        <>
          <section className="st-card">
            <CardHead icon={I.cal} title="Automatic covered period" tone="blue">
              The covered period is filled in from the billing date for imports, new Billing transactions and new Ledger entries. You can still change it by hand.
            </CardHead>
            <div className="st-row">
              <Switch checked={autoPeriod} disabled={periodBusy} onChange={savePeriod}
                label="Fill the covered period automatically"
                hint={autoPeriod ? 'On: worked out from the billing date using the rules below.' : 'Off: left for you to enter (imports use the period written on the SOA file).'} />
              <span className={`st-pill ${autoPeriod ? 'on' : 'off'}`}>{autoPeriod ? 'On' : 'Off'}</span>
            </div>
          </section>

          <section className="st-card">
            <CardHead icon={I.cal} title="How the covered period is worked out" tone="blue">
              Each rule reads: <em>when the billing date is in this month and on these days, the covered period runs from this → to this.</em> A rule for one specific month wins over an &quot;Every month&quot; rule, so use that for special months like February.
            </CardHead>
            <div className="table-wrap">
              <table className="data-table st-table">
                <thead>
                  <tr><th>Month</th><th>Billed on day</th><th>Covered from</th><th aria-hidden="true" /><th>Covered to</th><th aria-label="Remove" /></tr>
                </thead>
                <tbody>
                  {rules.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <select className="select-inline" value={r.month} onChange={(e) => patchRule(i, { month: +e.target.value })}>
                          <option value={0}>Every month</option>
                          {MONTH_NAMES.map((m, k2) => <option key={m} value={k2 + 1}>{m}</option>)}
                        </select>
                      </td>
                      <td>
                        <div className="st-days">
                          <input className="st-num" type="number" min="1" max="31" value={r.day_from} onChange={(e) => patchRule(i, { day_from: e.target.value })} aria-label="From day" />
                          <span>to</span>
                          <input className="st-num" type="number" min="1" max="31" value={r.day_to} onChange={(e) => patchRule(i, { day_to: e.target.value })} aria-label="To day" />
                        </div>
                      </td>
                      <td><PeriodEnd offset={r.from_offset} day={r.from_day} onChange={(p) => patchRule(i, { from_offset: p.offset, from_day: p.day })} /></td>
                      <td className="st-arrow">{I.arrow}</td>
                      <td><PeriodEnd offset={r.to_offset} day={r.to_day} onChange={(p) => patchRule(i, { to_offset: p.offset, to_day: p.day })} /></td>
                      <td><button type="button" className="st-del" onClick={() => removeRule(i)} aria-label="Remove rule" title="Remove rule">{I.trash}</button></td>
                    </tr>
                  ))}
                  {rules.length === 0 && <tr><td colSpan={6} className="empty-state">No rules: the covered period will be left blank.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="st-actions">
              <button type="button" className="btn btn-secondary" onClick={addRule}>+ Add rule</button>
              <button type="button" className="btn btn-secondary" onClick={() => setRules(DEFAULT_COVERED_RULES)}>Reset to default</button>
              <button type="button" className="btn st-save" disabled={rulesBusy} onClick={saveRules}>{rulesBusy ? 'Saving…' : 'Save rules'}</button>
            </div>

            <div className="st-try">
              <div className="st-try-title">Try a billing date</div>
              <div className="st-try-body">
                <LongDateInput value={tryDate} ariaLabel="Try a billing date" onChange={setTryDate} />
                {tryDate && (() => {
                  const cp = coveredPeriodForBilling(tryDate, numRules);
                  return cp
                    ? <span className="st-result">{formatLongDate(cp.from)} <i>to</i> {formatLongDate(cp.to)}</span>
                    : <span className="st-result none">No rule matches, so it is left blank</span>;
                })()}
              </div>
              <small>The preview uses the rules as shown above, even before you save them.</small>
            </div>
          </section>
        </>
      )}

      {tab === 'aging' && (
        <section className="st-card">
          <CardHead icon={I.clock} title="Aging & grace period" tone="amber">
            Aging counts the days an entry is overdue. The covered period is never used for aging.
          </CardHead>
          <form onSubmit={save}>
            <div className="st-row">
              <Switch checked={graceOn} onChange={setGraceOn} label="Use a grace period"
                hint={graceOn ? 'On: counting starts only after the grace days have passed.' : 'Off: counting starts on the billing date.'} />
              <span className={`st-pill ${graceOn ? 'on' : 'off'}`}>{graceOn ? 'On' : 'Off'}</span>
            </div>
            {graceOn && (
              <div className="st-grace">
                <label htmlFor="st-grace-days">Grace days</label>
                <input id="st-grace-days" className="st-num wide" type="number" min="1" step="1" value={graceDays} onChange={(e) => setGraceDays(e.target.value)} />
                <span>days after the billing date</span>
              </div>
            )}
            <div className="st-example">
              <strong>Example</strong>
              {graceOn
                ? `Billed July 15 → due after ${days} day${days === 1 ? '' : 's'}, so aging starts counting after that.`
                : 'Billed July 15 → aging counts from July 15 (on Oct 15 it shows 92 days).'}
            </div>
            <div className="st-actions"><button className="btn st-save" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
          </form>
        </section>
      )}
    </div>
  );
}