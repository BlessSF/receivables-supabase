import { useEffect, useState } from 'react';
import { api } from './api';
import { peso, formatLongDate } from './utils';
import MoneyInput, { rawNum } from './MoneyInput';
import { IconEdit, IconTrash } from './icons';

// The payments of ONE ledger row (one SOA): every payment keeps its own date, amount and check ref.
// The row's Paid is the total of these, so a part payment leaves the rest outstanding until the next one.
const METHODS = ['Cash', 'Card', 'Check'];
const BANKS = ['Metrobank', 'BPI', 'PBB', 'Maya', 'Other'];
const today = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); // Manila date

export default function PaymentsModal({ entry, onClose, onChanged }) {
  const [info, setInfo] = useState(null); // { enabled, entry, payments }
  const [form, setForm] = useState(null); // null = hidden, object = add / edit
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.getPayments(entry.id).then((r) => setInfo(r.data)).catch((e) => setErr(e.message));
  }, [entry.id]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const e = info?.entry;
  const balance = Number(e?.balance) || 0;
  const setF = (k) => (ev) => setForm({ ...form, [k]: ev.target.value });

  function startAdd() {
    setErr('');
    setForm({ amount: balance > 0.009 ? balance.toFixed(2) : '', payment_date: today(), check_ref: '', check_date: '', payment_method: '', payment_method_bank: '', payment_method_other: '', remarks: '' });
  }
  function startEdit(p) {
    setErr('');
    setForm({ id: p.id, amount: String(Number(p.amount).toFixed(2)), payment_date: p.payment_date || '', check_ref: p.check_ref || '', check_date: p.check_date || '',
      payment_method: p.payment_method || '', payment_method_bank: p.payment_method_bank || '', payment_method_other: p.payment_method_other || '', remarks: p.remarks || '' });
  }

  async function save(ev) {
    ev.preventDefault();
    setBusy(true); setErr('');
    try {
      const body = { ...form, amount: rawNum(form.amount) };
      const r = form.id ? await api.updatePayment(form.id, body) : await api.addPayment(entry.id, body);
      setInfo(r.data);
      setForm(null);
      onChanged(r.row);
    } catch (x) { setErr(x.message); }
    setBusy(false);
  }

  async function remove(p) {
    if (!window.confirm(`Delete the ${peso(p.amount)} payment${p.payment_date ? ` of ${formatLongDate(p.payment_date)}` : ''}? The balance goes back up by that amount.`)) return;
    setBusy(true); setErr('');
    try {
      const r = await api.deletePayment(p.id);
      setInfo(r.data);
      onChanged(r.row);
    } catch (x) { setErr(x.message); }
    setBusy(false);
  }

  const showBank = form && (form.payment_method === 'Check' || form.payment_method === 'Card');
  const over = e && Number(e.paid_amount) > Number(e.receivable_amount) + 0.009;

  return (
    <div className="pm-backdrop" onMouseDown={(ev) => { if (ev.target === ev.currentTarget) onClose(); }}>
      <div className="pm-card" role="dialog" aria-modal="true" aria-label="Payments">
        <div className="pm-head">
          <div>
            <h2>Payments{entry.soa_number ? ` · ${entry.soa_number}` : ''}</h2>
            <div className="pm-sub">Each payment is kept separately. A part payment leaves the rest outstanding on the same SOA.</div>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>

        {err && <div className="flash flash-error" style={{ margin: '0 0 12px' }}>{err}</div>}
        {!info && !err && <div className="loading-state">Loading…</div>}
        {info && !info.enabled && (
          <div className="flash flash-warning">Payments are not set up yet. Run <b>database/add_ledger_payments.sql</b> in Supabase once, then reopen this.</div>
        )}

        {info && info.enabled && (
          <>
            <div className="pm-summary">
              <div><span>Receivable</span><strong className="num">{peso(e.receivable_amount)}</strong></div>
              <div><span>Paid so far</span><strong className="num">{peso(e.paid_amount)}</strong></div>
              <div className={balance > 0.009 ? 'is-due' : 'is-ok'}><span>Balance</span><strong className="num">{peso(balance)}</strong></div>
            </div>
            {over && <div className="flash flash-warning" style={{ margin: '0 0 10px' }}>Paid is more than the receivable. The balance shows as ₱0.00.</div>}

            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Date</th><th className="text-right">Amount</th><th>Check ref</th><th>Method</th><th></th></tr></thead>
                <tbody>
                  {info.payments.length === 0 && <tr><td colSpan={5} className="empty-state">No payments yet.</td></tr>}
                  {info.payments.map((p) => (
                    <tr key={p.id}>
                      <td>{p.payment_date ? formatLongDate(p.payment_date) : '—'}</td>
                      <td className="text-right num">{peso(p.amount)}</td>
                      <td>{p.check_ref || '—'}</td>
                      <td>{[p.payment_method, p.payment_method_bank === 'Other' ? p.payment_method_other : p.payment_method_bank].filter(Boolean).join(' · ') || '—'}</td>
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <button type="button" className="btn btn-secondary btn-sm icon-btn" title="Edit" aria-label="Edit" disabled={busy} onClick={() => startEdit(p)}><IconEdit /></button>
                        <button type="button" className="btn btn-danger btn-sm icon-btn" title="Delete" aria-label="Delete" disabled={busy} onClick={() => remove(p)}><IconTrash /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!form && (
              <div className="pm-actions">
                <button type="button" className="btn" onClick={startAdd}>+ Add payment{balance > 0.009 ? ` (remaining ${peso(balance)})` : ''}</button>
              </div>
            )}

            {form && (
              <form className="pm-form" onSubmit={save}>
                <h3>{form.id ? 'Edit payment' : 'New payment'}</h3>
                <div className="form-grid">
                  <div className="form-group"><label>Amount *</label>
                    <MoneyInput className="num" value={form.amount} placeholder="0.00" onChange={(v) => setForm({ ...form, amount: v })} autoFocus />
                  </div>
                  <div className="form-group"><label>Payment date</label>
                    <input type="date" value={/^\d{4}-\d{2}-\d{2}$/.test(form.payment_date || '') ? form.payment_date : ''} onChange={setF('payment_date')} />
                  </div>
                  <div className="form-group"><label>Check ref</label><input value={form.check_ref} onChange={setF('check_ref')} /></div>
                  <div className="form-group"><label>Method</label>
                    <select value={form.payment_method} onChange={setF('payment_method')}>
                      <option value="">—</option>
                      {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  {showBank && (
                    <div className="form-group"><label>Bank</label>
                      <select value={form.payment_method_bank} onChange={setF('payment_method_bank')}>
                        <option value="">—</option>
                        {BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </div>
                  )}
                  {showBank && form.payment_method_bank === 'Other' && (
                    <div className="form-group"><label>Other bank</label><input value={form.payment_method_other} onChange={setF('payment_method_other')} /></div>
                  )}
                </div>
                <div className="form-actions">
                  <button className="btn" type="submit" disabled={busy}>{form.id ? 'Save changes' : 'Save payment'}</button>
                  <button className="btn btn-secondary" type="button" onClick={() => setForm(null)}>Cancel</button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}