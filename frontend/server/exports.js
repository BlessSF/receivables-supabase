// CSV / Excel downloads -- port of backend/export_csv.php and export_xlsx.php
import ExcelJS from 'exceljs';
import { all, scalar } from './db.js';
import { getQuery, sendText, sendFile } from './http.js';
import { readSession, makeAuth } from './auth.js';
import { toInt, toFloat, toStr } from './php.js';
import { excelSerial, periodLabel } from './dates.js';
import { buildMonthlyReport } from './monthly.js';
import {
  daysOverdue, agingBucket, agingRangeFromRequest, agingInRange, makeImplicitDue, dueOf,
  branchWhere, branchWhereStandalone, canAccessCompany,
} from './lib.js';

// ---------------------------------------------------------------- shared data

async function loadCompanies(auth) {
  const [bs, bp] = branchWhereStandalone(auth, 'c');
  return all(`SELECT * FROM companies c${bs} ORDER BY UPPER(c.name) COLLATE "C" ASC, c.id ASC`, bp);
}

/** Open entries with their due date / days overdue / bucket, filtered by the aging range. */
async function loadAgingRows(auth, query) {
  const [rangeFrom, rangeTo] = agingRangeFromRequest(query);
  const [bw, bp] = branchWhere(auth, 'c');
  const entries = await all(
    `SELECT l.*, c.name as company_name FROM ledger_entries l JOIN companies c ON c.id=l.company_id
     WHERE l.balance > 0.009 ${bw} ORDER BY UPPER(c.name) COLLATE "C", l.id`, bp);
  const due = await makeImplicitDue();
  const out = [];
  for (const r of entries) {
    const dueDate = dueOf(r, due);
    const d = daysOverdue(dueDate);
    if (!agingInRange(d, rangeFrom, rangeTo)) continue;
    out.push({ r, due: dueDate, days: d, bucket: agingBucket(d) });
  }
  return out;
}

async function loadLedger(auth, companyId) {
  let sql = 'SELECT l.*, c.name as company_name FROM ledger_entries l JOIN companies c ON c.id=l.company_id';
  let params = [];
  if (companyId) {
    sql += ' WHERE l.company_id=?';
    params.push(companyId);
  } else {
    const [bs, bp] = branchWhereStandalone(auth, 'c');
    sql += bs;
    params = bp;
  }
  sql += ' ORDER BY UPPER(c.name) COLLATE "C" ASC, UPPER(l.billing_date) COLLATE "C" ASC NULLS FIRST, l.id ASC';
  return all(sql, params);
}

function paymentMethodLabel(r) {
  let method = r.payment_method ?? '';
  if (method === 'Card') {
    const bank = r.payment_method_bank ?? '';
    method = 'Card' + (bank ? ' - ' + (bank === 'Other' ? r.payment_method_other ?? 'Other' : bank) : '');
  }
  return method;
}

async function resolveCompanyId(auth, query, allowEmptyString) {
  let id = null;
  if (query.company_id !== undefined && (allowEmptyString || query.company_id !== '')) id = toInt(query.company_id);
  // Don't leak another branch's ledger via a guessed company_id.
  if (id && !(await canAccessCompany(auth, id))) id = null;
  return id;
}

// ---------------------------------------------------------------- CSV

function csvCell(v) {
  // Same quoting rule as PHP's fputcsv()
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r\t \\]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function csv(header, rows) {
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
}

// Owner / accounting accounts can only download the report exports.
function blockedForExecutive(user, type) {
  return user.role === 'executive' && type !== 'aging' && type !== 'past_due';
}

