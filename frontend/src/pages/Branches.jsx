import { useEffect, useState } from 'react';
import { api } from '../api';

// Other branches (e.g. Demic Jaro) are separate copies of this app with their own database.
// This page just keeps their names + links so Admin / Executive can open them quickly.
export default function Branches() {
  const [sites, setSites] = useState(null);
  const [edit, setEdit] = useState(null); // { index, name, url, note } index -1 = new
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getBranchSites().then((r) => setSites(r.data || [])).catch((e) => { setErr(e.message || 'Could not load branches.'); setSites([]); });
  }, []);

  async function persist(next) {
    setBusy(true); setErr('');
    try {
      const r = await api.saveBranchSites(next);
      setSites(r.data || next);
      setEdit(null);
    } catch (e) { setErr(e.message || 'Could not save.'); }
    setBusy(false);
  }

  function submit(e) {
    e.preventDefault();
    const item = { name: edit.name.trim(), url: edit.url.trim(), note: edit.note.trim() };
    if (!item.name) { setErr('Enter the branch name.'); return; }
    const next = [...sites];
    if (edit.index < 0) next.push(item); else next[edit.index] = item;
    persist(next);
  }

  function remove(i) {
    if (!confirm(`Remove "${sites[i].name}" from this list?\n\nThis only removes the shortcut. The branch's own data is not touched.`)) return;
    persist(sites.filter((_, k) => k !== i));
  }

  const here = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Branches</h1>
          <div className="subtitle">Each branch runs as its own separate copy with its own data and logins. Nothing is shared between them.</div>
        </div>
        <button type="button" className="btn" onClick={() => { setErr(''); setEdit({ index: -1, name: '', url: '', note: '' }); }}>+ Add branch</button>
      </div>

      {err && <div className="flash flash-error">{err}</div>}

      <div className="panel">
        <div className="branch-grid">
          <div className="branch-card is-here">
            <div className="branch-name">This site</div>
            <div className="branch-url">{here.replace(/^https?:\/\//, '')}</div>
            <span className="badge badge-success">You are here</span>
          </div>
          {sites === null && <div className="empty-state">Loading…</div>}
          {(sites || []).map((s, i) => (
            <div className="branch-card" key={i}>
              <div className="branch-name">{s.name}</div>
              <div className="branch-url">{s.url ? s.url.replace(/^https?:\/\//, '') : 'No link yet'}</div>
              {s.note && <div className="branch-note">{s.note}</div>}
              <div className="branch-actions">
                {s.url
                  ? <a className="btn btn-sm" href={s.url} target="_blank" rel="noopener noreferrer">Open</a>
                  : <span className="badge badge-secondary">Add a link to open it</span>}
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setErr(''); setEdit({ index: i, ...s }); }}>Edit</button>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(i)}>Remove</button>
              </div>
            </div>
          ))}
        </div>
        {sites && sites.length === 0 && <p className="branch-empty">No other branches yet. Set one up, then click “+ Add branch” and paste its link.</p>}
      </div>

      {edit && (
        <div className="pm-backdrop" onMouseDown={(ev) => { if (ev.target === ev.currentTarget && !busy) setEdit(null); }}>
          <form className="pm-card settle-card" onSubmit={submit}>
            <h3>{edit.index < 0 ? 'Add branch' : 'Edit branch'}</h3>
            <div className="form-group"><label>Branch name</label><input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Demic Jaro" /></div>
            <div className="form-group"><label>Link of its site</label><input value={edit.url} onChange={(e) => setEdit({ ...edit, url: e.target.value })} placeholder="demic-jaro.vercel.app" /></div>
            <div className="form-group"><label>Note (optional)</label><input value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} placeholder="Jaro, Iloilo" /></div>
            {err && <div className="flash flash-error">{err}</div>}
            <div className="settle-actions">
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setEdit(null)}>Cancel</button>
              <button type="submit" className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}