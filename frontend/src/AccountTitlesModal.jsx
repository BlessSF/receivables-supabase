import { useState } from 'react';
import { api } from './api';

/** Add / remove the account titles that fill the dropdown on Payment Record and Running Payables. */
export default function AccountTitlesModal({ titles, onClose, onSaved }) {
  const [list, setList] = useState(titles);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  function add(e) {
    e.preventDefault();
    const name = text.trim().replace(/\s+/g, ' ');
    if (!name) return;
    if (list.some((t) => t.toLowerCase() === name.toLowerCase())) { setErr(`"${name}" is already on the list.`); return; }
    setErr(''); setList([...list, name]); setText('');
  }

  async function save() {
    if (!list.length) { setErr('Keep at least one account title.'); return; }
    setBusy(true); setErr('');
    try { const r = await api.saveAccountTitles(list); onSaved(r.data); }
    catch (e2) { setErr(e2.message || 'Could not save.'); setBusy(false); }
  }

  return (
    <div className="pm-backdrop" onMouseDown={(ev) => { if (ev.target === ev.currentTarget && !busy) onClose(); }}>
      <div className="pm-card settle-card pay-modal">
        <h3>Account titles</h3>
        <p className="at-help">These fill the Account title dropdown. Removing one does not change payables already saved with it.</p>
        <form className="at-add" onSubmit={add}>
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="New account title, e.g. Utilities" maxLength={60} />
          <button type="submit" className="btn">Add</button>
        </form>
        <ul className="at-list">
          {list.map((t) => (
            <li key={t}>
              <span>{t}</span>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => setList(list.filter((x) => x !== t))}>Remove</button>
            </li>
          ))}
          {list.length === 0 && <li className="at-empty">No account titles yet.</li>}
        </ul>
        {err && <div className="flash flash-error" style={{ margin: 0 }}>{err}</div>}
        <div className="settle-actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className="btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}