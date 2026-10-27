import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

const squash = (v) => v.trim().replace(/\s+/g, ' ');

/** Account titles (e.g. Supplier, Salary) and, under each, the names that can be picked on Payment Record. */
export default function AccountTitles() {
  const [saved, setSaved] = useState(null); // { titles, names } as last saved
  const [titles, setTitles] = useState([]);
  const [names, setNames] = useState({});   // { title: [name, ...] }
  const [sel, setSel] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newName, setNewName] = useState('');
  const [find, setFind] = useState('');
  const [flash, setFlash] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getPayables()
      .then((r) => {
        const t = r.categories || [], n = r.title_names || {};
        setSaved({ titles: t, names: n }); setTitles(t); setNames(n); setSel(t[0] || '');
      })
      .catch((e) => { setFlash({ type: 'error', msg: e.message }); setSaved({ titles: [], names: {} }); });
  }, []);

  const dirty = saved !== null && JSON.stringify([saved.titles, saved.names]) !== JSON.stringify([titles, names]);
  const list = names[sel] || [];
  const shown = useMemo(() => list.filter((n) => n.toLowerCase().includes(find.trim().toLowerCase())), [list, find]);

  function addTitle(e) {
    e.preventDefault();
    const t = squash(newTitle);
    if (!t) return;
    if (titles.some((x) => x.toLowerCase() === t.toLowerCase())) { setFlash({ type: 'error', msg: `"${t}" is already on the list.` }); return; }
    setFlash(null); setTitles([...titles, t]); setSel(t); setNewTitle('');
  }
  function removeTitle(t) {
    const n = (names[t] || []).length;
    if (!confirm(n ? `Remove "${t}" and its ${n} saved name${n === 1 ? '' : 's'}? Payables already saved are not changed.` : `Remove "${t}"? Payables already saved are not changed.`)) return;
    const rest = titles.filter((x) => x !== t);
    const { [t]: _gone, ...keep } = names; // eslint-disable-line no-unused-vars
    setTitles(rest); setNames(keep); if (sel === t) setSel(rest[0] || '');
  }
  function addName(e) {
    e.preventDefault();
    const n = squash(newName);
    if (!n || !sel) return;
    if (list.some((x) => x.toLowerCase() === n.toLowerCase())) { setFlash({ type: 'error', msg: `"${n}" is already under ${sel}.` }); return; }
    setFlash(null); setNames({ ...names, [sel]: [...list, n].sort((a, b) => a.localeCompare(b)) }); setNewName('');
  }
  function removeName(n) { setNames({ ...names, [sel]: list.filter((x) => x !== n) }); }

  async function save() {
    if (!titles.length) { setFlash({ type: 'error', msg: 'Keep at least one account title.' }); return; }
    setBusy(true); setFlash(null);
    try {
      const r = await api.saveAccountTitles(titles, names);
      setSaved({ titles: r.data, names: r.names || {} }); setTitles(r.data); setNames(r.names || {});
      if (!r.data.includes(sel)) setSel(r.data[0] || '');
      setFlash({ type: 'success', msg: 'Saved. The names now show up on Payment Record and Running Payables.' });
    } catch (e) { setFlash({ type: 'error', msg: e.message || 'Could not save.' }); }
    setBusy(false);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Account Titles</h1>
          <div className="subtitle">Group your payables by account title. Under a title you can save names (for example the suppliers under Supplier) so they can be picked on Payment Record.</div>
        </div>
        <button type="button" className="btn" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}</button>
      </div>
      {flash && <div className={`flash flash-${flash.type}`}>{flash.msg}</div>}
      {dirty && !flash && <div className="flash flash-warning">You have unsaved changes. Press Save changes to keep them.</div>}

      <div className="at-page">
        <section className="panel at-col">
          <h2>Account titles <span className="at-count">{titles.length}</span></h2>
          <form className="at-add" onSubmit={addTitle}>
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="New account title, e.g. Utilities" maxLength={60} />
            <button type="submit" className="btn">Add</button>
          </form>
          <ul className="at-titles">
            {titles.map((t) => (
              <li key={t} className={t === sel ? 'active' : ''}>
                <button type="button" className="at-title-btn" onClick={() => { setSel(t); setFind(''); setNewName(''); }}>
                  <span className="at-title-name">{t}</span>
                  <span className="at-title-n">{(names[t] || []).length ? `${names[t].length} name${names[t].length === 1 ? '' : 's'}` : 'no names'}</span>
                </button>
                <button type="button" className="at-x" onClick={() => removeTitle(t)} aria-label={`Remove ${t}`} title="Remove this title">×</button>
              </li>
            ))}
            {saved !== null && titles.length === 0 && <li className="at-empty">No account titles yet.</li>}
          </ul>
        </section>

        <section className="panel at-col">
          {sel ? (
            <>
              <h2>Names under “{sel}” <span className="at-count">{list.length}</span></h2>
              <p className="at-help">When {sel} is chosen on Payment Record, these appear as suggestions in the Payee box. Anything else can still be typed.</p>
              <form className="at-add" onSubmit={addName}>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={`Add a ${sel.toLowerCase()} name`} maxLength={120} />
                <button type="submit" className="btn">Add name</button>
              </form>
              {list.length > 8 && <input className="at-find" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search names…" />}
              <ul className="at-list at-names">
                {shown.map((n) => (
                  <li key={n}><span>{n}</span><button type="button" className="btn btn-danger btn-sm" onClick={() => removeName(n)}>Remove</button></li>
                ))}
                {list.length === 0 && <li className="at-empty">No names yet. Add the first one above.</li>}
                {list.length > 0 && shown.length === 0 && <li className="at-empty">No match.</li>}
              </ul>
            </>
          ) : (
            <div className="empty-state">Add an account title on the left to get started.</div>
          )}
        </section>
      </div>
    </div>
  );
}