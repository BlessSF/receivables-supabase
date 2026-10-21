import { useState } from 'react';
import { useAuth } from '../AuthContext';

const I = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };


function LogoMark() {
  return (
    <div className="login-mark" aria-hidden="true">
      <svg viewBox="0 0 64 64" width="64" height="64">
        <defs>
          <linearGradient id="lm-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2fd0b8" /><stop offset="1" stopColor="#0b5b52" /></linearGradient>
          <linearGradient id="lm-s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity="0.28" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
        </defs>
        <rect width="64" height="64" rx="18" fill="url(#lm-g)" />
        <rect width="64" height="34" rx="18" fill="url(#lm-s)" />
        <circle cx="32" cy="32" r="19" fill="none" stroke="#fff" strokeOpacity="0.28" strokeWidth="1.5" />
        <g fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M26 44V20h7.5a7 7 0 0 1 0 14H26" />
          <path d="M21.5 26h16M21.5 31h16" strokeWidth="2.6" />
        </g>
        <path d="M47 13l1.3 3.2L51.5 17.5l-3.2 1.3L47 22l-1.3-3.2L42.5 17.5l3.2-1.3z" fill="#fff" fillOpacity="0.9" />
      </svg>
    </div>
  );
}

// Decorative picture for the left side (no text): a floating mini dashboard.
function LoginArt() {
  const bars = [46, 70, 54, 92, 78, 118, 100, 140];
  return (
    <aside className="login-art" aria-hidden="true">
      <svg viewBox="0 0 560 560" className="art-svg" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="a-bar" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#0f8f80" /><stop offset="1" stopColor="#55d1bd" /></linearGradient>
          <linearGradient id="a-card" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity="0.16" /><stop offset="1" stopColor="#fff" stopOpacity="0.05" /></linearGradient>
          <linearGradient id="a-line" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#e2a03a" /><stop offset="1" stopColor="#ffd98a" /></linearGradient>
          <radialGradient id="a-glow" cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#2fd0b8" stopOpacity="0.35" /><stop offset="1" stopColor="#2fd0b8" stopOpacity="0" /></radialGradient>
        </defs>
        <circle cx="280" cy="280" r="250" fill="url(#a-glow)" />
        <circle cx="280" cy="280" r="205" fill="none" stroke="#fff" strokeOpacity="0.07" strokeDasharray="2 9" />
        <circle cx="280" cy="280" r="150" fill="none" stroke="#fff" strokeOpacity="0.06" />

        {/* main chart card */}
        <g className="art-float-a">
          <rect x="90" y="150" width="330" height="240" rx="24" fill="url(#a-card)" stroke="#fff" strokeOpacity="0.22" />
          <rect x="116" y="176" width="86" height="10" rx="5" fill="#fff" fillOpacity="0.5" />
          <rect x="116" y="194" width="54" height="8" rx="4" fill="#fff" fillOpacity="0.22" />
          {bars.map((h, i) => (
            <rect key={i} x={118 + i * 34} y={366 - h} width="20" height={h} rx="6" fill="url(#a-bar)" opacity={0.55 + i * 0.06} />
          ))}
          <path d="M128 330 C 170 320, 190 300, 226 306 S 292 270, 330 262 S 380 222, 398 214" fill="none" stroke="url(#a-line)" strokeWidth="4" strokeLinecap="round" />
          <circle cx="398" cy="214" r="7" fill="#ffd98a" stroke="#0b1424" strokeWidth="3" />
        </g>

        {/* donut card */}
        <g className="art-float-b">
          <rect x="344" y="304" width="156" height="156" rx="24" fill="#0f1c33" fillOpacity="0.85" stroke="#fff" strokeOpacity="0.2" />
          <circle cx="422" cy="382" r="42" fill="none" stroke="#fff" strokeOpacity="0.14" strokeWidth="14" />
          <circle cx="422" cy="382" r="42" fill="none" stroke="#55d1bd" strokeWidth="14" strokeLinecap="round" strokeDasharray="170 264" transform="rotate(-90 422 382)" />
          <circle cx="422" cy="382" r="42" fill="none" stroke="#e2a03a" strokeWidth="14" strokeLinecap="round" strokeDasharray="30 264" strokeDashoffset="-190" transform="rotate(-90 422 382)" />
        </g>

        {/* paid badge */}
        <g className="art-float-c">
          <rect x="62" y="82" width="170" height="58" rx="29" fill="#0f1c33" fillOpacity="0.9" stroke="#fff" strokeOpacity="0.2" />
          <circle cx="94" cy="111" r="16" fill="#17b3a0" />
          <path d="M86 111l6 6 11-12" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="120" y="102" width="82" height="9" rx="4.5" fill="#fff" fillOpacity="0.55" />
          <rect x="120" y="118" width="52" height="7" rx="3.5" fill="#fff" fillOpacity="0.25" />
        </g>

        {/* coins */}
        <g className="art-float-b">
          <circle cx="470" cy="150" r="30" fill="#e2a03a" />
          <circle cx="470" cy="150" r="23" fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="2" />
          <g fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><path d="M465 163V138h7a6 6 0 0 1 0 12h-7" /><path d="M460 144h14M460 149h14" strokeWidth="2.2" /></g>
        </g>
        <g className="art-float-a">
          <circle cx="82" cy="440" r="20" fill="#3b82d6" fillOpacity="0.9" />
          <circle cx="82" cy="440" r="14" fill="none" stroke="#fff" strokeOpacity="0.5" strokeWidth="2" />
        </g>
        <circle cx="520" cy="262" r="5" fill="#55d1bd" />
        <circle cx="52" cy="300" r="4" fill="#fff" fillOpacity="0.5" />
        <circle cx="300" cy="86" r="3.5" fill="#ffd98a" />
      </svg>
    </aside>
  );
}

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
      <LoginArt />
      <main className="login-main">
        <form className="login-card" onSubmit={onSubmit}>
          <LogoMark />
          <h1>Welcome</h1>
          <p className="login-sub">Receivables System</p>

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