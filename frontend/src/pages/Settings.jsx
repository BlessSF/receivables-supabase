import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';

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

  useEffect(() => {
    api.getSettings()
      .then((r) => {
        setGraceOn(!!r.data.aging_grace_enabled);
        setGraceDays(String(r.data.aging_grace_days > 0 ? r.data.aging_grace_days : 30));
        setAutoPeriod(r.data.auto_covered_period_enabled !== false);
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
        <p style={{ fontSize: 12.5, color: 'var(--slate)', marginTop: 14 }}>
          Billed on the 16th–31st → the 1st–15th of the same month (Jan 30 → Jan 1 – Jan 15).<br />
          Billed on the 1st–15th → the 16th–end of the previous month (Feb 15 → Jan 16 – Jan 31).
        </p>
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