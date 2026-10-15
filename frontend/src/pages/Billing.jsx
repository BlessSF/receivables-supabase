import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import LongDateInput from '../LongDateInput';
import { peso, fdate, coveredLabel, coveredPeriodForBilling, DEFAULT_COVERED_RULES } from '../utils';

function todayLocal() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// Covered period always follows the billing date (see coveredPeriodForBilling)
const periodFor = (date, auto = true, rules = DEFAULT_COVERED_RULES) => {
  const cp = auto ? coveredPeriodForBilling(date, rules) : null;
  return { period_from: cp ? cp.from : '', period_to: cp ? cp.to : '' };
};

const blank = (auto = true, rules) => ({
  id: null, txn_date: todayLocal(), ...periodFor(todayLocal(), auto, rules), soa_number: '', amount: '',
  hmo_id: '', company_id: '', bill_to: 'HMO', remarks: '',
});

const MAX_SOA_BYTES = 3 * 1024 * 1024;

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

// Which amount the import bills: the Total Amount Due on the SOA (default) or only the Current Amount Due.
const pickAmount = (it, basis) => {
  const v = basis === 'current' ? (it.current_due ?? it.total_due) : (it.total_due ?? it.current_due);
  return v === null || v === undefined ? '' : String(v);
};

const STATUS_BADGE = { OPEN: 'badge-warning', POSTED: 'badge-success', VOID: 'badge-secondary' };

