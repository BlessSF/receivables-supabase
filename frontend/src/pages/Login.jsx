import { useState } from 'react';
import { useAuth } from '../AuthContext';

const I = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };

export default function Login() {
  const { login, error, notice } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [caps, setCaps] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    await login(username, password);
    setBusy(false);
  }

  const checkCaps = (e) => setCaps(!!e.getModifierState && e.getModifierState('CapsLock'));

  return (
    <div className="login-page">
      <div className="login-glow" aria-hidden="true" />
      <main className="login-main">
        <form className="login-card" onSubmit={onSubmit}>
          <div className="login-mark" aria-hidden="true">
            <svg {...I} width="28" height="28"><rect x="4" y="3" width="16" height="18" rx="2.5" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>
          </div>
          <h1>Sign in</h1>

          {notice && !error && <div className="login-notice" role="status">{notice}</div>}
          {error && <div className="login-error" role="alert">{error}</div>}

          <div className="login-field">
            <label htmlFor="username">Username</label>
            <div className="login-input">
              <svg {...I}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></svg>
              <input
                id="username"
                autoFocus
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
          </div>

          <div className="login-field">
            <label htmlFor="password">Password</label>
            <div className="login-input">
              <svg {...I}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
              <input
                id="password"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyUp={checkCaps}
                onKeyDown={checkCaps}
                onBlur={() => setCaps(false)}
              />
              <button
                type="button"
                className="login-eye"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? 'Hide password' : 'Show password'}
                aria-pressed={show}
              >
                {show
                  ? <svg {...I}><path d="M3 3l18 18" /><path d="M10.6 6.2A9.8 9.8 0 0 1 12 6c5 0 8.5 4 9.5 6a13 13 0 0 1-2.6 3.3M6.6 6.7C4.4 8.1 2.9 10.2 2.5 12c1 2 4.5 6 9.5 6 1.5 0 2.8-.3 4-.9" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>
                  : <svg {...I}><path d="M2.5 12C3.5 10 7 6 12 6s8.5 4 9.5 6c-1 2-4.5 6-9.5 6S3.5 14 2.5 12Z" /><circle cx="12" cy="12" r="3" /></svg>}
              </button>
            </div>
            {caps && <div className="login-caps">Caps Lock is on</div>}
          </div>

          <button className="login-submit" type="submit" disabled={busy || !username || !password}>
            {busy ? <span className="login-spin" aria-hidden="true" /> : null}
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </main>
    </div>
  );
}