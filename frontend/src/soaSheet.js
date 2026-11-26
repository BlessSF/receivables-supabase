// Print / PDF / Excel of the SOA sheet shown in the Payments popup (one block per payment).
// `sheet` = { month, soaNumber, company, soa, blocks: [{ title, date, rows: [[label, amount, kind]] }] }
// kind: 'recv' (Amount Received, bold) | 'due' (balance still open, red) | 'ok' (settled, green) | undefined

const money = (v) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const heading = (s) => s.month || 'Payment sheet';
const subHeading = (s) => [s.company, s.soaNumber].filter(Boolean).join(' · ');
const fileName = (s) => ['SOA', s.soaNumber, s.month].filter(Boolean).join(' ').replace(/[\\/:*?"<>|]+/g, '-');

// Opens the browser's print window with only the sheet on the page. "Save as PDF" there makes the PDF file.
export function printSheet(sheet) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(fileName(sheet))}</title><style>
    @page { size: A4 portrait; margin: 16mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; }
    h1 { margin: 0; text-align: center; font-size: 20pt; font-weight: 400; }
    .sub { text-align: center; font-size: 11pt; margin: 4px 0 14px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 11pt; break-inside: avoid; }
    th, td { border: 1px solid #000; padding: 5px 8px; }
    th { font-size: 12.5pt; font-weight: 400; }
    th span { font-size: 9.5pt; }
    td.num { width: 34%; text-align: right; white-space: nowrap; }
    tr.recv td { font-weight: 700; }
    tr.due td.num { background: #ff6b6b; font-weight: 700; }
    tr.ok td.num { background: #7ee787; font-weight: 700; }
  </style></head><body>
    <h1>${esc(heading(sheet))}</h1>
    <div class="sub">${esc(subHeading(sheet))}</div>
    <table><tbody><tr><td>Amount in SOA</td><td class="num">${money(sheet.soa)}</td></tr></tbody></table>
    ${sheet.blocks.map((b) => `<table><thead><tr><th colspan="2">${esc(b.title)}${b.date ? ` <span>· ${esc(b.date)}</span>` : ''}</th></tr></thead><tbody>
      ${b.rows.map(([label, value, kind]) => `<tr class="${kind || ''}"><td>${esc(label)}</td><td class="num">${money(value)}</td></tr>`).join('')}
    </tbody></table>`).join('')}
  </body></html>`;

  // A hidden frame (not a new tab), so no pop-up blocker gets in the way
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(html);
  doc.close();
  const oldTitle = document.title;
  document.title = fileName(sheet); // suggested file name when saving as PDF
  const done = () => { document.title = oldTitle; frame.remove(); };
  frame.contentWindow.addEventListener('afterprint', () => setTimeout(done, 0), { once: true });
  setTimeout(() => { frame.contentWindow.focus(); frame.contentWindow.print(); }, 100);
}

// A real .xlsx laid out like the sheet. The Excel library is only downloaded when this is first used.
export async function downloadSheetXlsx(sheet) {
  const mod = await import('exceljs');
  const ExcelJS = mod.default || mod;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('SOA', { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = [{ width: 40 }, { width: 20 }];
  const side = { style: 'thin', color: { argb: 'FF000000' } };
  const border = { top: side, left: side, bottom: side, right: side };

  const title = (text, size) => {
    const row = ws.addRow([text]);
    ws.mergeCells(row.number, 1, row.number, 2);
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(1).font = { size };
    return row;
  };
  const line = (label, value, kind) => {
    const row = ws.addRow([label, Number(value || 0)]);
    [1, 2].forEach((c) => { row.getCell(c).border = border; });
    row.getCell(2).numFmt = '#,##0.00';
    if (kind) { row.getCell(1).font = { bold: kind === 'recv' }; row.getCell(2).font = { bold: true }; }
    if (kind === 'due' || kind === 'ok') {
      row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: kind === 'due' ? 'FFFF6B6B' : 'FF7EE787' } };
    }
  };

  title(heading(sheet), 18);
  if (subHeading(sheet)) title(subHeading(sheet), 11);
  line('Amount in SOA', sheet.soa);
  sheet.blocks.forEach((b) => {
    ws.addRow([]);
    const head = title(b.date ? `${b.title}  ·  ${b.date}` : b.title, 13);
    [1, 2].forEach((c) => { head.getCell(c).border = border; });
    b.rows.forEach(([label, value, kind]) => line(label, value, kind));
  });

  const buffer = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileName(sheet)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
