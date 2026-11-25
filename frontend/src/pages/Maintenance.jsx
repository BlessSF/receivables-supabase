// What everyone except admins sees while Settings -> Maintenance is ON.
export default function Maintenance({ info, signedIn, onAdmin, onLogout, onRecheck }) {
  const title = info?.title || 'We’re doing some maintenance';
  const message = info?.message || 'The system is being updated. Your data is safe. Please check back soon.';
  return (
    <main className="mt-page">
      <div className="mt-sheet">
        <div className="mt-kicker">{info?.brand || 'DLM'} · Receivables</div>
        <h1>{title}</h1>
        <div className="mt-rule" aria-hidden="true" />
        <p className="mt-msg">{message}</p>
        {info?.back && (
          <dl className="mt-back-row">
            <dt>Expected back</dt>
            <dd>{info.back}</dd>
          </dl>
        )}
        <div className="mt-actions">
          <button type="button" className="btn" onClick={onRecheck}>Check again</button>
          {signedIn
            ? <button type="button" className="btn btn-secondary" onClick={onLogout}>Sign out</button>
            : <button type="button" className="mt-admin" onClick={onAdmin}>Admin sign in</button>}
        </div>
        <div className="mt-foot">This page checks by itself every 30 seconds and opens the system as soon as maintenance is over.</div>
      </div>
    </main>
  );
}