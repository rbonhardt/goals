// ============================================================
// hublink.jsx — links Focus with the MOTION Employee Hub.
//
// Every open Hub task assigned to Ryan shows up in the Motion project
// (HUB_SYNC in store.jsx files it). Checking a linked task off here checks it
// off in the Hub, and the other way round.
//
// There is no timer. A sync runs:
//   • right after each pull of the Focus state (page load, tab refocus), and
//   • 1.5 s after a linked task's done state changes here.
// One sync = one call to the hub-link Edge Function (signed in as Ryan). It
// sends the check-offs made here, and gets back the Hub's current list.
// The function talks to the Hub with a shared secret, so no Hub key lives
// in this page (see supabase/functions/hub-link).
// ============================================================

// The check-offs (and un-checks) still to send: linked tasks whose done
// state differs from what the Hub said last time, plus the outbox — changes
// on tasks that left the list before they were sent (close week, delete).
function hubPendingChanges(state) {
  const out = [], seen = new Set();
  state.projects.forEach(p => p.tasks.forEach(t => {
    if (!t.hub) return;
    seen.add(t.hub.id);
    if ((t.status === "done") !== t.hub.done) out.push({ id: t.hub.id, done: t.status === "done" });
  }));
  (state.hubOutbox || []).forEach(c => { if (!seen.has(c.id)) out.push({ id: c.id, done: c.done }); });
  return out;
}

function hubKnownIds(state) {
  const out = [];
  state.projects.forEach(p => p.tasks.forEach(t => { if (t.hub) out.push(t.hub.id); }));
  return out;
}

function useHubLink() {
  const { state, dispatch, pulls } = window.useFocusStore();
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const busy = React.useRef(false);
  const again = React.useRef(false);

  const sync = React.useCallback(async () => {
    // one at a time; a request made meanwhile runs once the current one ends
    if (busy.current) { again.current = true; return; }
    busy.current = true;
    try {
      const s = stateRef.current;
      const changes = hubPendingChanges(s);
      const asked = Date.now();
      window.setHubInflight(changes);
      const { data, error } = await window.supaClient.functions.invoke("hub-link", {
        body: { changes, known: hubKnownIds(s) },
      });
      if (error) throw error;
      if (data && Array.isArray(data.tasks)) {
        // `sent` tells the merge exactly what the Hub was asked to do, so a
        // check made while this was in flight isn't mistaken for the Hub's.
        // `at` = when the Hub answered, by the server's clock (the request's
        // start if the function is older): how HUB_SYNC tells old news from new
        dispatch({ type: "HUB_SYNC", tasks: data.tasks, gone: Array.isArray(data.gone) ? data.gone : [], sent: changes,
          at: typeof data.at === "number" ? data.at : asked });
      }
    } catch (e) {
      // Offline or the link is down: the changes stay pending and go next time.
      console.warn("[hub-link] sync failed:", (e && e.message) || e);
    } finally {
      window.setHubInflight([]);
      busy.current = false;
      if (again.current) { again.current = false; sync(); }
    }
  }, [dispatch]);

  // after every pull of the Focus state
  React.useEffect(() => { if (pulls > 0) sync(); }, [pulls, sync]);

  // shortly after a linked task is checked or un-checked here
  const pendingKey = hubPendingChanges(state).map(c => c.id + (c.done ? "+" : "-")).join(",");
  React.useEffect(() => {
    if (!pendingKey || pulls === 0) return;
    const t = setTimeout(sync, 1500);
    return () => clearTimeout(t);
  }, [pendingKey, pulls, sync]);
}

Object.assign(window, { useHubLink });
