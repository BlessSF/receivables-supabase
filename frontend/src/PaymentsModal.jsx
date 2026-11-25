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
    setForm({ amount: balance > 0.009 ? balance.toFixed(2) : '', payment_date: today(), check_ref: '', check_date: '', payment_method: '', payment_method_bank: '', payment_method_other: '', remarks: '',
      provider_excess: '', concern_amount: '', disc_amount: '', pay_tax: entry.account_type !== 'CHARGE' });
  }
  function startEdit(p) {
    setErr('');
    setForm({ id: p.id, amount: String(Number(p.amount).toFixed(2)), payment_date: p.payment_date || '', check_ref: p.check_ref || '', check_date: p.check_date || '',
      payment_method: p.payment_method || '', payment_method_bank: p.payment_method_bank || '', payment_method_other: p.payment_method_other || '', remarks: p.remarks || '',
      provider_excess: Number(p.pe_amount) ? String(Number(p.pe_amount).toFixed(2)) : '', concern_amount: Number(p.ca_amount) ? String(Number(p.ca_amount).toFixed(2)) : '',
      disc_amount: Number(p.dc_amount) ? String(Number(p.dc_amount).toFixed(2)) : '', pay_tax: Number(p.tax_amount) > 0 });
  }

  async function save(ev) {
    ev.preventDefault();
    setBusy(true); setErr('');
    try {
      const body = { ...form, amount: rawNum(form.amount), provider_excess: rawNum(form.provider_excess), concern_amount: rawNum(form.concern_amount), disc_amount: rawNum(form.disc_amount),
        pay_tax: entry.account_type === 'CHARGE' ? 0 : (form.pay_tax ? 1 : 0) };
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

  // What the entry looks like now, what this form adds, and what it will be once saved (same formula as the ledger row)
  const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const calc = (() => {
    if (!form || !e) return null;
    const old = form.id ? info.payments.find((x) => x.id === form.id) : null;
    const n = (v) => Number(v) || 0;
    const pct = Number(info.tax_percent) || 0;
    const isCharge = entry.account_type === 'CHARGE';
    const gross = n(e.amount);
    const taxOn = isCharge ? 0 : r2((gross * pct) / 100);
    const flags = { pe: e.pe_on !== false, ca: e.ca_on !== false, dc: e.dc_on !== false };
    const has = (k, v) => (flags[k] ? n(v) : 0); // a deduction counts only while its switch is on
    const nowRaw = { pe: n(e.provider_excess), ca: n(e.concern_amount), dc: n(e.disc_amount) };
    const typed = { pe: n(rawNum(form.provider_excess)), ca: n(rawNum(form.concern_amount)), dc: n(rawNum(form.disc_amount)) };
    const was = { pe: n(old?.pe_amount), ca: n(old?.ca_amount), dc: n(old?.dc_amount) };
    const afterRaw = { pe: nowRaw.pe - was.pe + typed.pe, ca: nowRaw.ca - was.ca + typed.ca, dc: nowRaw.dc - was.dc + typed.dc };
    // Tax W/H of the entry = its own tax + the tax withheld with each payment (this payment adds its own % of the amount paid)
    const payAmt = n(rawNum(form.amount));
    const thisTax = (on) => (isCharge || !on ? 0 : r2((payAmt * pct) / 100));
    const taxNow = (e.tax_off ? 0 : taxOn) + n(e.pay_tax);
    const taxAfter = (e.tax_off ? 0 : taxOn) + n(e.pay_tax) - n(old?.tax_amount) + thisTax(form.pay_tax);
    const sur = n(e.surcharge) - n(e.rebate);
    const dedNow = has('pe', nowRaw.pe) + has('ca', nowRaw.ca) + has('dc', nowRaw.dc);
    const dedAfter = has('pe', afterRaw.pe) + has('ca', afterRaw.ca) + has('dc', afterRaw.dc);
    const recNow = r2(gross - taxNow - dedNow + sur);
    const recAfter = r2(gross - taxAfter - dedAfter + sur);
    const paidNow = n(e.paid_amount);
    const paidAfter = r2(paidNow - n(old?.amount) + payAmt);
    const row = (nowV, afterV) => ({ now: r2(nowV), add: r2(afterV - nowV), after: r2(afterV) });
    return {
      pct, isCharge, flags, payTax: thisTax(form.pay_tax),
      tax: row(taxNow, taxAfter),
      pe: row(has('pe', nowRaw.pe), has('pe', afterRaw.pe)),
      ca: row(has('ca', nowRaw.ca), has('ca', afterRaw.ca)),
      dc: row(has('dc', nowRaw.dc), has('dc', afterRaw.dc)),
      receivable: row(recNow, recAfter),
      paid: row(paidNow, paidAfter),
      balance: row(Math.max(0, r2(recNow - paidNow)), Math.max(0, r2(recAfter - paidAfter))),
      amount: gross, withTax: r2(gross - (taxAfter - thisTax(form.pay_tax) + thisTax(true)) - dedAfter + sur), withoutTax: r2(gross - (taxAfter - thisTax(form.pay_tax)) - dedAfter + sur),
    };
  })();
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
                <thead><tr><th>Date</th><th className="text-right">Amount</th><th className="text-right">Deducted</th><th>Check ref</th><th>Method</th><th></th></tr></thead>
                <tbody>
                  {info.payments.length === 0 && <tr><td colSpan={6} className="empty-state">No payments yet.</td></tr>}
                  {info.payments.map((p) => (
                    <tr key={p.id}>
                      <td>{p.payment_date ? formatLongDate(p.payment_date) : '—'}</td>
                      <td className="text-right num">{peso(p.amount)}</td>
                      <td className="text-right num" title="Provider Excess + Concern Amount + Disc entered with this payment">{(Number(p.pe_amount) || 0) + (Number(p.ca_amount) || 0) + (Number(p.dc_amount) || 0) > 0.009 ? peso((Number(p.pe_amount) || 0) + (Number(p.ca_amount) || 0) + (Number(p.dc_amount) || 0)) : '—'}</td>
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
                <div className="pm-deduct">
                  <div className="pm-deduct-head">Deductions <span>taken off the Receivable (each one counts while its switch is on in the ledger)</span></div>
                  <div className="form-grid">
                    <div className="form-group"><label>Provider Excess</label>
                      <MoneyInput className="num" value={form.provider_excess} placeholder="0.00" onChange={(v) => setForm({ ...form, provider_excess: v })} />
                    </div>
                    <div className="form-group"><label>Concern Amount</label>
                      <MoneyInput className="num" value={form.concern_amount} placeholder="0.00" onChange={(v) => setForm({ ...form, concern_amount: v })} />
                    </div>
                    <div className="form-group"><label>Disc</label>
                      <MoneyInput className="num" value={form.disc_amount} placeholder="0.00" onChange={(v) => setForm({ ...form, disc_amount: v })} />
                    </div>
                    {entry.account_type !== 'CHARGE' && (
                      <div className="form-group"><label>Tax W/H on this payment ({Number(info.tax_percent) || 0}%)</label>
                        <div className="pm-tax">
                          <button type="button" className={`tax-switch${form.pay_tax ? ' on' : ''}`} aria-label={form.pay_tax ? 'Turn Tax W/H off for this payment' : 'Turn Tax W/H on for this payment'}
                            onClick={() => setForm({ ...form, pay_tax: !form.pay_tax })}><span /></button>
                          <span>{form.pay_tax ? `On: another ${Number(info.tax_percent) || 0}% of this payment is withheld` : 'Off: no tax withheld on this payment'}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                {calc && (() => {
                  const sign = (v, minus) => (Math.abs(v) < 0.005 ? '—' : (minus ? (v > 0 ? '− ' : '+ ') : (v > 0 ? '+ ' : '− ')) + peso(Math.abs(v)));
                  const line = (label, r, minus, extra) => (
                    <tr>
                      <td>{label}{extra}</td>
                      <td className="num">{minus ? (r.now > 0.005 ? '− ' + peso(r.now) : '—') : peso(r.now)}</td>
                      <td className="num pm-calc-add">{sign(r.add, minus)}</td>
                      <td className="num">{minus ? (r.after > 0.005 ? '− ' + peso(r.after) : '—') : peso(r.after)}</td>
                    </tr>
                  );
                  const off = <span className="pm-calc-off"> · switch off in ledger</span>;
                  return (
                    <div className="pm-calc" aria-live="polite">
                      <div className="pm-calc-title">Preview: now → this payment → after saving</div>
                      <table>
                        <thead><tr><th></th><th>Now</th><th>This payment</th><th>After</th></tr></thead>
                        <tbody>
                          <tr><td>Amount</td><td className="num">{peso(calc.amount)}</td><td className="num pm-calc-add">—</td><td className="num">{peso(calc.amount)}</td></tr>
                          {!calc.isCharge && line(`Tax W/H (${calc.pct}%)`, calc.tax, true, form.pay_tax ? null : <span className="pm-calc-off"> · none on this payment</span>)}
                          {line('Provider Excess', calc.pe, true, calc.flags.pe ? null : off)}
                          {line('Concern Amount', calc.ca, true, calc.flags.ca ? null : off)}
                          {line('Disc', calc.dc, true, calc.flags.dc ? null : off)}
                          <tr className="pm-calc-total"><td>Receivable</td><td className="num">{peso(calc.receivable.now)}</td><td className="num pm-calc-add">{sign(calc.receivable.add, false)}</td><td className="num">{peso(calc.receivable.after)}</td></tr>
                          <tr><td>Paid</td><td className="num">{peso(calc.paid.now)}</td><td className="num pm-calc-add">{sign(calc.paid.add, false)}</td><td className="num">{peso(calc.paid.after)}</td></tr>
                          <tr className={`pm-calc-total${calc.balance.after > 0.009 ? ' is-due' : ' is-ok'}`}><td>Balance</td><td className="num">{peso(calc.balance.now)}</td><td className="num pm-calc-add">{sign(calc.balance.add, false)}</td><td className="num">{peso(calc.balance.after)}</td></tr>
                        </tbody>
                      </table>
                      {!calc.isCharge && <div className="pm-calc-alt">Receivable if this payment withholds tax: <b className="num">{peso(calc.withTax)}</b> · if not: <b className="num">{peso(calc.withoutTax)}</b></div>}
                    </div>
                  );
                })()}
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