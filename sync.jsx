// ============================================================
// sync.jsx — Supabase auth + JSON-blob sync for the focus store.
//
// Design notes (cf. handoff README → "Primary task: cross-device sync"):
// - One row per user in `app_state`, column `data` is the full reducer state.
// - localStorage stays as instant-paint cache + offline buffer; the server is
//   the source of truth once authed.
// - Save policy: last-write-wins on `updated_at`. Acceptable for a single user
//   across devices; documented caveat is simultaneous edits on two devices.
// - Reads happen on auth-ready + tab-focus (no realtime channel in v1).
// - Exposes: window.useSupaAuth(), window.supaPull(), window.supaPush(),
//            window.supaClient.
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

// ---- pull / push ----
async function supaPull(userId) {
  const { data, error } = await supaClient
    .from("app_state")
    .select("data, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data || null; // { data, updated_at } | null
}
window.supaPull = supaPull;

async function supaPush(userId, payload) {
  const { error } = await supaClient
    .from("app_state")
    .upsert({ user_id: userId, data: payload }, { onConflict: "user_id" });
  if (error) throw error;
}
window.supaPush = supaPush;
