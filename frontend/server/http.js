// Request/response helpers shared by the API and export endpoints.

export class HttpError extends Error {
  constructor(status, body) {
    super(typeof body === 'string' ? body : body?.error || 'Error');
    this.status = status;
    this.body = body;
  }
}

/** Stop and reply with JSON (like PHP's json_response(...) + exit). */
export function jsonExit(body, status = 200) {
  throw new HttpError(status, body);
}

export function getQuery(req) {
  const url = new URL(req.url, 'http://localhost');
  const q = {};
  for (const [k, v] of url.searchParams) q[k] = v;
  return q;
}

/** Reads and JSON-decodes the request body (works on Vercel and plain Node). */
export async function getJsonBody(req) {
  if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH') return {};
  let raw;
  if (req.body !== undefined) {
    // Vercel already read the stream for us.
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
    raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body ?? '');
  } else {
    raw = await new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }
  if (!raw) return {};
  try {
    const decoded = JSON.parse(raw);
    return decoded && typeof decoded === 'object' && !Array.isArray(decoded) ? decoded : {};
  } catch {
    return {};
  }
}

export function sendJson(res, status, body, extraHeaders = {}) {
  const data = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.end(data);
}

export function sendText(res, status, text) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain');
  res.end(text);
}

export function sendFile(res, bytes, contentType, filename) {
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', bytes.length);
  res.setHeader('Cache-Control', 'no-store');
  res.end(bytes);
}

export function parseCookies(req) {
  const out = {};
  const header = req.headers?.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[k] = part.slice(i + 1).trim();
    }
  }
  return out;
}

export function isHttps(req) {
  const proto = String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  return proto === 'https' || !!req.socket?.encrypted;
}
