// The Main page maths, shared by Main and Cash Position so both always agree.
// d = { passbook, deposit, aub, pull: [{amount}], checks: [{id, name, amount}], receivables }  (plain numbers)
// linked = paid + released payables from Running Payables ([{payee, amount}]), running = unpaid total
const key = (n, a) => `${String(n).trim().toLowerCase()}|${Number(a).toFixed(2)}`;

export function computeMain(d, linked, running, extra = 0) {
  // extra = Past due + Due this month from the ledger (automatic), added on top of the typed Receivables
  // a typed check with the same payee + amount as a released payable is not counted twice
  const linkedKeys = new Set(linked.map((c) => key(c.payee, c.amount)));
  const dupIds = new Set(d.checks.filter((c) => linkedKeys.has(key(c.name, c.amount))).map((c) => c.id));
  const linkedTotal = linked.reduce((t, c) => t + c.amount, 0);
  const manualTotal = d.checks.reduce((t, c) => (dupIds.has(c.id) ? t : t + c.amount), 0);
  const checksTotal = linkedTotal + manualTotal;
  const checksCount = linked.length + d.checks.length - dupIds.size;
  const available = d.passbook - checksTotal;
  const excess = available + d.deposit - running;
  const pulls = d.pull.reduce((t, p) => t + p.amount, 0);
  const after = d.aub + excess - pulls;
  // typed "Running payables as of" line: taken off (Less) unless it was switched to Add
  const runExtra = (d.run_extra_add ? 1 : -1) * (Number(d.run_extra) || 0);
  const total = after + d.receivables + runExtra + (Number(extra) || 0);
  return { checksTotal, checksCount, dupIds, linkedKeys, available, excess, pulls, after, total, runExtra };
}