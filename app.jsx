// ============================================================
// app.jsx — root layout, auth gate, overlay routing. Mounts to #root.
// (Reconstructed: this file was missing from the handoff zip but
//  is referenced last in Focus.html and ties all panels together.)
// ============================================================

// ---- magic-link sign-in screen (shown when no session) ----
function SignIn() {
  const [email, setEmail] = React.useState("rbonhardt@gmail.com");
  const [busy,  setBusy]  = React.useState(false);
  const [sent,  setSent]  = React.useState(false);
  const [err,   setErr]   = React.useState(null);

  async function send(e) {
    e.preventDefault();
    if (!email || busy) return;
    setBusy(true); setErr(null);
    try {
      const { error } = await window.supaClient.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin + window.location.pathname },
      });
      if (error) throw error;
      setSent(true);
    } catch (e) {
      setErr(e.message || "Couldn't send the link. Try again?");
    } finally { setBusy(false); }
  }

  return (
    <div className="signin">
      <div className="signin-card">
        <span className="wordmark">Focus</span>
        <p className="signin-sub">Sign in to sync across devices.</p>
        {sent ? (
          <p className="signin-msg">
            Check your inbox at <b>{email}</b> for a sign-in link.
            <button className="signin-resend" onClick={() => setSent(false)}>use a different email</button>
          </p>
        ) : (
          <form onSubmit={send}>
            <input className="signin-input" type="email" value={email} placeholder="you@example.com"
              onChange={(e) => setEmail(e.target.value)} autoFocus />
            <button className="signin-go btn-primary" disabled={busy || !email}>
              {busy ? "Sending…" : "Email me a sign-in link"}
            </button>
            {err && <p className="signin-err">{err}</p>}
          </form>
        )}
      </div>
    </div>
  );
}

// ---- main app (rendered only when authed; reads from the FocusProvider) ----
function App({ session }) {
  const { state, dispatch } = window.useFocusStore();
  const [overlay, setOverlay] = React.useState(null); // "close" | "quarter" | "journal" | null

  React.useEffect(() => {
    window.__openQuarterReview = () => setOverlay("quarter");
    return () => { delete window.__openQuarterReview; };
  }, []);

  const prog = window.selProgress(state);
  const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;

  async function signOut() {
    await window.supaClient.auth.signOut();
  }

  return (
    <div className="shell">
      <header className="appbar">
        <div className="appbar-l">
          <span className="wordmark">Focus</span>
          <span className="appbar-divider" />
          <div className="appbar-week">
            <span className="appbar-weeklabel">Week {state.week.n}</span>
            <span className="appbar-weekrange">{window.fmtRange(state.week.startISO)}</span>
          </div>
        </div>
        <div className="appbar-r">
          <div className="appbar-prog" title={`${prog.done} of ${prog.total} active tasks done`}>
            <span className="appbar-prog-track"><span className="appbar-prog-fill" style={{ width: pct + "%" }} /></span>
            <span className="appbar-prog-label">{prog.done}/{prog.total}</span>
          </div>
          <button className="btn-journal" onClick={() => setOverlay("journal")}>Journal</button>
          <button className="btn-close-week" onClick={() => setOverlay("close")}>Close week →</button>
          <button className="btn-journal" title={session?.user?.email || "Sign out"} onClick={signOut}>Sign out</button>
        </div>
      </header>

      <main className="main">
        <div className="top-row">
          <window.BigThree />
          <window.NorthStar />
        </div>

        <window.Composer />

        <div className="projects">
          {state.projects.map(p => <window.ProjectCard key={p.id} project={p} />)}
          <div className="pcard pcard-add">
            <window.AddRow
              className="pcard-add-row"
              placeholder="+ New project"
              onAdd={(name) => dispatch({ type: "ADD_PROJECT", name })} />
          </div>
        </div>

        <footer className="appfoot">
          <span>Focus — weekly + 12-week priorities</span>
          <span>{state.projects.length} project{state.projects.length === 1 ? "" : "s"}</span>
        </footer>
      </main>

      {overlay === "close"   && <window.CloseWeek     onClose={() => setOverlay(null)} />}
      {overlay === "quarter" && <window.QuarterReview onClose={() => setOverlay(null)} />}
      {overlay === "journal" && <window.Journal       onClose={() => setOverlay(null)} />}
    </div>
  );
}

// ---- root: auth gate + provider ----
function Root() {
  const { session, ready } = window.useSupaAuth();
  if (!ready) return <div className="signin"><div className="signin-card"><span className="wordmark">Focus</span></div></div>;
  if (!session) return <SignIn />;
  return (
    <window.FocusProvider userId={session.user.id}>
      <App session={session} />
    </window.FocusProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<Root />);
