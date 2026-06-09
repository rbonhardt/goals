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

  async function google() {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const { error } = await window.supaClient.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin + window.location.pathname },
      });
      if (error) throw error;
      // OAuth flow takes over the page — no further UI handling needed
    } catch (e) {
      setErr(e.message || "Couldn't start Google sign-in.");
      setBusy(false);
    }
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
          <>
            <button className="signin-google" onClick={google} disabled={busy}>
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
                <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/>
                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z"/>
              </svg>
              Continue with Google
            </button>
            <div className="signin-divider"><span>or</span></div>
            <form onSubmit={send}>
              <input className="signin-input" type="email" value={email} placeholder="you@example.com"
                onChange={(e) => setEmail(e.target.value)} />
              <button className="signin-go btn-primary" disabled={busy || !email}>
                {busy ? "Sending…" : "Email me a sign-in link"}
              </button>
              {err && <p className="signin-err">{err}</p>}
            </form>
          </>
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