export async function handleCsv(req, res) {
  const user = readSession(req);
  if (!user) return sendText(res, 401, 'Not logged in.');
  const auth = makeAuth(user);
  const query = getQuery(req);
  const type = query.type ?? 'ledger';
  if (blockedForExecutive(user, type)) return sendText(res, 403, 'Your account can download reports only.');
  const companyId = await resolveCompanyId(auth, query, false);
  const send = (name, text) => sendFile(res, Buffer.from(text, 'utf8'), 'text/csv; charset=utf-8', name);

  if (type === 'companies') {
    const rows = (await loadCompanies(auth)).map((c) => [c.name, c.code, c.status, c.contact_person, c.contact_number, c.email_address, c.remarks]);
    return send('companies.csv', csv(['Name', 'Code', 'Status', 'Contact Person', 'Contact Number', 'Email', 'Remarks'], rows));
  }
  if (type === 'aging') {
    const rows = (await loadAgingRows(auth, query)).map(({ r, due, days, bucket }) =>
      [r.company_name, r.billing_date, r.soa_number, due, r.balance, days, bucket]);
    return send('aging_report.csv', csv(['Company', 'Billing Date', 'SOA #', 'Due Date', 'Balance', 'Days Overdue', 'Aging Bucket'], rows));
  }
  if (type === 'past_due') {
    const rows = (await loadAgingRows(auth, {}))
      .filter(({ days }) => days !== null && days > 0)
      .map(({ r, due, days }) => [r.company_name, r.billing_date, due, days, r.balance]);
    return send('past_due.csv', csv(['Company', 'Billing Date', 'Due Date', 'Days Overdue', 'Balance'], rows));
  }

  const rows = (await loadLedger(auth, companyId)).map((r) => [
    r.company_name, r.billing_date, periodLabel(r.period_date), r.soa_number, r.amount, r.tax_withheld, r.surcharge, r.rebate,
    r.receivable_amount, r.payment_date, r.check_ref, r.check_date ?? '', r.paid_amount, r.balance,
    paymentMethodLabel(r), r.due_date, r.remarks,
  ]);
  return send(companyId ? `ledger_company_${companyId}.csv` : 'full_receivable_ledger.csv', csv([
    'Company', 'Billing Date', 'Period Date', 'SOA #', 'Amount', 'Tax Withheld', 'Surcharge', 'Rebate',
    'Receivable', 'Payment Date', 'Check #', 'Check Date', 'Paid', 'Balance', 'Payment Method', 'Due Date', 'Remarks',
  ], rows));
}

// ---------------------------------------------------------------- XLSX

// Same palette/formatting as the old PHP xlsx_writer.php
const PALETTE = {
  accent: 'FF2E6EE0', band: 'FFEEF0F4',
  red: 'FFC22B2B', red_bg: 'FFFBE7E7', amber: 'FFB4790C', amber_bg: 'FFFDF1DC',
  orange: 'FFC15A10', orange_bg: 'FFFDEAD9', green: 'FF1A8A4A', green_bg: 'FFE7F7EE', gray: 'FF6B7688',
};
const BADGES = {
  red: [PALETTE.red, PALETTE.red_bg], amber: [PALETTE.amber, PALETTE.amber_bg], orange: [PALETTE.orange, PALETTE.orange_bg],
  green: [PALETTE.green, PALETTE.green_bg], gray: [PALETTE.gray, PALETTE.band],
};
const NUMFMT = { money: '"₱"#,##0.00', date: 'm/d/yyyy', int: '#,##0' };
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

function bucketBadge(bucket) {
  return { 'Not Yet Due': 'gray', '0-30 days': 'green', '31-60 days': 'amber', '61-90 days': 'orange', 'Over 90 days': 'red' }[bucket] ?? null;
}

