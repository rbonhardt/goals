// ============================================================
// inbox.jsx — Meeting Inbox strip. Holding area for to-dos that
// the nightly Granola task drops into the `meeting_inbox` table
// (see supabase/functions/meeting-inbox). Rows live outside the
// app_state blob on purpose: the pipeline writes the table, the
// app only ever flips row status, so neither can clobber the
// other's data. Select items → send to a project ("This Week"
// = active lane, "Queue" = queue lane) or dismiss with ✕.
// ============================================================

function inboxFmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function MeetingInbox() {
  const { state, dispatch } = window.useFocusStore();
  const [items, setItems] = React.useState([]);
  const [sel, setSel] = React.useState(() => new Set());
  const [lane, setLane] = React.useState("queue"); // "active" | "queue"
  const [err, setErr] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(async () => {
    const { data, error } = await window.supaClient
      .from("meeting_inbox")
      .select("id, meeting_id, meeting_title, meeting_date, text, note, owner")
      .eq("status", "pending")
      .order("meeting_date", { ascending: false })
      .order("created_at", { ascending: true });
    if (error) { setErr(error.message); return; }
    setErr(null);
    setItems(data || []);
    setSel((s) => new Set([...s].filter((id) => (data || []).some((r) => r.id === id))));
  }, []);

  React.useEffect(() => {
    refresh();
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  // group rows by meeting, newest meeting first (rows arrive pre-sorted)
  const groups = [];
  items.forEach((it) => {
    const g = groups.find((g) => g.meeting_id === it.meeting_id);
    if (g) g.rows.push(it);
    else groups.push({ meeting_id: it.meeting_id, title: it.meeting_title, date: it.meeting_date, rows: [it] });
  });

  const toggle = (id) => setSel((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const toggleGroup = (g) => setSel((s) => {
    const n = new Set(s);
    const all = g.rows.every((r) => n.has(r.id));
    g.rows.forEach((r) => (all ? n.delete(r.id) : n.add(r.id)));
    return n;
  });

  async function setStatus(ids, status) {
    const { error } = await window.supaClient
      .from("meeting_inbox").update({ status }).in("id", ids);
    if (error) throw error;
  }

  async function dismiss(ids) {
    if (!ids.length || busy) return;
    setBusy(true); setErr(null);
    try {
      await setStatus(ids, "dismissed");
      setItems((cur) => cur.filter((r) => !ids.includes(r.id)));
      setSel((s) => new Set([...s].filter((id) => !ids.includes(id))));
    } catch (e) { setErr(e.message || "Couldn't dismiss."); }
    finally { setBusy(false); }
  }

  async function moveTo(projectId) {
    const ids = [...sel];
    if (!ids.length || busy) return;
    setBusy(true); setErr(null);
    try {
      const chosen = items.filter((r) => ids.includes(r.id));
      chosen.forEach((r) => {
        const note = [r.owner, r.note].filter(Boolean).join(" · ");
        dispatch({ type: "ADD_TASK", projectId, text: r.text, note, lane });
      });
      await setStatus(ids, "moved");
      setItems((cur) => cur.filter((r) => !ids.includes(r.id)));
      setSel(new Set());
    } catch (e) { setErr(e.message || "Moved into the app, but couldn't update the inbox table."); }
    finally { setBusy(false); }
  }

  if (!items.length && !err) return null;

  return (
    <section className="minbox">
      <div className="sched-head">
        <span className="eyebrow">Meeting Inbox</span>
        <span className="sched-sub">to-dos pulled from Granola — file or flush</span>
        <span className="minbox-count">{items.length} item{items.length === 1 ? "" : "s"}</span>
      </div>

      <div className={"minbox-bar" + (sel.size ? " on" : "")}>
        <span className="minbox-bar-n">{sel.size ? sel.size + " selected →" : "select items, then choose where they go"}</span>
        <span className="minbox-lane">
          <button className={lane === "active" ? "on" : ""} onClick={() => setLane("active")}>This Week</button>
          <button className={lane === "queue" ? "on" : ""} onClick={() => setLane("queue")}>Queue</button>
        </span>
        {state.projects.map((p) => (
          <button key={p.id} className="minbox-proj" disabled={!sel.size || busy}
            style={{ borderColor: p.accent, color: p.accent }}
            onClick={() => moveTo(p.id)}>{p.name}</button>
        ))}
        <button className="minbox-dismiss" disabled={!sel.size || busy}
          onClick={() => dismiss([...sel])}>✕ not mine</button>
      </div>

      {err && <p className="minbox-err">{err}</p>}

      {groups.map((g) => (
        <div key={g.meeting_id} className="minbox-group">
          <div className="minbox-ghead">
            <input type="checkbox" checked={g.rows.every((r) => sel.has(r.id))}
              onChange={() => toggleGroup(g)} title="Select whole meeting" />
            <span className="minbox-gtitle">{g.title || "Untitled meeting"}</span>
            <span className="minbox-gdate">{inboxFmtDate(g.date)}</span>
          </div>
          {g.rows.map((r) => (
            <div key={r.id} className={"minbox-row" + (sel.has(r.id) ? " sel" : "")}>
              <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} />
              <div className="minbox-body" onClick={() => toggle(r.id)}>
                <span className="minbox-text">{r.text}</span>
                {(r.owner || r.note) ? (
                  <span className="minbox-note">{[r.owner, r.note].filter(Boolean).join(" · ")}</span>
                ) : null}
              </div>
              <button className="minbox-x" title="Not mine — remove" disabled={busy}
                onClick={() => dismiss([r.id])}>✕</button>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
window.MeetingInbox = MeetingInbox;
