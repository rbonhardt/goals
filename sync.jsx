// ============================================================
// sync.jsx — Supabase auth + JSON-blob sync for the focus store.
//
// Design notes (cf. handoff README → "Primary task: cross-device sync"):
// - One row per user in `app_state`, column `data` is the full reducer state.
// - localStorage stays as instant-paint cache + offline buffer; the server is
//   the source of truth once authed.
// - Save policy: a save names the row revision (`rev`) its copy is built on
//   and only lands if the row is still there; otherwise the server hands
//   back the newer copy, and store.jsx puts this device's unsaved actions on
//   top of it and saves again. Two devices can't overwrite each other.
//   (supabase/migrations/20261008120000_app_state_rev.sql)
// - Reads happen on auth-ready + tab-focus (no realtime channel in v1).
// - Exposes: window.useSupaAuth(), window.supaApi(userId), window.supaClient.
// ============================================================
const { createClient } = window.supabase;
const supaClient = createClient(window.SUPABASE_URL, window.SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
window.supaClient = supaClient;

// ---- session hook ----
function useSupaAuth() {
  const [session, setSession] = React.useState(null);
  const [ready, setReady]     = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    supaClient.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session || null);
      setReady(true);
    });
    const { data: sub } = supaClient.auth.onAuthStateChange((_evt, sess) => {
      if (!alive) return;
      setSession(sess || null);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  return { session, ready };
}
window.useSupaAuth = useSupaAuth;

// ---- pull / save ----
async function supaPull(userId) {
  const { data, error } = await supaClient
    .from("app_state")
    .select("data, rev")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data || null; // { data, rev } | null
}

// Save `payload` only if the row is still at `rev`. Resolves to
// { ok: true, rev } (the row's new rev), or — another save got there
// first — { ok: false, rev, data }: the row as it is now (data null if
// there is no row).
async function supaSave(rev, payload) {
  const { data, error } = await supaClient.rpc("app_state_save", { p_rev: rev, p_data: payload });
  if (error) throw error;
  if (!data || typeof data.ok !== "boolean") throw new Error("app_state_save: unexpected reply");
  return data;
}

// What the store's sync engine talks to (see createSync in store.jsx).
window.supaApi = (userId) => ({ pull: () => supaPull(userId), save: supaSave });
