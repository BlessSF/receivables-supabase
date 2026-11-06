import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import LongDateInput from '../LongDateInput';
import MoneyInput from '../MoneyInput';
import { useAuth } from '../AuthContext';
import { isStaff, isExecutive } from '../utils';
import { listZip, readZipEntry, MAX_ZIP_BYTES } from '../zipRead';
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
const MAX_IMPORT_FILES = 300; // per upload, counting every file found inside zips
const SOA_EXT = /\.(xlsx|ods)$/i;

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
  const { user } = useAuth();
  const staff = isStaff(user) || isExecutive(user); // staff can open and post billing, but not void
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
  const chargeAccts = useMemo(() => accounts.filter((a) => a.account_type === 'CHARGE'), [accounts]);

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
    if (form.bill_to === 'COMPANY' ? !form.company_id : !form.hmo_id) { setFlash({ type: 'error', msg: form.bill_to === 'COMPANY' ? 'Choose a charge account.' : 'Choose an HMO.' }); return; }
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
      soa_number: r.soa_number || '', amount: r.amount, hmo_id: r.hmo_id || '', company_id: r.bill_to === 'COMPANY' ? (r.company_id || '') : '', bill_to: r.bill_to === 'COMPANY' ? 'COMPANY' : 'HMO', remarks: r.remarks || '',
    });
  }

  // ---- SOA import -------------------------------------------------------------
  // Turns what was dropped (.xlsx, .ods, .zip, or a mix) into a list of SOA files to read.
  // Zips are opened right here in the browser, folders inside them included; anything that is not a SOA file is skipped.
  async function collectFiles(files) {
    const queue = []; const skipped = []; const problems = [];
    let over = 0;
    const base = (n) => n.split('/').pop();
    async function addZip(blob, label, depth) {
      if (blob.size > MAX_ZIP_BYTES) { problems.push({ file: label, error: 'This zip is too large (limit 50 MB).' }); return; }
      let entries;
      try { entries = await listZip(blob); } catch (e) { problems.push({ file: label, error: e.message }); return; }
      for (const en of entries) {
        const b = base(en.name);
        if (/(^|\/)__MACOSX\//.test(en.name) || b.startsWith('.') || b.startsWith('~$')) continue; // system junk, not a real file
        const shown = `${label.replace(/\.zip$/i, '')}/${en.name}`;
        if (/\.zip$/i.test(b)) {
          if (depth >= 2) { skipped.push(shown); continue; }
          if (en.size > MAX_ZIP_BYTES) { problems.push({ file: shown, error: 'This zip is too large (limit 50 MB).' }); continue; }
          try { await addZip(await readZipEntry(blob, en, MAX_ZIP_BYTES), shown, depth + 1); } catch (e) { problems.push({ file: shown, error: e.message }); }
          continue;
        }
        if (!SOA_EXT.test(b)) { skipped.push(shown); continue; }
        if (queue.length >= MAX_IMPORT_FILES) { over += 1; continue; }
        if (en.size > MAX_SOA_BYTES) { problems.push({ file: b, error: 'File is too large (limit 3 MB).' }); continue; }
        queue.push({ name: b, size: en.size, get: () => readZipEntry(blob, en, MAX_SOA_BYTES) });
      }
    }
    for (const f of files) {
      if (/\.zip$/i.test(f.name)) await addZip(f, f.name, 0);
      else if (SOA_EXT.test(f.name)) {
        if (queue.length >= MAX_IMPORT_FILES) over += 1;
        else if (f.size > MAX_SOA_BYTES) problems.push({ file: f.name, error: 'File is too large (limit 3 MB).' });
        else queue.push({ name: f.name, size: f.size, get: async () => f });
      } else problems.push({ file: f.name, error: 'Only .xlsx, .ods and .zip files can be imported.' });
    }
    return { queue, skipped, problems, over };
  }

  async function readFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length || imp?.reading) return;
    setFlash(null);
    const basis = imp?.basis || 'current';
    const batch = Math.random().toString(36).slice(2, 9);
    const setProgress = (progress) => setImp((cur) => ({ ...cur, progress }));
    setImp((cur) => ({ items: cur?.items || [], basis, reading: true, importing: false, skipped: [], over: 0, progress: { done: 0, total: 0, name: 'Opening files…' } }));
    if (fileInput.current) fileInput.current.value = '';

    const { queue, skipped, problems, over } = await collectFiles(files);
    const total = queue.length;
    const results = new Array(total);
    const flush = () => setImp((cur) => ({
      ...cur,
      items: [...(cur?.items || []).filter((i) => i.batch !== batch), ...problemRows, ...results.filter(Boolean)],
    }));
    const problemRows = problems.map((p, i) => ({ key: `${batch}-p${i}`, batch, file: p.file, error: p.error, selected: false, warnings: [] }));
    setImp((cur) => ({ ...cur, skipped, over, progress: { done: 0, total, name: total ? queue[0].name : '' } }));
    if (problemRows.length) flush();

    let done = 0; let next = 0;
    async function worker() {
      while (next < total) {
        const idx = next++;
        const q = queue[idx];
        const key = `${batch}-${idx}`;
        try {
          const blob = await q.get();
          const r = await api.parseSoa(q.name, await fileToBase64(blob));
          const d = r.data;
          if (d.error) throw new Error(d.error);
          results[idx] = {
            key, batch, file: q.name, error: '', selected: true, warnings: d.warnings || [],
            soa_number: d.soa_number || '', parsed_soa: d.soa_number || '', company_name: d.company_name || '', hmo_id: d.hmo_id || '', hmo_match: d.hmo_match,
            duplicate: d.duplicate || '', txn_date: d.date || todayLocal(),
            // Imported SOAs: the file's Date is the last day of the covered period (July 15 -> July 1 to July 15),
            // read from the Tran. Dates. The billing-date rule only fills in when the file gives nothing to go on.
            ...(d.period_from && d.period_to
              ? { period_from: d.period_from, period_to: d.period_to }
              : autoPeriod ? periodFor(d.date || todayLocal(), true, periodRules) : { period_from: '', period_to: '' }),
            total_due: d.total_due, current_due: d.current_due, previous_balance: d.previous_balance, lines: d.line_count || 0,
            amount: pickAmount(d, basis),
          };
        } catch (e) {
          results[idx] = { key, batch, file: q.name, error: e.message, selected: false, warnings: [] };
        }
        done += 1;
        setProgress({ done, total, name: q.name });
        flush();
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, total) }, worker));
    flush();
    setImp((cur) => ({ ...cur, reading: false, progress: null }));
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
    if (!soa) return 'Type the SOA #';
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
            Drop one or many SOA Excel files (.xlsx or .ods), or a .zip with many of them inside (up to 50 MB). The company name is matched to an HMO, the Date becomes the Billing Date, the Series No. becomes the SOA #, and the Date is the last day of the covered period (e.g. Date July 15 covers July 1 to July 15).
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
            {imp.reading ? (
              <div className="dz-progress">
                <span className="dz-spin" aria-hidden="true" />
                <strong>{imp.progress?.total ? `Reading ${Math.min(imp.progress.done + 1, imp.progress.total)} of ${imp.progress.total}…` : 'Opening files…'}</strong>
                {imp.progress?.total ? (
                  <>
                    <span className="dz-bar"><i style={{ width: `${Math.round((imp.progress.done / imp.progress.total) * 100)}%` }} /></span>
                    <span className="dz-file">{imp.progress.name}</span>
                  </>
                ) : null}
              </div>
            ) : 'Drop .xlsx, .ods or .zip files here, or click to choose'}
            <input ref={fileInput} type="file" accept=".xlsx,.ods,.zip" multiple hidden onChange={(e) => readFiles(e.target.files)} />
          </div>

          {(imp.over > 0 || (imp.skipped && imp.skipped.length > 0)) && (
            <div className="dz-note">
              {imp.over > 0 && <div><strong>{imp.over} file{imp.over === 1 ? '' : 's'} not read.</strong> Up to {MAX_IMPORT_FILES} files can be read at a time. Import these first, then upload the rest.</div>}
              {imp.skipped && imp.skipped.length > 0 && (
                <details>
                  <summary>{imp.skipped.length} other file{imp.skipped.length === 1 ? '' : 's'} skipped (not SOA Excel files)</summary>
                  <ul>{imp.skipped.slice(0, 50).map((n, i) => <li key={i}>{n}</li>)}{imp.skipped.length > 50 ? <li>…and {imp.skipped.length - 50} more</li> : null}</ul>
                </details>
              )}
            </div>
          )}

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
              <div className="table-wrap import-scroll">
                <table className="data-table import-table">
                  <thead>
                    <tr><th></th><th>File</th><th>SOA #</th><th>HMO</th><th>Billing Date</th><th>Covered Period</th><th className="text-right">Amount (₱)</th><th className="col-sticky-r">Check</th></tr>
                  </thead>
                  <tbody>
                    {imp.items.map((it) => {
                      const problem = problemOf(it, imp.items);
                      return (
                        <tr key={it.key}>
                          <td>
                            <input type="checkbox" checked={it.selected && !it.error} disabled={!!it.error} onChange={(e) => patchItem(it.key, { selected: e.target.checked })} aria-label={`Import ${it.file}`} />
                          </td>
                          <td style={{ minWidth: 150, maxWidth: 220 }}>
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
                            <td className="text-right"><MoneyInput style={{ width: 120, textAlign: 'right' }} value={it.amount} onChange={(v) => patchItem(it.key, { amount: v })} /></td>
                          </>)}
                          <td className="col-sticky-r" style={{ minWidth: 170, maxWidth: 240 }}>
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
                <MoneyInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />
              </div>
              <div className="form-group">
                <label>Bill to</label>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', height: 40 }}>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 500, cursor: 'pointer' }}>
                    <input type="radio" name="bill-to" style={{ width: 16, height: 16, margin: 0 }} checked={form.bill_to !== 'COMPANY'} onChange={() => setForm({ ...form, bill_to: 'HMO', company_id: '' })} /> HMO
                  </label>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 500, cursor: 'pointer' }}>
                    <input type="radio" name="bill-to" style={{ width: 16, height: 16, margin: 0 }} checked={form.bill_to === 'COMPANY'} onChange={() => setForm({ ...form, bill_to: 'COMPANY', hmo_id: '' })} /> Charge to company
                  </label>
                </div>
              </div>
              {form.bill_to === 'COMPANY' ? (
                <div className="form-group">
                  <label>Charge account *</label>
                  <select required value={form.company_id} onChange={set('company_id')}>
                    <option value="">Select a charge account…</option>
                    {chargeAccts.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </select>
                </div>
              ) : (
                <div className="form-group">
                  <label>HMO *</label>
                  <select required value={form.hmo_id} onChange={set('hmo_id')}>
                    <option value="">Select an HMO…</option>
                    {hmos.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            {form.bill_to === 'COMPANY' && chargeAccts.length === 0 && (
              <div className="subtitle" style={{ marginTop: 10 }}>
                No charge accounts yet. Open Companies, add one and set "Company or HMO?" to "Charge to company". The name can be the same as an HMO.
              </div>
            )}
            {form.bill_to !== 'COMPANY' && hmos.length === 0 && (
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
                <th>#</th><th>Billing Date</th><th>Covered Period</th><th>SOA #</th><th>HMO / Charge</th>
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
                    {r.bill_to === 'COMPANY' && <span className="badge badge-warning" style={{ marginLeft: 8 }}>Charge</span>}
                  </td>
                  <td className="text-right num">{peso(r.amount)}</td>
                  <td><span className={`badge ${STATUS_BADGE[r.status] || 'badge-secondary'}`}>{r.status}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {r.status === 'OPEN' && <>
                      <button className="btn btn-sm" onClick={() => post(r)}>Post</button>{' '}
                      <button className="btn btn-secondary btn-sm" onClick={() => edit(r)}>Edit</button>{' '}
                    </>}
                    {!staff && r.status !== 'VOID' && <button className="btn btn-danger btn-sm" onClick={() => voidTxn(r)}>Void</button>}
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