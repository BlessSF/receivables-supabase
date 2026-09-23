import { useState } from 'react';
import { useAuth } from '../AuthContext';

export default function Login() {
  const { login, error } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    await login(username, password);
    setBusy(false);
  }

  return (
    <div className="login-page">
      <aside className="login-aside">
        <div className="login-brand">
          <span className="brand-mark">M</span>
          Multipliers
        </div>
        <div className="login-pitch">
          <h2>Every peso billed, followed until it's collected.</h2>
          <p>Statements, aging and collections for every company and branch, in one ledger.</p>
        </div>
        <div className="login-aside-foot">Receivables Management</div>
      </aside>

      <main className="login-main">
        <form className="login-card" onSubmit={onSubmit}>
          <h1>Sign in</h1>
          <div className="subtitle">Use your Multipliers account to continue.</div>

          {error && <div className="login-error" role="alert">{error}</div>}

          <div className="form-group">
            <label htmlFor="username">Username</label>
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

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <div className="field-password">
              <input
                id="password"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="reveal-btn"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? 'Hide password' : 'Show password'}
                aria-pressed={show}
              >
                {show ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <button className="btn" type="submit" disabled={busy || !username || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="login-help">Trouble signing in? Contact your administrator.</p>
        </form>
      </main>
    </div>
  );
}