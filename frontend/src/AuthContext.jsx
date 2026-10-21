import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api';

const AuthContext = createContext(null);

// Session security: sign out after IDLE_MS without activity (shared across browser tabs),
// with a warning for the last WARN_MS. The server enforces the same limit on its own.
const IDLE_MS = 30 * 60 * 1000;
const WARN_MS = 60 * 1000;
const PING_MS = 5 * 60 * 1000; // while active, tell the server every 5 minutes so its idle clock keeps up
const KEY = 'rv_last_active';

const readLast = () => { try { return Number(localStorage.getItem(KEY)) || Date.now(); } catch { return Date.now(); } };
const writeLast = (t) => { try { localStorage.setItem(KEY, String(t)); } catch { /* ignore */ } };

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = loading, null = logged out
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(''); // e.g. "You were signed out because of inactivity."
  const [warnLeft, setWarnLeft] = useState(null); // seconds left while the warning is showing
  const lastPing = useRef(Date.now());
  const warning = useRef(false);

  useEffect(() => {
    api.me().then((r) => { setUser(r.user); if (r.user) writeLast(Date.now()); }).catch(() => setUser(null));
  }, []);

  const endSession = useCallback((message) => {
    warning.current = false;
    setWarnLeft(null);
    setUser(null);
    setNotice(message);
  }, []);

  // server says "not logged in" while someone was using the app
  useEffect(() => {
    const onExpired = () => endSession('Your session has ended. Please sign in again.');
    window.addEventListener('rv:session-expired', onExpired);
    return () => window.removeEventListener('rv:session-expired', onExpired);
  }, [endSession]);

  // idle timer, only while logged in
  useEffect(() => {
    if (!user) return undefined;
    writeLast(Date.now());
    lastPing.current = Date.now();
    let lastWrite = 0;
    const onActivity = () => {
      if (warning.current) return; // once the warning shows, only the button keeps you signed in
      const now = Date.now();
      if (now - lastWrite < 2000) return;
      lastWrite = now;
      writeLast(now);
      if (now - lastPing.current > PING_MS) { lastPing.current = now; api.me().catch(() => {}); }
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    const tick = setInterval(async () => {
      const idle = Date.now() - readLast();
      if (idle >= IDLE_MS) {
        await api.logout().catch(() => {});
        endSession('You were signed out because of inactivity.');
      } else if (idle >= IDLE_MS - WARN_MS) {
        warning.current = true;
        setWarnLeft(Math.max(1, Math.ceil((IDLE_MS - idle) / 1000)));
      } else if (warning.current) { // another tab kept the session alive
        warning.current = false;
        setWarnLeft(null);
      }
    }, 1000);
    return () => { events.forEach((e) => window.removeEventListener(e, onActivity)); clearInterval(tick); };
  }, [user, endSession]);

  async function staySignedIn() {
    warning.current = false;
    setWarnLeft(null);
    writeLast(Date.now());
    lastPing.current = Date.now();
    api.me().catch(() => {});
  }

  async function login(username, password) {
    setError('');
    try {
      const r = await api.login(username, password);
      setNotice('');
      writeLast(Date.now());
      setUser(r.user);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  }

  async function logout() {
    await api.logout().catch(() => {});
    setNotice('');
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, error, setError, notice }}>
      {children}
      {user && warnLeft !== null && (
        <div className="pm-backdrop idle-backdrop" role="alertdialog" aria-modal="true" aria-label="Session about to end">
          <div className="pm-card idle-card">
            <div className="idle-icon" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            </div>
            <h3>Still there?</h3>
            <p>You will be signed out in <strong>{warnLeft}</strong> second{warnLeft === 1 ? '' : 's'} because of inactivity.</p>
            <div className="idle-actions">
              <button type="button" className="btn btn-secondary" onClick={logout}>Sign out</button>
              <button type="button" className="btn" autoFocus onClick={staySignedIn}>Stay signed in</button>
            </div>
          </div>
        </div>
      )}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}