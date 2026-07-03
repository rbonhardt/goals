// ============================================================
// scheduled.jsx — recurring commitments strip (weekly/monthly cadence).
// Sits above the project grid: things with a due day that must not slip.
// Done-state is derived per period — weekly items key on the app week's
// startISO, monthly items on the real calendar month — so items re-arm
// themselves when the week closes / the month turns; no reset pass needed.
// ============================================================
const SCHED_DAYS = ["M", "T", "W", "T", "F", "S", "S"];
const SCHED_DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SCHED_DAY_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SCHED_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// local-timezone today as YYYY-MM-DD (toISOString would drift near midnight)
function schedTodayISO() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function schedOrd(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function schedFmtDay(iso) {
  return SCHED_MONTHS[parseInt(iso.slice(5, 7), 10) - 1] + " " + parseInt(iso.slice(8, 10), 10);
}

// Everything the row needs to render: current period key, due date,
// status (done | today | overdue | upcoming) and display labels.
function schedInfo(item, state) {
  const todayISO = schedTodayISO();
  let periodKey, dueISO, when;
  if (item.cadence === "monthly") {
    periodKey = todayISO.slice(0, 7); // YYYY-MM
    const y = parseInt(periodKey.slice(0, 4), 10), m = parseInt(periodKey.slice(5, 7), 10);
    const dd = Math.min(item.date || 1, new Date(y, m, 0).getDate());
    dueISO = periodKey + "-" + String(dd).padStart(2, "0");
    when = "monthly · " + schedOrd(item.date || 1);
  } else {
    periodKey = state.week.startISO;
    const day = item.day == null ? 6 : item.day;
    dueISO = window.addDaysISO(periodKey, day);
    when = "weekly · " + SCHED_DAY_SHORT[day];
  }
  const done = item.doneFor === periodKey;
  const status = done ? "done" : todayISO === dueISO ? "today" : todayISO > dueISO ? "overdue" : "upcoming";
  const dueLabel =
    status === "done"    ? "✓ done" :
    status === "today"   ? "due today" :
    status === "overdue" ? "missed " + schedFmtDay(dueISO) :
    "due " + schedFmtDay(dueISO);
  return { periodKey, dueISO, status, dueLabel, when, done };
}

// click-outside for the ⋯ menu (same pattern as projectcard, scoped here
// because babel scripts don't share top-level bindings)
function schedClickOutside(open, onClose) {
  React.useEffect(() => {
    if (!open) return;
    const handle = (e) => { if (!e.target.closest("[data-popmenu]")) onClose(); };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open, onClose]);
}

function SchedItem({ item }) {
  const { state, dispatch } = window.useFocusStore();
  const info = schedInfo(item, state);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [showNote, setShowNote] = React.useState(!!item.note);
  schedClickOutside(menuOpen, () => setMenuOpen(false));
  const closeMenu = () => setMenuOpen(false);

  return (
    <div className={"sched-item is-" + info.status}>
      <button className={"st st-" + (info.done ? "done" : "todo")} style={{ width: 18, height: 18 }}
        title={info.done ? "Done this cycle — click to undo" : "Mark done for this cycle"}
        onClick={() => dispatch({ type: "TOGGLE_SCHEDULED", id: item.id, periodKey: info.periodKey, todayISO: schedTodayISO() })}>
        <span className="st-glyph" />
      </button>

      <div className="sched-body">
        <window.InlineText value={item.text}
          onCommit={(t) => { if (t && t.trim()) dispatch({ type: "EDIT_SCHEDULED_TEXT", id: item.id, text: t }); }}
          className={"sched-text" + (info.done ? " st-text-done" : "")} placeholder="Scheduled task…" />
        {(showNote || item.note) ? (
          <window.InlineText value={item.note}
            onCommit={(t) => { dispatch({ type: "EDIT_SCHEDULED_NOTE", id: item.id, note: t }); if (!t) setShowNote(false); }}
            className="task-note" placeholder="Add a note…" serif multiline />
        ) : null}
        <div className="sched-meta">
          <span className="sched-when">{info.when}</span>
          <span className={"sched-due sched-due-" + info.status}>{info.dueLabel}</span>
        </div>
      </div>

      <div className="ttool-menu" data-popmenu={menuOpen ? "" : null}>
        <button className="ttool ttool-faint" title="Options" onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o); }}>⋯</button>
        {menuOpen && (
          <div className="menu-pop open sched-pop">
            <div className="sched-cad-row">
              <button className={item.cadence !== "monthly" ? "on" : ""}
                onClick={() => dispatch({ type: "SET_SCHEDULED_CADENCE", id: item.id, cadence: "weekly" })}>Weekly</button>
              <button className={item.cadence === "monthly" ? "on" : ""}
                onClick={() => dispatch({ type: "SET_SCHEDULED_CADENCE", id: item.id, cadence: "monthly" })}>Monthly</button>
            </div>
            {item.cadence === "monthly" ? (
              <div className="sched-date-row">
                on the
                <input type="number" min="1" max="31" value={item.date || 1} className="sched-date-input"
                  onChange={(e) => dispatch({ type: "SET_SCHEDULED_CADENCE", id: item.id, date: parseInt(e.target.value, 10) || 1 })} />
                of each month
              </div>
            ) : (
              <div className="sched-day-row">
                {SCHED_DAYS.map((d, i) => (
                  <button key={i} title={SCHED_DAY_FULL[i]}
                    className={"hday" + ((item.day == null ? 6 : item.day) === i ? " on" : "")}
                    style={(item.day == null ? 6 : item.day) === i ? { background: "var(--gold)", borderColor: "var(--gold)" } : null}
                    onClick={() => dispatch({ type: "SET_SCHEDULED_CADENCE", id: item.id, day: i })}>{d}</button>
                ))}
              </div>
            )}
            {!item.note && !showNote && <button onClick={() => { setShowNote(true); closeMenu(); }}>Add note</button>}
            <button className="danger" onClick={() => { dispatch({ type: "DELETE_SCHEDULED", id: item.id }); closeMenu(); }}>Delete</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Scheduled() {
  const { state, dispatch } = window.useFocusStore();
  const items = state.scheduled || [];
  const attention = items.filter(it => {
    const s = schedInfo(it, state).status;
    return s === "today" || s === "overdue";
  }).length;

  return (
    <section className="sched">
      <div className="sched-head">
        <span className="eyebrow">Scheduled</span>
        <span className="sched-sub">recurring — don't let these slip</span>
        <span className={"sched-count" + (attention ? " hot" : "")}>
          {attention ? attention + " need" + (attention === 1 ? "s" : "") + " doing" : "all clear ✓"}
        </span>
      </div>
      <div className="sched-list">
        {items.map(it => <SchedItem key={it.id} item={it} />)}
        <window.AddRow className="sched-add" placeholder="Add a scheduled task…"
          onAdd={(t) => dispatch({ type: "ADD_SCHEDULED", text: t })} />
      </div>
    </section>
  );
}
window.Scheduled = Scheduled;