export default function Billing() {
  const [rows, setRows] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState(null); // null = hidden
  const [filter, setFilter] = useState('OPEN');
  const [flash, setFlash] = useState(null);
  const [busy, setBusy] = useState(false);
  const [params, setParams] = useSearchParams();
  // SOA import: null = closed, otherwise { items, basis, reading, importing }
  const [imp, setImp] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [periodRules, setPeriodRules] = useState(DEFAULT_COVERED_RULES);
  const [autoPeriod, setAutoPeriod] = useState(true); // Settings switch: covered period follows the billing date
  const fileInput = useRef(null);

  function load() { api.getBilling().then((r) => setRows(r.data)).catch((e) => setFlash({ type: 'error', msg: e.message })); }
  useEffect(() => {
    load();
    api.getCompanies().then((r) => setAccounts(r.data));
    api.getSettings().then((r) => { setAutoPeriod(r.data.auto_covered_period_enabled !== false); if (r.data.covered_period_rules) setPeriodRules(r.data.covered_period_rules); }).catch(() => {});
    // Arrived from the HMOs page ("+ New Charge"): open a transaction with that HMO already chosen.
    const pre = params.get('hmo_id');
    if (pre) {
      setForm({ ...blank(autoPeriod, periodRules), hmo_id: pre });
      setParams({}, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hmos = useMemo(() => accounts.filter((a) => a.account_type === 'HMO'), [accounts]);

  const shown = useMemo(() => {
    if (!rows) return null;
    return filter === 'ALL' ? rows : rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  const counts = useMemo(() => {
    const c = { OPEN: 0, POSTED: 0, VOID: 0 };
    (rows || []).forEach((r) => { c[r.status] = (c[r.status] || 0) + 1; });
    return c;
  }, [rows]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function save(andPost) {
    if (!form.hmo_id) { setFlash({ type: 'error', msg: 'Choose an HMO.' }); return; }
    if (andPost && !(Number(form.amount) > 0)) { setFlash({ type: 'error', msg: 'Enter an amount greater than zero to post.' }); return; }
    setBusy(true);
    try {
      const r = await api.saveBilling(form);
      let msg = r.message;
      if (andPost) {
        const p = await api.postBilling(r.id);
        msg = p.message;
      }
      setFlash({ type: 'success', msg });
      setForm(null);
      load();
    } catch (e) {
      setFlash({ type: 'error', msg: e.message });
      load();
    }
    setBusy(false);
  }

  async function post(r) {
    const target = r.bill_to === 'COMPANY' ? r.company_name : r.hmo_name;
    if (!confirm(`Post ${peso(r.amount)} to ${target}'s ledger?`)) return;
    try {
      const res = await api.postBilling(r.id);
      setFlash({ type: 'success', msg: res.message });
      load();
    } catch (e) { setFlash({ type: 'error', msg: e.message }); }
  }

  async function voidTxn(r) {
    const extra = r.status === 'POSTED' ? ' Its charge will be removed from the ledger.' : '';
    if (!confirm(`Void this transaction?${extra}`)) return;
    try {
      const res = await api.voidBilling(r.id);
      setFlash({ type: 'success', msg: res.message });
      load();
    } catch (e) { setFlash({ type: 'error', msg: e.message }); }
  }

  function edit(r) {
    setFlash(null);
    setForm({
      id: r.id, txn_date: r.txn_date || todayLocal(), period_from: r.period_from || '', period_to: r.period_to || '',
      soa_number: r.soa_number || '', amount: r.amount, hmo_id: r.hmo_id || '', company_id: '', bill_to: 'HMO', remarks: r.remarks || '',
    });
  }

  // ---- SOA import -------------------------------------------------------------
  async function readFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setFlash(null);
    const basis = imp?.basis || 'current';
    setImp((cur) => ({ items: cur?.items || [], basis, reading: true, importing: false }));
    const added = [];
    for (const f of files) {
      const key = `${f.name}-${f.size}-${f.lastModified}-${Math.random().toString(36).slice(2, 7)}`;
      try {
        if (!/\.xlsx$/i.test(f.name)) throw new Error('Only .xlsx files can be imported.');
        if (f.size > MAX_SOA_BYTES) throw new Error('File is too large (limit 3 MB).');
        const r = await api.parseSoa(f.name, await fileToBase64(f));
        const d = r.data;
        if (d.error) throw new Error(d.error);
        added.push({
          key, file: f.name, error: '', selected: true, warnings: d.warnings || [],
          soa_number: d.soa_number || '', parsed_soa: d.soa_number || '', company_name: d.company_name || '', hmo_id: d.hmo_id || '', hmo_match: d.hmo_match,
          duplicate: d.duplicate || '', txn_date: d.date || todayLocal(),
          // The covered period written in the file (or its transaction dates) wins; the billing-date rule is only the fallback.
          ...(d.period_from && d.period_to
            ? { period_from: d.period_from, period_to: d.period_to }
            : autoPeriod ? periodFor(d.date || todayLocal(), true, periodRules) : { period_from: '', period_to: '' }),
          total_due: d.total_due, current_due: d.current_due, previous_balance: d.previous_balance, lines: d.line_count || 0,
          amount: pickAmount(d, basis),
        });
      } catch (e) {
        added.push({ key, file: f.name, error: e.message, selected: false, warnings: [] });
      }
    }
    setImp((cur) => ({ ...cur, items: [...(cur?.items || []), ...added], reading: false }));
    if (fileInput.current) fileInput.current.value = '';
  }

  const patchItem = (key, patch) => setImp((cur) => ({ ...cur, items: cur.items.map((it) => (it.key === key ? { ...it, ...patch } : it)) }));

  function setBasis(basis) {
    setImp((cur) => ({ ...cur, basis, items: cur.items.map((it) => (it.error ? it : { ...it, amount: pickAmount(it, basis) })) }));
  }

  // What stops a row from being imported (empty string = ready).
  function problemOf(it, items) {
    if (it.error) return it.error;
    if (!it.hmo_id) return 'Pick the HMO';
    if (!(Number(it.amount) > 0)) return 'Amount must be above zero';
    if (!it.txn_date) return 'Billing date needed';
    if (it.period_from && it.period_to && it.period_from > it.period_to) return 'Period dates are reversed';
    const soa = (it.soa_number || '').trim().toUpperCase();
    if (soa) {
      // The server flagged the number as parsed from the file; editing the number clears that flag.
      if (it.duplicate && soa === (it.parsed_soa || '').trim().toUpperCase()) return `SOA already used — ${it.duplicate}`;
      if ((rows || []).some((r) => r.status !== 'VOID' && (r.soa_number || '').toUpperCase() === soa)) return 'SOA # already in Billing';
      if (items.some((o) => o !== it && !o.error && o.selected && (o.soa_number || '').trim().toUpperCase() === soa)) return 'Same SOA # in another file';
    }
    return '';
  }

  const impReady = useMemo(() => (imp ? imp.items.filter((it) => it.selected && !problemOf(it, imp.items)) : []), [imp, rows]); // eslint-disable-line react-hooks/exhaustive-deps

  async function runImport(andPost) {
    const todo = impReady;
    if (!todo.length) return;
    setImp((cur) => ({ ...cur, importing: true }));
    const done = new Set();
    const failed = [];
    let posted = 0;
    for (const it of todo) {
      const remarks = `Imported from ${it.file} · ${it.lines} patient line${it.lines === 1 ? '' : 's'}`
        + (imp.basis === 'total' && it.previous_balance ? ` · includes previous balance ${peso(it.previous_balance)}` : '');
      try {
        const r = await api.saveBilling({
          id: null, txn_date: it.txn_date, period_from: it.period_from, period_to: it.period_to,
          soa_number: it.soa_number, amount: it.amount, hmo_id: it.hmo_id, company_id: '', bill_to: 'HMO', remarks,
        });
        done.add(it.key);
        if (andPost) {
          try { await api.postBilling(r.id); posted += 1; } catch (e) { failed.push(`${it.file}: opened, but not posted — ${e.message}`); }
        }
      } catch (e) {
        failed.push(`${it.file}: ${e.message}`);
      }
    }
    const left = imp.items.filter((it) => !done.has(it.key));
    const okMsg = `Imported ${done.size} SOA${done.size === 1 ? '' : 's'}${andPost ? ` (${posted} posted to the ledger)` : ' as open transactions'}.`;
    setFlash({ type: failed.length ? 'error' : 'success', msg: failed.length ? `${okMsg} ${failed.join(' | ')}` : okMsg });
    setImp(left.length ? { ...imp, items: left, importing: false, reading: false } : null);
    setFilter(andPost ? 'POSTED' : 'OPEN');
    load();
  }

  const billedName = (r) => (r.bill_to === 'COMPANY' ? r.company_name : r.hmo_name) || '—';
  const billedId = (r) => (r.bill_to === 'COMPANY' ? r.company_id : r.hmo_id);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Billing</h1>
          <div className="subtitle">Open a transaction, pick the HMO, then post it to that HMO's ledger</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={() => { setFlash(null); setImp((cur) => cur || { items: [], basis: 'current', reading: false, importing: false }); }}>Import SOA</button>
          <button className="btn" onClick={() => { setFlash(null); setForm(blank()); }}>+ New Transaction</button>
        </div>
      </div>

      {flash && <div className={`flash flash-${flash.type}`}>{flash.msg}</div>}

      {imp && (
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>Import SOA files</h2>
            <button className="btn btn-secondary btn-sm" disabled={imp.importing} onClick={() => setImp(null)}>Close</button>
          </div>
          <div className="subtitle" style={{ margin: '6px 0 14px' }}>
            Drop one or many SOA Excel files. The company name is matched to an HMO, the Date becomes the Billing Date, the Series No. becomes the SOA #, and the covered period comes from the period or transaction dates in the file.
          </div>
          <div
            className={`dropzone${dragOver ? ' over' : ''}`}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); readFiles(e.dataTransfer.files); }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInput.current?.click(); }}
          >
            {imp.reading ? 'Reading files…' : 'Drop .xlsx files here, or click to choose'}
            <input ref={fileInput} type="file" accept=".xlsx" multiple hidden onChange={(e) => readFiles(e.target.files)} />
          </div>

          {imp.items.length > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', margin: '16px 0 8px' }}>
                <strong style={{ fontSize: 16 }}>Amount to bill</strong>
                <label style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 16, cursor: 'pointer' }}>
                  <input type="radio" name="soa-basis" style={{ width: 20, height: 20, margin: 0, cursor: 'pointer' }} checked={imp.basis === 'total'} onChange={() => setBasis('total')} /> Total Amount Due
                </label>
                <label style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 16, cursor: 'pointer' }}>
                  <input type="radio" name="soa-basis" style={{ width: 20, height: 20, margin: 0, cursor: 'pointer' }} checked={imp.basis === 'current'} onChange={() => setBasis('current')} /> Current Amount Due only
                </label>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr><th></th><th>File</th><th>SOA #</th><th>HMO</th><th>Billing Date</th><th>Covered Period</th><th className="text-right">Amount (₱)</th><th>Check</th></tr>
                  </thead>
                  <tbody>
                    {imp.items.map((it) => {
                      const problem = problemOf(it, imp.items);
                      return (
                        <tr key={it.key}>
                          <td>
                            <input type="checkbox" checked={it.selected && !it.error} disabled={!!it.error} onChange={(e) => patchItem(it.key, { selected: e.target.checked })} aria-label={`Import ${it.file}`} />
                          </td>
                          <td style={{ maxWidth: 220 }}>
                            <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{it.file}</div>
                            {!it.error && (
                              <div style={{ fontSize: 12, color: 'var(--slate)' }}>
                                {it.lines} patient line{it.lines === 1 ? '' : 's'}
                                {it.previous_balance !== null && it.previous_balance !== undefined ? ` · previous ${peso(it.previous_balance)}` : ''}
                                {it.current_due !== null && it.current_due !== undefined ? ` · current ${peso(it.current_due)}` : ''}
                              </div>
                            )}
                          </td>
                          {it.error ? <td colSpan={6} /> : (<>
                            <td><input style={{ minWidth: 110 }} value={it.soa_number} onChange={(e) => patchItem(it.key, { soa_number: e.target.value })} /></td>
                            <td>
                              <select value={it.hmo_id} onChange={(e) => patchItem(it.key, { hmo_id: e.target.value })} style={{ minWidth: 150 }}>
                                <option value="">{it.company_name ? `No match for "${it.company_name}"` : 'Select an HMO…'}</option>
                                {hmos.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                              </select>
                              {it.hmo_id && it.hmo_match === 'close' && <div style={{ fontSize: 12, color: 'var(--amber)' }}>Close match for "{it.company_name}"</div>}
                            </td>
                            <td><LongDateInput value={it.txn_date} ariaLabel="Billing date" onChange={(v) => patchItem(it.key, { txn_date: v, ...(autoPeriod ? periodFor(v, true, periodRules) : {}) })} /></td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <LongDateInput value={it.period_from} ariaLabel="Covered from" onChange={(v) => patchItem(it.key, { period_from: v })} />
                                <span style={{ color: 'var(--slate)', fontSize: 12 }}>to</span>
                                <LongDateInput value={it.period_to} min={it.period_from} ariaLabel="Covered to" onChange={(v) => patchItem(it.key, { period_to: v })} />
                              </div>
                            </td>
                            <td className="text-right"><input type="number" step="0.01" min="0" style={{ width: 120, textAlign: 'right' }} value={it.amount} onChange={(e) => patchItem(it.key, { amount: e.target.value })} /></td>
                          </>)}
                          <td style={{ minWidth: 150 }}>
                            {problem
                              ? <span className="badge badge-danger" style={{ whiteSpace: 'normal' }}>{problem}</span>
                              : <span className="badge badge-success">Ready</span>}
                            {!it.error && it.warnings.map((w, i) => <div key={i} style={{ fontSize: 12, color: 'var(--amber)', marginTop: 4 }}>{w}</div>)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="form-actions">
                <button className="btn" disabled={imp.importing || !impReady.length} onClick={() => runImport(true)}>
                  {imp.importing ? 'Importing…' : `Import & Post to Ledger (${impReady.length})`}
                </button>
                <button className="btn btn-secondary" disabled={imp.importing || !impReady.length} onClick={() => runImport(false)}>Import as Open ({impReady.length})</button>
                <button className="btn btn-secondary" disabled={imp.importing} onClick={() => setImp({ ...imp, items: [] })}>Clear list</button>
              </div>
            </>
          )}
        </div>
      )}

      {form && (
        <div className="panel">
          <h2>{form.id ? `Edit Transaction #${form.id}` : 'Open a Transaction'}</h2>
          <form onSubmit={(e) => { e.preventDefault(); save(false); }}>
            <div className="form-grid">
              <div className="form-group">
                <label>Billing Date</label>
                <LongDateInput value={form.txn_date} ariaLabel="Billing date" onChange={(v) => setForm((f) => ({ ...f, txn_date: v, ...(autoPeriod ? periodFor(v, true, periodRules) : {}) }))} />
              </div>
              <div className="form-group span-2">
                <label>Covered Period</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <LongDateInput style={{ flex: '1 1 210px' }} value={form.period_from} ariaLabel="Covered from" onChange={(v) => setForm((f) => ({ ...f, period_from: v }))} />
                  <span style={{ color: 'var(--slate)', fontSize: 13 }}>to</span>
                  <LongDateInput style={{ flex: '1 1 210px' }} value={form.period_to} min={form.period_from} ariaLabel="Covered to" onChange={(v) => setForm((f) => ({ ...f, period_to: v }))} />
                </div>
              </div>
              <div className="form-group">
                <label>SOA #</label>
                <input value={form.soa_number} onChange={set('soa_number')} />
              </div>
              <div className="form-group">
                <label>Amount (₱)</label>
                <input type="number" step="0.01" min="0" value={form.amount} onChange={set('amount')} />
              </div>
              <div className="form-group">
                <label>HMO *</label>
                <select required value={form.hmo_id} onChange={set('hmo_id')}>
                  <option value="">Select an HMO…</option>
                  {hmos.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
            </div>
            {hmos.length === 0 && (
              <div className="subtitle" style={{ marginTop: 10 }}>
                No HMO accounts yet. Open Companies, edit each partner HMO and set "Company or HMO?" to HMO.
              </div>
            )}
            <div className="form-group" style={{ marginTop: 14 }}>
              <label>Remarks</label>
              <textarea rows={2} value={form.remarks} onChange={set('remarks')} />
            </div>
            <div className="form-actions">
              <button className="btn" type="button" disabled={busy} onClick={() => save(true)}>Save &amp; Post to Ledger</button>
              <button className="btn btn-secondary" type="submit" disabled={busy}>Save (keep open)</button>
              <button className="btn btn-secondary" type="button" onClick={() => setForm(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="panel">
        <div className="table-toolbar">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[['OPEN', 'Open'], ['POSTED', 'Posted'], ['VOID', 'Voided'], ['ALL', 'All']].map(([k, label]) => (
              <button key={k} className={`btn btn-sm ${filter === k ? '' : 'btn-secondary'}`} onClick={() => setFilter(k)}>
                {label}{k !== 'ALL' && rows ? ` (${counts[k] || 0})` : ''}
              </button>
            ))}
          </div>
          <span className="table-toolbar-count">{shown ? `${shown.length} transaction${shown.length === 1 ? '' : 's'}` : ''}</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th><th>Billing Date</th><th>Covered Period</th><th>SOA #</th><th>HMO</th>
                <th className="text-right">Amount</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {!shown && <tr><td colSpan={8} className="empty-state">Loading…</td></tr>}
              {shown && shown.length === 0 && (
                <tr><td colSpan={8} className="empty-state">
                  {filter === 'OPEN' ? 'No open transactions. Click "+ New Transaction" to open one.' : 'Nothing here.'}
                </td></tr>
              )}
              {shown && shown.map((r) => (
                <tr key={r.id}>
                  <td className="num">{r.id}</td>
                  <td>{fdate(r.txn_date)}</td>
                  <td>{coveredLabel(r.period_from, r.period_to) || '—'}</td>
                  <td>{r.soa_number || '—'}</td>
                  <td>
                    {r.status === 'POSTED' && r.ledger_entry_id
                      ? <Link to={`/ledger?company_id=${billedId(r)}&entry=${r.ledger_entry_id}`}>{billedName(r)}</Link>
                      : billedName(r)}
                  </td>
                  <td className="text-right num">{peso(r.amount)}</td>
                  <td><span className={`badge ${STATUS_BADGE[r.status] || 'badge-secondary'}`}>{r.status}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {r.status === 'OPEN' && <>
                      <button className="btn btn-sm" onClick={() => post(r)}>Post</button>{' '}
                      <button className="btn btn-secondary btn-sm" onClick={() => edit(r)}>Edit</button>{' '}
                    </>}
                    {r.status !== 'VOID' && <button className="btn btn-danger btn-sm" onClick={() => voidTxn(r)}>Void</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}