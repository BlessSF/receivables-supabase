// PostgreSQL (Supabase) connection -- replaces backend/includes/db.php
import pg from 'pg';

// Return every column as the raw text Postgres sends, exactly like PHP's PDO
// did with MySQL (ids, amounts, dates all arrive as strings). The React
// pages were written against that shape, so keeping it avoids surprises.
for (const oid of [20, 21, 23, 700, 701, 1700, 1082, 1114, 1184]) {
  pg.types.setTypeParser(oid, (v) => v);
}

let pool = null;

function getPool() {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Add your Supabase connection string to the environment variables.');
  }
  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  pool = new pg.Pool({
    connectionString: url,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: 3, // serverless: keep it small, Supabase's pooler does the rest
    idleTimeoutMillis: 10000,
  });
  return pool;
}

/** Converts PDO-style "?" placeholders to Postgres "$1, $2, ..." */
function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/** Runs a query and returns all rows. */
export async function all(sql, params = [], client = null) {
  const res = await (client || getPool()).query(toPg(sql), params);
  return res.rows;
}

/** First row or null. */
export async function one(sql, params = [], client = null) {
  const rows = await all(sql, params, client);
  return rows[0] ?? null;
}

/** First column of the first row, or null (like PDO fetchColumn). */
export async function scalar(sql, params = [], client = null) {
  const res = await (client || getPool()).query({ text: toPg(sql), values: params, rowMode: 'array' });
  return res.rows.length ? res.rows[0][0] : null;
}

/** First column of every row. */
export async function column(sql, params = [], client = null) {
  const res = await (client || getPool()).query({ text: toPg(sql), values: params, rowMode: 'array' });
  return res.rows.map((r) => r[0]);
}

/** Runs a statement; returns the row count. */
export async function exec(sql, params = [], client = null) {
  const res = await (client || getPool()).query(toPg(sql), params);
  return res.rowCount;
}

/** INSERT ... RETURNING id -> the new id as a number. */
export async function insertId(sql, params = [], client = null) {
  const id = await scalar(sql + ' RETURNING id', params, client);
  return id === null ? 0 : Number(id);
}

/** Runs fn(client) inside a transaction. */
export async function transaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