class Sheet {
  constructor(wb, name, columns, { freezeFirstCol = false } = {}) {
    this.columns = columns;
    this.ws = wb.addWorksheet(name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31), {
      views: [{ state: 'frozen', xSplit: freezeFirstCol ? 1 : 0, ySplit: 1 }],
      properties: { defaultRowHeight: 18 },
    });
    this.ws.columns = columns.map((c) => ({ width: c.width ?? 14 }));
    const header = this.ws.getRow(1);
    header.height = 20;
    columns.forEach((c, i) => {
      const cell = header.getCell(i + 1);
      cell.value = c.header;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = fill(PALETTE.accent);
      cell.alignment = { horizontal: 'left' };
      const b = { style: 'thin', color: { argb: 'FFE3E6EC' } };
      cell.border = { left: b, right: b, top: b, bottom: b };
    });
    this.ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    this.count = 0;
  }

  align(col, isTotals = false) {
    if (col.align) return col.align;
    if (col.type === 'money' || col.type === 'int') return 'right';
    if (col.type === 'date' && !isTotals) return 'center';
    return 'left';
  }

  setValue(cell, col, value, isTotals) {
    if (value === null || value === undefined || value === '') return;
    if (col.type === 'money' || col.type === 'int') {
      const n = Number(value);
      // round to centavos so summed totals don't show float noise like 0.0599999
      cell.value = Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
    } else if (col.type === 'date' && !isTotals) {
      const serial = excelSerial(value);
      cell.value = serial === null ? toStr(value) : serial;
    } else {
      cell.value = toStr(value);
    }
  }

  addRow(values, highlights = {}) {
    const band = this.count % 2 === 1;
    this.count++;
    const row = this.ws.getRow(this.count + 1);
    this.columns.forEach((col, i) => {
      const cell = row.getCell(i + 1);
      this.setValue(cell, col, values[i], false);
      if (NUMFMT[col.type]) cell.numFmt = NUMFMT[col.type];
      cell.alignment = { horizontal: this.align(col) };
      const badge = highlights[i];
      if (badge) {
        const [color, bg] = BADGES[badge] ?? [null, null];
        cell.font = color ? { bold: true, color: { argb: color } } : { bold: true };
        if (bg) cell.fill = fill(bg);
      } else if (band) {
        cell.fill = fill(PALETTE.band);
      }
    });
  }

  setTotals(values) {
    const row = this.ws.getRow(this.count + 2);
    this.columns.forEach((col, i) => {
      const cell = row.getCell(i + 1);
      this.setValue(cell, col, values[i], true);
      if (NUMFMT[col.type]) cell.numFmt = NUMFMT[col.type];
      cell.font = { bold: true };
      cell.fill = fill(PALETTE.band);
      cell.alignment = { horizontal: this.align(col, true) };
    });
  }
}

