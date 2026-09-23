// Login sessions -- replaces backend/includes/auth.php.
//
// PHP kept sessions in files on the server. Vercel functions are stateless,
// so the logged-in user is kept in a signed cookie instead (HMAC-SHA256
// with SESSION_SECRET). It can be read but not forged or edited.

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { one } from './db.js';
import { parseCookies, isHttps } from './http.js';
import { trim } from './php.js';

const COOKIE = 'rv_session';
const MAX_AGE_SECONDS = 12 * 60 * 60; // log out automatically after 12 hours

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error('SESSION_SECRET is not set (use a random string of at least 32 characters).');
  }
  return s;
}

function sign(data) {
  return crypto.createHmac('sha256', secret()).update(data).digest('base64url');
}

/** Reads the current user from the request cookie, or null. */
export function readSession(req) {
  const raw = parseCookies(req)[COOKIE];
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot < 1) return null;
  const data = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = sign(data);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (!payload?.user || !payload.exp || payload.exp < Date.now() / 1000) return null;
    return payload.user;
  } catch {
    return null;
  }
}

function cookieAttrs(req, maxAge) {
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (isHttps(req)) attrs.push('Secure');
  if (maxAge !== undefined) attrs.push(`Max-Age=${maxAge}`);
  return attrs.join('; ');
}

export function sessionCookie(req, user) {
  const payload = { user, exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  // No Max-Age: like PHP's session cookie it also ends when the browser closes.
  return `${COOKIE}=${data}.${sign(data)}; ${cookieAttrs(req)}`;
}

export function clearCookie(req) {
  return `${COOKIE}=; ${cookieAttrs(req, 0)}`;
}

/** Checks username/password; returns the session user or null. */
export async function attemptLogin(username, password) {
  const user = await one('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', [trim(username)]);
  if (!user) return null;
  // PHP's password_hash() writes "$2y$" bcrypt hashes; bcryptjs reads them as "$2a$".
  const hash = String(user.password_hash || '').replace(/^\$2y\$/, '$2a$');
  let ok = false;
  try {
    ok = await bcrypt.compare(String(password), hash);
  } catch {
    ok = false;
  }
  if (!ok) return null;
  return { id: user.id, username: user.username, full_name: user.full_name, role: user.role };
}

/** Per-request auth context (what PHP read from $_SESSION). */
export function makeAuth(user) {
  return {
    user,
    isAdmin: () => !!user && user.role === 'admin',
    // Admins see every branch; a branch account only its own (username).
    branch: () => (!user ? null : user.role === 'admin' ? null : user.username),
  };
}
