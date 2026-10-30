import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import LongDateInput from '../LongDateInput';
import { coveredPeriodForBilling, DEFAULT_COVERED_RULES, formatLongDate } from '../utils';

// Settings -> Backup: download the whole database (Excel to read, SQL to restore), see when it was last done.
function BackupPanel() {
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const load = () => api.getBackupInfo().then((r) => { setInfo(r.data); setErr(''); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  useEffect(() => { if (info && window.location.hash === '#backup') document.getElementById('backup')?.scrollIntoView(); }, [!!info]); // eslint-disable-line react-hooks/exhaustive-deps

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
    <div className="panel bk-panel" id="backup">
      <h2>Backup</h2>
      <p className="bk-help">Download a copy of everything in the system. It only reads the data, nothing is changed. Keep a copy somewhere else too (Google Drive or another computer).</p>
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
    </div>
  );
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// One end of a covered period: which month (relative to the billing date's month) and which day.
function PeriodEnd({ offset, day, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <select value={offset} onChange={(e) => onChange({ offset: +e.target.value, day })}>
        <option value={-1}>Previous month</option>
        <option value={0}>Same month</option>
        <option value={1}>Next month</option>
      </select>
      <select value={day} onChange={(e) => onChange({ offset, day: +e.target.value })}>
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

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <div className="subtitle">Rules that apply to the whole system</div>
        </div>
      </div>

      {flash && <div className={`flash flash-${flash.type}`}>{flash.msg}</div>}

      {user.is_admin_role && <BackupPanel />}

      <div className="panel">
        <h2>Automatic Covered Period</h2>
        <p style={{ fontSize: 13, color: 'var(--slate)', margin: '-6px 0 16px', maxWidth: 640 }}>
          When <strong>on</strong>, the covered period is filled in from the billing date: imports, new Billing transactions and new Ledger entries.
          You can still change it by hand. When <strong>off</strong>, the covered period is left for you to enter (imports use the period written on the SOA file).
        </p>
        <label className="check">
          <input type="checkbox" checked={autoPeriod} disabled={periodBusy} onChange={(e) => savePeriod(e.target.checked)} />
          Fill the covered period automatically from the billing date
        </label>
        <h3 style={{ fontSize: 14, margin: '22px 0 6px' }}>How the covered period is worked out</h3>
        <p style={{ fontSize: 12.5, color: 'var(--slate)', margin: '0 0 12px', maxWidth: 720 }}>
          Each rule reads: <em>when the billing date is in this month and on these days, the covered period is this → this.</em>{' '}
          A rule for one specific month wins over an &quot;Every month&quot; rule, so use that for special months like February.
        </p>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Month</th><th>Billed on day</th><th>Covered from</th><th>Covered to</th><th></th></tr>
            </thead>
            <tbody>
              {rules.map((r, i) => (
                <tr key={i}>
                  <td>
                    <select value={r.month} onChange={(e) => patchRule(i, { month: +e.target.value })}>
                      <option value={0}>Every month</option>
                      {MONTH_NAMES.map((m, k) => <option key={m} value={k + 1}>{m}</option>)}
                    </select>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input type="number" min="1" max="31" style={{ width: 64 }} value={r.day_from} onChange={(e) => patchRule(i, { day_from: e.target.value })} />
                      <span>to</span>
                      <input type="number" min="1" max="31" style={{ width: 64 }} value={r.day_to} onChange={(e) => patchRule(i, { day_to: e.target.value })} />
                    </div>
                  </td>
                  <td><PeriodEnd offset={r.from_offset} day={r.from_day} onChange={(p) => patchRule(i, { from_offset: p.offset, from_day: p.day })} /></td>
                  <td><PeriodEnd offset={r.to_offset} day={r.to_day} onChange={(p) => patchRule(i, { to_offset: p.offset, to_day: p.day })} /></td>
                  <td><button type="button" className="btn btn-danger btn-sm" onClick={() => removeRule(i)}>Remove</button></td>
                </tr>
              ))}
              {rules.length === 0 && <tr><td colSpan={5} className="empty-state">No rules: the covered period will be left blank.</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '14px 0' }}>
          <button type="button" className="btn btn-secondary" onClick={addRule}>+ Add rule</button>
          <button type="button" className="btn btn-secondary" onClick={() => setRules(DEFAULT_COVERED_RULES)}>Reset to default</button>
          <button type="button" className="btn" disabled={rulesBusy} onClick={saveRules}>{rulesBusy ? 'Saving…' : 'Save rules'}</button>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 13.5 }}>
          <span>Try a billing date:</span>
          <LongDateInput value={tryDate} ariaLabel="Try a billing date" onChange={setTryDate} />
          {tryDate && (() => {
            const cp = coveredPeriodForBilling(tryDate, rules.map((x) => ({ ...x, month: +x.month, day_from: +x.day_from, day_to: +x.day_to, from_offset: +x.from_offset, from_day: +x.from_day, to_offset: +x.to_offset, to_day: +x.to_day })));
            return <strong>{cp ? `→ ${formatLongDate(cp.from)} to ${formatLongDate(cp.to)}` : '→ no rule matches (left blank)'}</strong>;
          })()}
        </div>
        <p style={{ fontSize: 12, color: 'var(--slate)', marginTop: 8 }}>The preview uses the rules as shown above, even before you save them.</p>
      </div>

      <div className="panel">
        <h2>Aging &amp; Grace Period</h2>
        <p style={{ fontSize: 13, color: 'var(--slate)', margin: '-6px 0 16px', maxWidth: 640 }}>
          Aging counts the days an entry is overdue. With the grace period <strong>off</strong>, counting starts on the billing date.
          With it <strong>on</strong>, counting starts only after the grace days have passed. The covered period is never used for aging.
        </p>
        <form onSubmit={save}>
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label className="check">
              <input type="checkbox" checked={graceOn} onChange={(e) => setGraceOn(e.target.checked)} />
              Use a grace period
            </label>
            {graceOn && (
              <div className="form-group" style={{ minWidth: 150, margin: 0 }}>
                <label>Grace days</label>
                <input type="number" min="1" step="1" value={graceDays} onChange={(e) => setGraceDays(e.target.value)} />
              </div>
            )}
            <button className="btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
        <p style={{ fontSize: 12.5, color: 'var(--slate)', marginTop: 14 }}>
          {graceOn
            ? `Example: billed July 15 → due after ${days} day${days === 1 ? '' : 's'}, so aging starts counting after that.`
            : 'Example: billed July 15 → aging counts from July 15 (on Oct 15 it shows 92 days).'}
        </p>
      </div>
    </div>
  );
}