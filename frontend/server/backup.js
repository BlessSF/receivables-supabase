// Database backup (Settings -> Backup). Admin only. It only READS the database (one read-only snapshot).
//   Excel: one sheet per table, easy to open and read (password hashes are left out).
//   SQL:   the full database (tables + data) that can be run in an empty Supabase / Postgres to restore it.
import ExcelJS from 'exceljs';
import { all, transaction } from './db.js';
import { getSetting, setSetting } from './lib.js';

const NUMERIC = new Set(['smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision']);
const SECRET_COL = /pass(word)?|hash|secret|token/i;
const qi = (s) => `"${String(s).replace(/"/g, '""')}"`;

/** Reads every table of the public schema in one read-only snapshot. */
export async function readEverything() {
  return transaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const tables = (await all(
      `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`, [], client)).map((r) => r.name);
    const out = [];
    for (const name of tables) {
      const cols = await all(
        `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, t.typname AS udt,
                (SELECT data_type FROM information_schema.columns ic WHERE ic.table_schema = 'public' AND ic.table_name = c.relname AND ic.column_name = a.attname) AS data_type,
                a.attnotnull AS notnull, pg_get_expr(d.adbin, d.adrelid) AS def
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_type t ON t.oid = a.atttypid
         LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
         WHERE n.nspname = 'public' AND c.relname = ? AND a.attnum > 0 AND NOT a.attisdropped
         ORDER BY a.attnum`, [name], client);
      const cons = await all(
        `SELECT con.conname AS name, con.contype AS kind, pg_get_constraintdef(con.oid) AS def, con.conindid AS idx
         FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = ? AND con.contype IN ('p', 'u', 'f', 'c') ORDER BY con.contype DESC, con.conname`, [name], client);
      const indexes = await all(
        `SELECT i.indexname AS name, i.indexdef AS def FROM pg_indexes i
         WHERE i.schemaname = 'public' AND i.tablename = ?
           AND i.indexname NOT IN (SELECT con.conname FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
                                   JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = ? AND con.contype IN ('p', 'u'))
         ORDER BY i.indexname`, [name, name], client);
      const rows = await all(`SELECT * FROM ${qi(name)}`, [], client);
      const seq = cols.some((c) => c.name === 'id')
        ? await all('SELECT pg_get_serial_sequence(?, ?) AS s', [`public.${qi(name)}`, 'id'], client) : [];
      out.push({ name, cols, cons, indexes, rows, hasSerialId: !!seq[0]?.s });
    }
    return out;
  });
}

// ---------------------------------------------------------------- Excel

const sheetName = (name, used) => {
  let base = name.replace(/[\\/?*[\]:]/g, '_').slice(0, 31) || 'table';
  let n = base; let i = 2;
  while (used.has(n.toLowerCase())) n = `${base.slice(0, 28)}_${i++}`;
  used.add(n.toLowerCase());
  return n;
};

