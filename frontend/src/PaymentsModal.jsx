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
  const [sheet, setSheet] = useState(null); // null = closed, 'all' = every payment, or one payment id

  useEffect(() => {
    api.getPayments(entry.id).then((r) => setInfo(r.data)).catch((e) => setErr(e.message));
  }, [entry.id]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { if (sheet !== null) setSheet(null); else onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, sheet]);

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
    // an older payment only knows what was received: net = received + what was deducted
    const net = p.net_amount !== null && p.net_amount !== undefined
      ? Number(p.net_amount)
      : Number(p.amount) + (Number(p.pe_amount) || 0) + (Number(p.ca_amount) || 0) + (Number(p.dc_amount) || 0) + (Number(p.tax_amount) || 0);
    setForm({ id: p.id, amount: String(net.toFixed(2)), payment_date: p.payment_date || '', check_ref: p.check_ref || '', check_date: p.check_date || '',
      payment_method: p.payment_method || '', payment_method_bank: p.payment_method_bank || '', payment_method_other: p.payment_method_other || '', remarks: p.remarks || '',
      provider_excess: Number(p.pe_amount) ? String(Number(p.pe_amount).toFixed(2)) : '', concern_amount: Number(p.ca_amount) ? String(Number(p.ca_amount).toFixed(2)) : '',
      disc_amount: Number(p.dc_amount) ? String(Number(p.dc_amount).toFixed(2)) : '', pay_tax: entry.account_type === 'CHARGE' ? false : (p.net_amount === null || p.net_amount === undefined ? true : Number(p.tax_amount) > 0) });
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

  // The SOA sheet, live. Per payment:
  //   Amount received = Net amount processed - Provider Excess - Concern Amount - Disc - Tax W/H
  //   Tax W/H         = tax % x (Net amount processed - the deductions), only while this payment's switch is on
  // The entry: Receivable = Amount - all Tax W/H - all deductions (+ Surcharge - Rebate), Balance = Receivable - Paid (received).
  const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const calc = (() => {
    if (!form || !e) return null;
    const old = form.id ? info.payments.find((x) => x.id === form.id) : null;
    const n = (v) => Number(v) || 0;
    const pct = n(info.tax_percent);
    const isCharge = entry.account_type === 'CHARGE';
    const gross = n(e.amount);
    const flags = { pe: e.pe_on !== false, ca: e.ca_on !== false, dc: e.dc_on !== false };
    const has = (k, v) => (flags[k] ? n(v) : 0); // a deduction counts only while its switch is on
    const typed = { pe: n(rawNum(form.provider_excess)), ca: n(rawNum(form.concern_amount)), dc: n(rawNum(form.disc_amount)) };
    const net = n(rawNum(form.amount));
    // ---- this payment
    const dedThis = has('pe', typed.pe) + has('ca', typed.ca) + has('dc', typed.dc);
    const baseThis = r2(net - dedThis);
    const taxFor = (on) => (isCharge || !on || baseThis <= 0 ? 0 : r2((baseThis * pct) / 100));
    const taxThis = taxFor(form.pay_tax);
    const received = r2(baseThis - taxThis);
    // ---- the entry now / after
    const oldNet = old && old.net_amount !== null && old.net_amount !== undefined;
    // what was typed straight into Paid (received) has its tax worked out from it: received x tax% / (100 - tax%)
    const typedTaxOf = (recv) => ((isCharge || e.tax_off || pct <= 0 || pct >= 100) ? 0 : r2((Math.max(0, recv) * pct) / (100 - pct)));
    const typedRecvNow = Math.max(0, n(e.paid_amount) - n(e.pay_recv));
    const typedRecvAfter = Math.max(0, typedRecvNow - (old && !oldNet ? n(old.amount) : 0));
    const nowRaw = { pe: n(e.provider_excess), ca: n(e.concern_amount), dc: n(e.disc_amount) };
    const was = { pe: n(old?.pe_amount), ca: n(old?.ca_amount), dc: n(old?.dc_amount) };
    const afterRaw = { pe: nowRaw.pe - was.pe + typed.pe, ca: nowRaw.ca - was.ca + typed.ca, dc: nowRaw.dc - was.dc + typed.dc };
    const taxNow = r2(n(e.pay_tax) + typedTaxOf(typedRecvNow));
    const taxAfter = r2(n(e.pay_tax) - (oldNet ? n(old.tax_amount) : 0) + taxThis + typedTaxOf(typedRecvAfter));
    const sur = n(e.surcharge) - n(e.rebate);
    const dedNow = has('pe', nowRaw.pe) + has('ca', nowRaw.ca) + has('dc', nowRaw.dc);
    const dedAfter = has('pe', afterRaw.pe) + has('ca', afterRaw.ca) + has('dc', afterRaw.dc);
    const recNow = r2(gross - taxNow - dedNow + sur);
    const recAfter = r2(gross - taxAfter - dedAfter + sur);
    const paidNow = n(e.paid_amount);
    const paidAfter = r2(paidNow - n(old?.amount) + received);
    const row = (nowV, afterV) => ({ now: r2(nowV), add: r2(afterV - nowV), after: r2(afterV) });
    return {
      pct, isCharge, flags, net, typed, dedThis, taxThis, received, amount: gross,
      tax: row(taxNow, taxAfter),
      pe: row(has('pe', nowRaw.pe), has('pe', afterRaw.pe)),
      ca: row(has('ca', nowRaw.ca), has('ca', afterRaw.ca)),
      dc: row(has('dc', nowRaw.dc), has('dc', afterRaw.dc)),
      receivable: row(recNow, recAfter),
      paid: row(paidNow, paidAfter),
      balance: row(Math.max(0, r2(recNow - paidNow)), Math.max(0, r2(recAfter - paidAfter))),
      withTax: r2(baseThis - taxFor(true)), withoutTax: baseThis,
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
                <thead><tr><th>Date</th><th className="text-right">Net processed</th><th className="text-right">Deducted</th><th className="text-right">Tax W/H</th><th className="text-right">Received</th><th>Check ref</th><th>Method</th><th></th></tr></thead>
                <tbody>
                  {info.payments.length === 0 && <tr><td colSpan={8} className="empty-state">No payments yet.</td></tr>}
                  {info.payments.map((p) => (
                    <tr key={p.id}>
                      <td>{p.payment_date ? formatLongDate(p.payment_date) : '—'}</td>
                      <td className="text-right num">{peso(p.net_amount !== null && p.net_amount !== undefined ? p.net_amount : p.amount)}</td>
                      <td className="text-right num" title="Provider Excess + Concern Amount + Disc entered with this payment">{(Number(p.pe_amount) || 0) + (Number(p.ca_amount) || 0) + (Number(p.dc_amount) || 0) > 0.009 ? peso((Number(p.pe_amount) || 0) + (Number(p.ca_amount) || 0) + (Number(p.dc_amount) || 0)) : '—'}</td>
                      <td className="text-right num">{Number(p.tax_amount) > 0.009 ? peso(p.tax_amount) : '—'}</td>
                      <td className="text-right num"><b>{peso(p.amount)}</b></td>
                      <td>{p.check_ref || '—'}</td>
                      <td>{[p.payment_method, p.payment_method_bank === 'Other' ? p.payment_method_other : p.payment_method_bank].filter(Boolean).join(' · ') || '—'}</td>
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <button type="button" className="btn btn-secondary btn-sm" title="Show this payment like the SOA sheet" disabled={busy} onClick={() => setSheet(p.id)} style={{ marginRight: 4 }}>Sheet</button>
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
                {info.payments.length > 0 && <button type="button" className="btn btn-secondary" onClick={() => setSheet('all')} style={{ marginLeft: 8 }}>View sheet{info.payments.length > 1 ? ` (all ${info.payments.length} payments)` : ''}</button>}
              </div>
            )}

            {form && (
              <form className="pm-form" onSubmit={save}>
                <h3>{form.id ? 'Edit payment' : 'New payment'}</h3>
                <div className="form-grid">
                  <div className="form-group"><label>Net amount processed *</label>
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
                  <div className="pm-deduct-head">Deductions <span>taken off this payment (a deduction counts while its switch is on in the ledger)</span></div>
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
                      <div className="form-group"><label>Tax W/H ({Number(info.tax_percent) || 0}% of net minus deductions)</label>
                        <div className="pm-tax">
                          <button type="button" className={`tax-switch${form.pay_tax ? ' on' : ''}`} aria-label={form.pay_tax ? 'Turn Tax W/H off for this payment' : 'Turn Tax W/H on for this payment'}
                            onClick={() => setForm({ ...form, pay_tax: !form.pay_tax })}><span /></button>
                          <span>{form.pay_tax ? `On: ${Number(info.tax_percent) || 0}% is withheld from this payment` : 'Off: no tax withheld on this payment'}</span>
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
                  const dash = (v) => (v > 0.005 ? '− ' + peso(v) : '—');
                  return (
                    <div className="pm-calc" aria-live="polite">
                      <div className="pm-calc-title">This payment</div>
                      <table className="pm-calc-one">
                        <tbody>
                          <tr><td>Net amount processed</td><td className="num">{peso(calc.net)}</td></tr>
                          <tr><td>Provider Excess{calc.flags.pe ? null : off}</td><td className="num">{dash(calc.flags.pe ? calc.typed.pe : 0)}</td></tr>
                          <tr><td>Concern Amount{calc.flags.ca ? null : off}</td><td className="num">{dash(calc.flags.ca ? calc.typed.ca : 0)}</td></tr>
                          <tr><td>Disc{calc.flags.dc ? null : off}</td><td className="num">{dash(calc.flags.dc ? calc.typed.dc : 0)}</td></tr>
                          {!calc.isCharge && <tr><td>Tax W/H ({calc.pct}% of {peso(Math.max(0, calc.net - calc.dedThis))}){form.pay_tax ? null : <span className="pm-calc-off"> · off</span>}</td><td className="num">{dash(calc.taxThis)}</td></tr>}
                          <tr className="pm-calc-total is-ok"><td>Amount received</td><td className="num">{peso(calc.received)}</td></tr>
                        </tbody>
                      </table>
                      {!calc.isCharge && <div className="pm-calc-alt">Amount received with tax: <b className="num">{peso(calc.withTax)}</b> · without tax: <b className="num">{peso(calc.withoutTax)}</b></div>}
                      <div className="pm-calc-title" style={{ marginTop: 14 }}>Whole SOA: now → this payment → after saving</div>
                      <table>
                        <thead><tr><th></th><th>Now</th><th>This payment</th><th>After</th></tr></thead>
                        <tbody>
                          <tr><td>Amount in SOA</td><td className="num">{peso(calc.amount)}</td><td className="num pm-calc-add">—</td><td className="num">{peso(calc.amount)}</td></tr>
                          {!calc.isCharge && line(`Tax W/H (${calc.pct}%)`, calc.tax, true)}
                          {line('Provider Excess', calc.pe, true, calc.flags.pe ? null : off)}
                          {line('Concern Amount', calc.ca, true, calc.flags.ca ? null : off)}
                          {line('Disc', calc.dc, true, calc.flags.dc ? null : off)}
                          <tr className="pm-calc-total"><td>Receivable</td><td className="num">{peso(calc.receivable.now)}</td><td className="num pm-calc-add">{sign(calc.receivable.add, false)}</td><td className="num">{peso(calc.receivable.after)}</td></tr>
                          <tr><td>Paid (amount received)</td><td className="num">{peso(calc.paid.now)}</td><td className="num pm-calc-add">{sign(calc.paid.add, false)}</td><td className="num">{peso(calc.paid.after)}</td></tr>
                          <tr className={`pm-calc-total${calc.balance.after > 0.009 ? ' is-due' : ' is-ok'}`}><td>Remaining balance</td><td className="num">{peso(calc.balance.now)}</td><td className="num pm-calc-add">{sign(calc.balance.add, false)}</td><td className="num">{peso(calc.balance.after)}</td></tr>
                        </tbody>
                      </table>
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
      {sheet !== null && info && info.enabled && (
        <PaymentSheet entry={entry} e={e} taxPercent={Number(info.tax_percent) || 0} payments={info.payments} only={sheet === 'all' ? null : sheet} onClose={() => setSheet(null)} />
      )}
    </div>
  );
}

const ORD = ['FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH', 'SEVENTH', 'EIGHTH', 'NINTH', 'TENTH'];

// The payments of one SOA laid out like the Excel sheet: one block per payment (First payment, Second payment, ...)
function PaymentSheet({ entry, e, taxPercent, payments, only, onClose }) {
  const n = (v) => Number(v) || 0;
  const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
  const isCharge = entry.account_type === 'CHARGE';
  const soa = r2(n(e.amount) + n(e.surcharge) - n(e.rebate)); // Amount in SOA
  let cum = 0;
  const blocks = payments.map((p, i) => {
    const ded = n(p.pe_amount) + n(p.ca_amount) + n(p.dc_amount);
    const modern = p.net_amount !== null && p.net_amount !== undefined;
    // an older payment only knows what was received: its tax is worked out from it (received x tax% / (100 - tax%))
    const tax = modern ? n(p.tax_amount)
      : ((isCharge || e.tax_off || taxPercent <= 0 || taxPercent >= 100) ? 0 : r2((n(p.amount) * taxPercent) / (100 - taxPercent)));
    const net = modern ? n(p.net_amount) : r2(n(p.amount) + ded + tax);
    cum = r2(cum + net);
    return { p, i, net, tax, remaining: Math.max(0, r2(soa - cum)) };
  });
  const shown = only === null ? blocks : blocks.filter((b) => b.p.id === only);
  const month = (() => {
    const d = entry.period_date ? new Date(`${String(entry.period_date).slice(0, 10)}T00:00:00`) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toLocaleString('en-US', { month: 'long', year: 'numeric' }) : '';
  })();
  const money = (v) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <div className="pm-backdrop" style={{ zIndex: 1100 }} onMouseDown={(ev) => { if (ev.target === ev.currentTarget) onClose(); }}>
      <div className="pm-card pm-sheet-card" role="dialog" aria-modal="true" aria-label="Payment sheet">
        <div className="pm-head">
          <div>
            <h2>{month || 'Payment sheet'}{entry.soa_number ? ` · ${entry.soa_number}` : ''}</h2>
            <div className="pm-sub">{only === null ? 'All payments of this SOA' : 'One payment of this SOA'}, laid out like the Excel sheet.</div>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>
        <table className="pm-sheet">
          <tbody>
            <tr><td>Amount in SOA</td><td className="num">{money(soa)}</td></tr>
          </tbody>
        </table>
        {shown.map(({ p, i, net, tax, remaining }) => (
          <table className="pm-sheet" key={p.id}>
            <thead><tr><th colSpan={2}>{(ORD[i] || `${i + 1}TH`)} PAYMENT{p.payment_date ? <span> · {formatLongDate(p.payment_date)}</span> : null}</th></tr></thead>
            <tbody>
              <tr><td>NET AMOUNT PROCESSED</td><td className="num">{money(net)}</td></tr>
              <tr><td>DISCOUNT</td><td className="num">{money(n(p.dc_amount))}</td></tr>
              <tr><td>PROVIDED EXCESS</td><td className="num">{money(n(p.pe_amount))}</td></tr>
              <tr><td>CONCERN AMOUNT</td><td className="num">{money(n(p.ca_amount))}</td></tr>
              <tr><td>TAX</td><td className="num">{money(tax)}</td></tr>
              <tr className="pm-sheet-recv"><td>AMOUNT RECEIVED</td><td className="num">{money(n(p.amount))}</td></tr>
              <tr className={remaining > 0.009 ? 'pm-sheet-due' : 'pm-sheet-ok'}><td>REMAINING BALANCE</td><td className="num">{money(remaining)}</td></tr>
            </tbody>
          </table>
        ))}
      </div>
    </div>
  );
}