import { useEffect, useState } from 'react';
import { api } from '../api';

/** Add / remove the account titles that fill the dropdown on Payment Record and Running Payables. */
export default function AccountTitles() {
  const [saved, setSaved] = useState(null);
  const [list, setList] = useState([]);
  const [text, setText] = useState('');
  const [flash, setFlash] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getPayables()
      .then((r) => { setSaved(r.categories || []); setList(r.categories || []); })
      .catch((e) => { setFlash({ type: 'error', msg: e.message }); setSaved([]); });
  }, []);

  const dirty = saved !== null && JSON.stringify(saved) !== JSON.stringify(list);

  function add(e) {
    e.preventDefault();
    const name = text.trim().replace(/\s+/g, ' ');
    if (!name) return;
    if (list.some((t) => t.toLowerCase() === name.toLowerCase())) { setFlash({ type: 'error', msg: `"${name}" is already on the list.` }); return; }
    setFlash(null); setList([...list, name]); setText('');
  }

  async function save() {
    if (!list.length) { setFlash({ type: 'error', msg: 'Keep at least one account title.' }); return; }
    setBusy(true); setFlash(null);
    try {
      const r = await api.saveAccountTitles(list);
      setSaved(r.data); setList(r.data);
      setFlash({ type: 'success', msg: 'Account titles saved.' });
    } catch (e) { setFlash({ type: 'error', msg: e.message || 'Could not save.' }); }
    setBusy(false);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Account Titles</h1>
          <div className="subtitle">These fill the Account title dropdown on Payment Record and Running Payables. Removing one does not change payables already saved with it.</div>
        </div>
        <button type="button" className="btn" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
      </div>
      {flash && <div className={`flash flash-${flash.type}`}>{flash.msg}</div>}
      <div className="panel" style={{ maxWidth: 560 }}>
        <form className="at-add" onSubmit={add}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="New account title, e.g. Utilities" maxLength={60} />
          <button type="submit" className="btn">Add</button>
        </form>
        <ul className="at-list">
          {list.map((t) => (
            <li key={t}>
              <span>{t}</span>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => setList(list.filter((x) => x !== t))}>Remove</button>
            </li>
          ))}
          {saved !== null && list.length === 0 && <li className="at-empty">No account titles yet.</li>}
        </ul>
        {dirty && <div className="dash-hint">You have unsaved changes.</div>}
      </div>
    </div>
  );
}