// "Reports by Month": same layout as the Excel sheet the team used to keep by hand.
// Company | OVERDUE (SOA / month / balance) | DUE FOR <month> | DUE FOR <next month>
function writeMonthlySheet(wb, report, preparedBy) {
  const RED = 'FFD3202A';
  const BLUE = 'FF1A47D6';
  const WHITE = { argb: 'FFFFFFFF' };
  const line = { style: 'thin', color: { argb: 'FFB9C0CA' } };
  const box = { left: line, right: line, top: line, bottom: line };
  const MONEY = '#,##0.00';

  const ws = wb.addWorksheet('Reports by Month', { views: [{ state: 'frozen', xSplit: 1, ySplit: 2 }] });
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  ws.columns = [
    { width: 30 },
    { width: 14 }, { width: 17 }, { width: 20 }, { width: 3 },
    { width: 14 }, { width: 17 }, { width: 20 }, { width: 3 },
    { width: 14 }, { width: 17 }, { width: 20 },
  ];

  // blocks: first column index (1-based) of each SOA / MONTH / BALANCE trio
  const blocks = [
    { key: 'overdue', col: 2, title: 'OVERDUE', color: RED, totalLabel: 'OVERDUE TOTAL' },
    { key: 'due1', col: 6, title: `DUE FOR ${report.month_name.toUpperCase()} ${report.month.slice(0, 4)}`, color: BLUE, totalLabel: `${report.month_name.toUpperCase()} DUE TOTAL:` },
    { key: 'due2', col: 10, title: `DUE FOR ${report.next_name.toUpperCase()} ${report.next_month.slice(0, 4)}`, color: BLUE, totalLabel: `${report.next_name.toUpperCase()} DUE TOTAL:` },
  ];

  // ---- header rows
  ws.mergeCells(1, 1, 2, 1);
  const head = ws.getCell(1, 1);
  head.value = 'COMPANY';
  head.font = { bold: true };
  head.alignment = { horizontal: 'left', vertical: 'middle' };
  head.border = box;
  for (const b of blocks) {
    ws.mergeCells(1, b.col, 1, b.col + 2);
    const t = ws.getCell(1, b.col);
    t.value = b.title;
    t.font = { bold: true, size: 13, color: WHITE };
    t.fill = fill(b.color);
    t.alignment = { horizontal: 'center', vertical: 'middle' };
    for (let i = 0; i < 3; i++) ws.getCell(1, b.col + i).border = box;
    ['SOA NUMBER', 'MONTH', 'REMAINING BALANCE'].forEach((label, i) => {
      const c = ws.getCell(2, b.col + i);
      c.value = label;
      c.font = { bold: true, size: 10 };
      c.alignment = { horizontal: i === 2 ? 'right' : 'center', vertical: 'middle' };
      c.border = box;
    });
  }
  ws.getRow(1).height = 22;
  ws.getRow(2).height = 18;

  // ---- one block of rows per company (as many lines as its longest column)
  let r = 3;
  for (const c of report.companies) {
    const n = Math.max(1, c.overdue.length, c.due1.length, c.due2.length);
    if (n > 1) ws.mergeCells(r, 1, r + n - 1, 1);
    const name = ws.getCell(r, 1);
    name.value = c.company;
    name.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    for (let i = 0; i < n; i++) ws.getCell(r + i, 1).border = box;
    for (const b of blocks) {
      for (let i = 0; i < n; i++) {
        const item = c[b.key][i];
        const soa = ws.getCell(r + i, b.col);
        const month = ws.getCell(r + i, b.col + 1);
        const bal = ws.getCell(r + i, b.col + 2);
        if (item) {
          soa.value = item.soa_number || '';
          month.value = item.period || '';
          bal.value = Math.round(item.balance * 100) / 100;
        }
        bal.numFmt = MONEY;
        soa.alignment = { horizontal: 'center' };
        month.alignment = { horizontal: 'center' };
        bal.alignment = { horizontal: 'right' };
        for (const cell of [soa, month, bal]) cell.border = box;
      }
    }
    r += n;
  }

  // ---- totals bar
  r += 1;
  for (const b of blocks) {
    const total = report.totals[b.key];
    ws.mergeCells(r, b.col, r, b.col + 1);
    const label = ws.getCell(r, b.col);
    label.value = b.totalLabel;
    const amount = ws.getCell(r, b.col + 2);
    amount.value = Math.round(total * 100) / 100;
    amount.numFmt = MONEY;
    amount.alignment = { horizontal: 'right' };
    for (const cell of [label, ws.getCell(r, b.col + 1), amount]) {
      cell.fill = fill(b.color);
      cell.font = { bold: true, color: WHITE };
    }
  }
  if (preparedBy) {
    ws.getCell(r + 3, 1).value = 'Prepared by:';
    ws.getCell(r + 3, 1).font = { bold: true };
    ws.getCell(r + 4, 1).value = preparedBy;
  }
  if (report.no_period.count > 0) {
    ws.getCell(r + 6, 1).value = `Not included: ${report.no_period.count} open entr${report.no_period.count === 1 ? 'y' : 'ies'} with no Period Date (${(Math.round(report.no_period.total * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}).`;
    ws.getCell(r + 6, 1).font = { italic: true, color: { argb: 'FF6B7688' } };
  }
}

