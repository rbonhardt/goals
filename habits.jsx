// ============================================================
// habits.jsx — daily habits, between Scheduled and the Meeting Inbox.
// Each row: the habit with its card's tag, a dot for each of the last 30
// days (tap one to check or uncheck it), and a ring for the share of days
// checked since the habit started. Archived habits fold away below.
// State lives in store.jsx (state.habits; see liftHabits there).
// ============================================================
const HABIT_SPAN = 30;
const HABIT_RING_R = 16;
const HABIT_RING_C = 2 * Math.PI * HABIT_RING_R;

function habitFmtDay(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function habitFmtShort(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Days checked ÷ days since the start. Today counts once it's checked, so
// an open today never drags the number down. An archived habit stops
// counting on the day it was archived.
function habitStats(h, today) {
  const end = h.archived && h.archivedOn && h.archivedOn < today ? h.archivedOn : today;
  const hit = Object.keys(h.log || {}).filter(d => d >= h.startISO && d <= end).length;
  const days = Math.max(0, window.daysUntil(end, h.startISO)) + (h.log[end] ? 1 : 0);
  return { hit, days, pct: days ? Math.round((hit / days) * 100) : null };
}

// click-outside for the card-tag menu (same pattern as scheduled.jsx, scoped
// here because babel scripts don't share top-level bindings)
function habitClickOutside(open, onClose) {
  React.useEffect(() => {
    if (!open) return;
    const handle = (e) => { if (!e.target.closest("[data-popmenu]")) onClose(); };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open, onClose]);
}

function HabitRing({ pct, accent }) {
  const fill = pct == null ? 0 : Math.min(100, pct) / 100;
  return (
    <span className="habit-ring">
      <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r={HABIT_RING_R} className="habit-ring-track" />
        <circle cx="20" cy="20" r={HABIT_RING_R} className="habit-ring-fill" style={{ stroke: accent }}
          strokeDasharray={HABIT_RING_C} strokeDashoffset={HABIT_RING_C * (1 - fill)} transform="rotate(-90 20 20)" />
      </svg>
      <span className="habit-ring-pct">{pct == null ? "—" : pct + "%"}</span>
    </span>
  );
}

function HabitRow({ habit, days, today }) {
  const { state, dispatch } = window.useFocusStore();
  const [menuOpen, setMenuOpen] = React.useState(false);
  habitClickOutside(menuOpen, () => setMenuOpen(false));
  const project = state.projects.find(p => p.id === habit.projectId);
  const accent = project ? project.accent : "var(--ink-3)";
  const stats = habitStats(habit, today);
  const setProject = (projectId) => { dispatch({ type: "SET_HABIT_PROJECT", id: habit.id, projectId }); setMenuOpen(false); };

  return (
    <div className={"habit-row" + (habit.archived ? " is-archived" : "")}>
      <div className="habit-name">
        <window.InlineText value={habit.text} className="habit-title" placeholder="Habit…"
          onCommit={(t) => { if (t && t.trim()) dispatch({ type: "EDIT_HABIT_TEXT", id: habit.id, text: t.trim() }); }} />
        {habit.note ? (
          <window.InlineText value={habit.note} className="task-note habit-note" placeholder="Add a note…" serif multiline
            onCommit={(t) => dispatch({ type: "EDIT_HABIT_NOTE", id: habit.id, note: t })} />
        ) : null}
        <div className="habit-tagwrap" data-popmenu={menuOpen ? "" : null}>
          <button className="habit-card-tag" title="Change card" onClick={() => setMenuOpen(o => !o)}>
            <span className="habit-card-dot" style={{ background: accent }} />
            {project ? project.name : "No card"}
          </button>
          {menuOpen && (
            <div className="menu-pop open habit-card-pop">
              {state.projects.map(p => (
                <button key={p.id} className={p.id === habit.projectId ? "on" : ""} onClick={() => setProject(p.id)}>
                  <span className="habit-card-dot" style={{ background: p.accent }} />{p.name}
                </button>
              ))}
              <button className={!project ? "on" : ""} onClick={() => setProject(null)}>
                <span className="habit-card-dot" style={{ background: "var(--line-2)" }} />No card
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="habit-dots">
        {days.map(d => {
          const on = !!habit.log[d];
          return (
            <button key={d} disabled={habit.archived}
              className={"habit-dot" + (on ? " on" : "") + (d < habit.startISO ? " pre" : "")
                + (d === today ? " is-today" : "") + (window.weekdayIdx(d) === 0 ? " wk" : "")}
              style={on ? { background: accent, borderColor: accent } : null}
              title={habitFmtDay(d) + (on ? " — done" : d < habit.startISO ? " — before it started" : "")}
              aria-label={habitFmtDay(d)} aria-pressed={on}
              onClick={() => dispatch({ type: "TOGGLE_HABIT_DATE", id: habit.id, dateISO: d })} />
          );
        })}
      </div>

      <div className="habit-score" title={stats.hit + " of " + stats.days + " days since " + habitFmtShort(habit.startISO)}>
        <HabitRing pct={stats.pct} accent={accent} />
      </div>

      {habit.archived ? (
        <div className="habit-acts">
          <button className="ttool ttool-faint" onClick={() => dispatch({ type: "ARCHIVE_HABIT", id: habit.id, archived: false })}>Restore</button>
          <button className="ttool ttool-faint habit-del"
            onClick={() => { if (window.confirm("Delete “" + habit.text + "” and its history?")) dispatch({ type: "DELETE_HABIT", id: habit.id }); }}>Delete</button>
        </div>
      ) : (
        <button className="ttool ttool-faint habit-archive" title="Archive"
          onClick={() => dispatch({ type: "ARCHIVE_HABIT", id: habit.id, archived: true })}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="1.5" y="2.5" width="13" height="3.5" rx="1" />
            <path d="M2.75 6v6.5a1 1 0 0 0 1 1h8.5a1 1 0 0 0 1-1V6" />
            <path d="M6.5 9h3" />
          </svg>
        </button>
      )}
    </div>
  );
}

function Habits() {
  const { state, dispatch } = window.useFocusStore();
  const [collapsed, toggleCollapsed] = window.useCollapsePref("focus.ui.habitsCollapsed");
  const [showArchived, setShowArchived] = React.useState(false);
  const today = window.todayISO();
  const days = Array.from({ length: HABIT_SPAN }, (_, i) => window.addDaysISO(today, i - HABIT_SPAN + 1));
  const all = state.habits || [];
  const live = all.filter(h => !h.archived), archived = all.filter(h => h.archived);
  const doneToday = live.filter(h => h.log[today]).length;
  const allDone = live.length > 0 && doneToday === live.length;

  return (
    <section className="sched habits">
      <div className="sched-head">
        <button className={"sec-caret" + (collapsed ? "" : " open")} onClick={toggleCollapsed}
          title={collapsed ? "Expand" : "Collapse"} aria-expanded={!collapsed}>▸</button>
        <span className="eyebrow">Habits</span>
        <span className="sched-sub">daily — the last 30 days</span>
        {live.length > 0 && (
          <span className={"sched-count" + (allDone ? "" : " habit-count-open")}>
            {allDone ? "all done today ✓" : doneToday + " of " + live.length + " done today"}
          </span>
        )}
      </div>
      {!collapsed && (
        <div className="habit-list">
          {live.length > 0 && (
            <div className="habit-row habit-headrow" aria-hidden="true">
              <span />
              <div className="habit-dots">
                {days.map(d => (
                  <span key={d} className={"habit-daynum" + (d === today ? " is-today" : "") + (window.weekdayIdx(d) === 0 ? " wk" : "")}>
                    {parseInt(d.slice(8), 10)}
                  </span>
                ))}
              </div>
              <span /><span />
            </div>
          )}
          {live.map(h => <HabitRow key={h.id} habit={h} days={days} today={today} />)}
          <window.AddRow className="habit-add" placeholder="Add a habit…"
            onAdd={(t) => dispatch({ type: "ADD_HABIT", text: t })} />
          {archived.length > 0 && (
            <button className="habit-archived-toggle" onClick={() => setShowArchived(v => !v)}>
              {showArchived ? "Hide" : "Show"} archived ({archived.length})
            </button>
          )}
          {showArchived && archived.map(h => <HabitRow key={h.id} habit={h} days={days} today={today} />)}
        </div>
      )}
    </section>
  );
}
window.Habits = Habits;