export async function buildExcel(tables, who) {
  const wb = new ExcelJS.Workbook();
  wb.creator = who || 'Receivables system';
  wb.created = new Date();
  const used = new Set(['backup info']);

  const info = wb.addWorksheet('Backup info');
  info.addRow(['Database backup']).font = { bold: true, size: 14 };
  info.addRow(['Taken', new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC']);
  info.addRow(['Taken by', who || '']);
  info.addRow(['Note', 'Password hashes are not included in this Excel copy. Use the SQL backup to restore the whole database.']);
  info.addRow([]);
  const head = info.addRow(['Table', 'Rows']);
  head.font = { bold: true };
  for (const t of tables) info.addRow([t.name, t.rows.length]);
  info.getColumn(1).width = 28; info.getColumn(2).width = 14;

  for (const t of tables) {
    const cols = t.cols.filter((c) => !SECRET_COL.test(c.name));
    const ws = wb.addWorksheet(sheetName(t.name, used), { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.addRow(cols.map((c) => c.name));
    const h = ws.getRow(1);
    h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2D4D' } };
    const widths = cols.map((c) => Math.max(10, c.name.length + 2));
    for (const r of t.rows) {
      const line = cols.map((c, i) => {
        let v = r[c.name];
        if (v === null || v === undefined) return null;
        if (typeof v === 'object') v = v instanceof Date ? v.toISOString() : JSON.stringify(v);
        else if (NUMERIC.has(c.data_type) && v !== '' && isFinite(Number(v))) v = Number(v);
        else v = String(v).slice(0, 32000);
        widths[i] = Math.max(widths[i], Math.min(48, String(v).length + 2));
        return v;
      });
      ws.addRow(line);
    }
    cols.forEach((_, i) => { ws.getColumn(i + 1).width = widths[i]; });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------- SQL

function literal(v, col) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(v);
  if (Buffer.isBuffer(v)) return `'\\x${v.toString('hex')}'`;
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (typeof v === 'object') {
    const s = `'${JSON.stringify(v).replace(/'/g, "''")}'`;
    return /^json/i.test(col.udt) ? `${s}::${col.udt}` : s;
  }
  const s = String(v);
  if (NUMERIC.has(col.data_type) && /^-?\d+(\.\d+)?$/.test(s)) return s;
  return `'${s.replace(/'/g, "''")}'`;
}

export function buildSql(tables, who) {
  const L = [];
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  L.push('-- Receivables database backup');
  L.push(`-- Taken: ${stamp}${who ? ` by ${who}` : ''}`);
  L.push('-- To restore: open the Supabase SQL Editor of an EMPTY project, paste this whole file and run it.');
  L.push('-- It creates the tables, loads every row, then adds the links between tables. Keep this file private:');
  L.push('-- it contains user password hashes.');
  L.push('BEGIN;');
  L.push('');
  for (const t of tables) {
    const defs = t.cols.map((c) => {
      const serial = /^nextval\(/i.test(c.def || '') && (c.type === 'bigint' || c.type === 'integer' || c.type === 'smallint');
      if (serial) return `  ${qi(c.name)} ${c.type === 'bigint' ? 'BIGSERIAL' : c.type === 'smallint' ? 'SMALLSERIAL' : 'SERIAL'}`;
      return `  ${qi(c.name)} ${c.type}${c.def ? ` DEFAULT ${c.def}` : ''}${c.notnull ? ' NOT NULL' : ''}`;
    });
    for (const k of t.cons) if (k.kind === 'p' || k.kind === 'u' || k.kind === 'c') defs.push(`  CONSTRAINT ${qi(k.name)} ${k.def}`);
    L.push(`CREATE TABLE IF NOT EXISTS ${qi(t.name)} (\n${defs.join(',\n')}\n);`);
    for (const ix of t.indexes) L.push(`${ix.def.replace(/^CREATE (UNIQUE )?INDEX /i, 'CREATE $1INDEX IF NOT EXISTS ')};`);
    L.push('');
  }
  for (const t of tables) {
    L.push(`-- ${t.name}: ${t.rows.length} ${t.rows.length === 1 ? 'row' : 'rows'}`);
    const names = t.cols.map((c) => qi(c.name)).join(', ');
    for (let i = 0; i < t.rows.length; i += 200) {
      const part = t.rows.slice(i, i + 200).map((r) => `(${t.cols.map((c) => literal(r[c.name], c)).join(', ')})`);
      L.push(`INSERT INTO ${qi(t.name)} (${names}) VALUES\n${part.join(',\n')};`);
    }
    if (t.hasSerialId) {
      L.push(`SELECT setval(pg_get_serial_sequence('public.${t.name.replace(/'/g, "''")}', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM ${qi(t.name)};`);
    }
    L.push('');
  }
  for (const t of tables) {
    for (const k of t.cons.filter((x) => x.kind === 'f')) {
      L.push(`DO $$ BEGIN ALTER TABLE ${qi(t.name)} ADD CONSTRAINT ${qi(k.name)} ${k.def}; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    }
  }
  L.push('');
  L.push('COMMIT;');
  return L.join('\n') + '\n';
}

// ---------------------------------------------------------------- log (who backed up, when)

const LOG_KEY = 'backup_log';

export async function readLog() {
  try {
    const list = JSON.parse(await getSetting(LOG_KEY, '[]'));
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

export async function addLog(entry) {
  const list = await readLog();
  list.unshift(entry);
  await setSetting(LOG_KEY, JSON.stringify(list.slice(0, 30)));
}

export async function backupInfo() {
  const log = await readLog();
  const names = (await all(
    `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`)).map((r) => r.name);
  const tables = [];
  for (const name of names) {
    const r = await all(`SELECT COUNT(*) AS n FROM ${qi(name)}`);
    tables.push({ name, rows: Number(r[0].n) });
  }
  const last = log[0] || null;
  const days = last ? Math.floor((Date.now() - new Date(last.at).getTime()) / 86400000) : null;
  return { last, days, log: log.slice(0, 8), tables };
}

/** Express-style handler used by /export_xlsx.php?type=backup&format=xlsx|sql */
export async function makeBackupFile(format, who) {
  const tables = await readEverything();
  const rowsTotal = tables.reduce((n, t) => n + t.rows.length, 0);
  const day = new Date().toISOString().slice(0, 10);
  const file = format === 'sql'
    ? { bytes: Buffer.from(buildSql(tables, who), 'utf8'), type: 'application/sql; charset=utf-8', name: `backup-${day}.sql` }
    : { bytes: await buildExcel(tables, who), type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', name: `backup-${day}.xlsx` };
  await addLog({ at: new Date().toISOString(), by: who || '', kind: format === 'sql' ? 'SQL' : 'Excel', tables: tables.length, rows: rowsTotal });
  return file;
}