export async function handleXlsx(req, res) {
  const user = readSession(req);
  if (!user) return sendText(res, 401, 'Not logged in.');
  const auth = makeAuth(user);
  const query = getQuery(req);
  const type = query.type ?? 'ledger';
  // (the Excel export has no separate past-due sheet, so only "aging" is allowed here)
  if (user.role === 'executive' && type !== 'aging' && type !== 'monthly') return sendText(res, 403, 'Your account can download reports only.');
  const companyId = await resolveCompanyId(auth, query, true);
  const wb = new ExcelJS.Workbook();
  const send = async (name) => {
    const bytes = Buffer.from(await wb.xlsx.writeBuffer());
    sendFile(res, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', name);
  };

  if (type === 'companies') {
    const sheet = new Sheet(wb, 'Companies', [
      { header: 'Name', width: 26, type: 'string' },
      { header: 'Code', width: 12, type: 'string' },
      { header: 'Status', width: 12, type: 'string', align: 'center' },
      { header: 'Contact Person', width: 20, type: 'string' },
      { header: 'Contact Number', width: 16, type: 'string' },
      { header: 'Email', width: 26, type: 'string' },
      { header: 'Remarks', width: 28, type: 'string' },
    ]);
    for (const c of await loadCompanies(auth)) {
      const status = c.status ?? '';
      const badge = status.toLowerCase() === 'active' ? 'green' : status.toLowerCase() === 'inactive' ? 'gray' : null;
      sheet.addRow([c.name, c.code, status, c.contact_person, c.contact_number, c.email_address, c.remarks], badge ? { 2: badge } : {});
    }
    return send('companies.xlsx');
  }

  if (type === 'monthly') {
    const report = await buildMonthlyReport(auth, query);
    writeMonthlySheet(wb, report, user.full_name || user.username || '');
    return send(`reports_by_month_${report.month}.xlsx`);
  }

  if (type === 'aging') {
    const sheet = new Sheet(wb, 'Aging Report', [
      { header: 'Company', width: 22, type: 'string' },
      { header: 'Billing Date', width: 13, type: 'date' },
      { header: 'SOA #', width: 14, type: 'string' },
      { header: 'Due Date', width: 13, type: 'date' },
      { header: 'Balance', width: 14, type: 'money' },
      { header: 'Days Overdue', width: 14, type: 'int' },
      { header: 'Aging Bucket', width: 16, type: 'string', align: 'center' },
    ], { freezeFirstCol: true });
    let total = 0;
    for (const { r, due, days, bucket } of await loadAgingRows(auth, query)) {
      const badge = bucketBadge(bucket);
      total += toFloat(r.balance);
      sheet.addRow([r.company_name, r.billing_date, r.soa_number, due, toFloat(r.balance), days, bucket], badge ? { 4: badge, 6: badge } : {});
    }
    sheet.setTotals(['TOTAL', null, null, null, total, null, null]);
    return send('aging_report.xlsx');
  }

  const entries = await loadLedger(auth, companyId);
  const companyName = companyId ? await scalar('SELECT name FROM companies WHERE id = ?', [companyId]) : null;
  const sheet = new Sheet(wb, 'Receivable Ledger', [
    { header: 'Company', width: 22, type: 'string' },
    { header: 'Billing Date', width: 13, type: 'date' },
    { header: 'Period Date', width: 14, type: 'string' },
    { header: 'SOA #', width: 14, type: 'string' },
    { header: 'Amount', width: 13, type: 'money' },
    { header: 'Tax Withheld', width: 13, type: 'money' },
    { header: 'Surcharge', width: 12, type: 'money' },
    { header: 'Rebate', width: 12, type: 'money' },
    { header: 'Receivable', width: 13, type: 'money' },
    { header: 'Payment Date', width: 13, type: 'date' },
    { header: 'Check #', width: 18, type: 'string' },
    { header: 'Check Date', width: 13, type: 'date' },
    { header: 'Paid', width: 13, type: 'money' },
    { header: 'Balance', width: 13, type: 'money' },
    { header: 'Payment Method', width: 20, type: 'string' },
    { header: 'Due Date', width: 13, type: 'date' },
    { header: 'Remarks', width: 26, type: 'string' },
  ], { freezeFirstCol: true });

  const keys = ['amount', 'tax_withheld', 'surcharge', 'rebate', 'receivable_amount', 'paid_amount', 'balance'];
  const totals = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const r of entries) {
    const balance = toFloat(r.balance);
    for (const k of keys) totals[k] += toFloat(r[k]);
    sheet.addRow([
      r.company_name, r.billing_date, periodLabel(r.period_date), r.soa_number, toFloat(r.amount), toFloat(r.tax_withheld),
      toFloat(r.surcharge), toFloat(r.rebate), toFloat(r.receivable_amount), r.payment_date, r.check_ref,
      r.check_date ?? '', toFloat(r.paid_amount), balance, paymentMethodLabel(r), r.due_date, r.remarks,
    ], balance <= 0.009 ? { 13: 'green' } : {});
  }
  sheet.setTotals(['TOTAL', null, null, null, totals.amount, totals.tax_withheld, totals.surcharge, totals.rebate,
    totals.receivable_amount, null, null, null, totals.paid_amount, totals.balance, null, null, null]);

  const filename = companyId
    ? 'ledger_' + (companyName ?? String(companyId)).replace(/[^A-Za-z0-9_-]+/g, '_') + '.xlsx'
    : 'full_receivable_ledger.xlsx';
  return send(filename);
}

export async function safe(handler, req, res) {
  try {
    await handler(req, res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) sendText(res, 500, 'Export failed: ' + (e?.message || 'unknown error'));
  }
}