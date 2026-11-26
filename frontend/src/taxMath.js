// Tax W/H on money typed straight into "Paid", shared by the server and the screens so they always agree.
//
// What is typed there is the amount RECEIVED, so the tax is worked back from it:
//     received = base - tax   and   tax = tax% x base     =>     tax = received x tax% / (100 - tax%)
//     e.g. 17,485.16 received -> base 17,842.00 -> tax 356.84
// But tax can only be withheld on the SOA itself. Once the SOA is fully paid the tax is exactly tax% of it,
// and anything received on top is a plain overpayment (it carries no tax).
//     e.g. SOA 10,900.00, received 10,700.00 -> tax 218.00 (not 218.37), overpaid 18.00

const n = (v) => Number(v) || 0;
const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

// pct % of an amount, counted in whole centavos so that an exact half (20.005) always rounds up to 20.01
const percentOf = (base, pct) => Math.round((Math.round(base * 100) * pct) / 100) / 100;

// The part of the SOA that typed money can still pay for: Amount - deductions - what Payments-popup entries already cover
export function typedRoom(amount, deductions, netBase) {
  return Math.max(0, r2(n(amount) - n(deductions) - n(netBase)));
}

// Received amount that settles `room` in full (within a centavo, so rounding never leaves 0.01 open)
const settles = (received, room, fullTax) => received >= r2(room - fullTax) - 0.011;

export function typedTax(received, room, pct) {
  const recv = n(received);
  const base = n(room);
  const p = n(pct);
  if (p <= 0 || p >= 100 || recv <= 0 || base <= 0) return 0;
  const fullTax = percentOf(base, p);
  return settles(recv, base, fullTax) ? fullTax : r2((recv * p) / (100 - p));
}

/**
 * One line per payment of an entry, oldest first: { net, pe, ca, dc, tax, over }.
 *   net  = Net amount processed, tax = its Tax W/H, over = money received above what the SOA needed
 * A payment from the Payments popup keeps its saved numbers. A "received only" payment (typed into Paid)
 * is worked out here; deductions typed in the ledger row belong to the first of those.
 */
export function paymentBreakdown(entry, payments, pct, isCharge) {
  const isNet = (p) => p.net_amount !== null && p.net_amount !== undefined;
  const dedOf = (p) => n(p.pe_amount) + n(p.ca_amount) + n(p.dc_amount);
  const entryDed = n(entry.provider_excess) + n(entry.concern_amount) + n(entry.disc_amount);
  const netBase = payments.filter(isNet).reduce((t, p) => t + n(p.net_amount) - dedOf(p), 0);
  const room = typedRoom(entry.amount, entryDed, netBase);
  const taxable = !isCharge && !entry.tax_off && n(pct) > 0 && n(pct) < 100;
  const fullTax = taxable ? percentOf(room, n(pct)) : 0;
  const rowOnly = (field, column) => Math.max(0, r2(n(entry[column]) - payments.reduce((t, p) => t + n(p[field]), 0)));

  let first = true;
  let received = 0;
  let taxSoFar = 0;
  let baseSoFar = 0;
  return payments.map((p) => {
    const line = { pe: n(p.pe_amount), ca: n(p.ca_amount), dc: n(p.dc_amount) };
    if (isNet(p)) return { ...line, net: n(p.net_amount), tax: n(p.tax_amount), over: 0 };
    if (first) {
      line.pe += rowOnly('pe_amount', 'provider_excess');
      line.ca += rowOnly('ca_amount', 'concern_amount');
      line.dc += rowOnly('dc_amount', 'disc_amount');
      first = false;
    }
    received = r2(received + n(p.amount));
    const tax = taxable ? typedTax(received, room, pct) : 0;
    const base = settles(received, room, fullTax) ? room : r2(received + tax);
    const share = r2(base - baseSoFar);
    const shareTax = r2(tax - taxSoFar);
    const over = Math.max(0, r2(n(p.amount) - (share - shareTax)));
    taxSoFar = tax;
    baseSoFar = base;
    return { ...line, net: r2(share + line.pe + line.ca + line.dc), tax: shareTax, over: over > 0.011 ? over : 0 };
  });
}
