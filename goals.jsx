// ============================================================
// goals.jsx — inked tile: this quarter's goals and this month's.
// Two checklists, each goal with one level of sub-goals. Type on the
// add line; Tab makes it a sub-goal of the goal above it. The quarter
// rolls by hand (↻ opens the recap); the month rolls on its own on
// the 1st (see rollMonth in store.jsx).
// ============================================================
function Goals() {
  const { state } = window.useFocusStore();
  const q = state.quarter;
  const due = window.quarterIsDue(state);
  // the list's own month, so a tab left open past the 1st still names the
  // list it shows (the next action rolls it)
  const [y, m] = state.month.key.split("-").map(Number);
  const monthName = new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long" });
  const today = window.todayISO();
  let left = null;
  if (window.monthKey(today) === state.month.key) {
    const n = new Date(y, m, 0).getDate() - Number(today.slice(8, 10));
    left = n === 0 ? "last day" : n + (n === 1 ? " day left" : " days left");
  }
  return (
    <div className="ns-tile goals-tile">
      <section className="goals-sec">
        <div className="goals-head">
          <span className="eyebrow goals-eyebrow">{q.label} goals{q.range ? " · " + q.range : ""}</span>
          <button className={"ns-q-new" + (due ? " due" : "")}
            title={due ? `${q.label} is complete — recap it & set your next 12 weeks` : "Recap this quarter & set new 12-week goals"}
            onClick={() => window.__openQuarterReview && window.__openQuarterReview()}>↻</button>
        </div>
        <GoalList scope="quarter" goals={q.goals} />
      </section>
      <section className="goals-sec">
        <div className="goals-head">
          <span className="eyebrow goals-eyebrow">{monthName} goals</span>
          {left && <span className="goals-left">{left}</span>}
        </div>
        <GoalList scope="month" listKey={state.month.key} goals={state.month.goals} />
      </section>
    </div>
  );
}

// listKey: the month a month list belongs to. Every action carries it, so one
// made just as the month rolls over still finds its goal (see goalTarget).
function GoalList({ scope, listKey, goals }) {
  const rows = [];
  goals.forEach(g => {
    rows.push(<GoalRow key={g.id} scope={scope} listKey={listKey} goal={g} />);
    g.subs.forEach(s => rows.push(<GoalRow key={s.id} scope={scope} listKey={listKey} goal={s} sub />));
  });
  return (
    <div className="goals-list">
      {rows}
      <GoalAdd scope={scope} listKey={listKey} goals={goals} />
    </div>
  );
}

function GoalRow({ scope, listKey, goal, sub }) {
  const { dispatch } = window.useFocusStore();
  const act = (a) => dispatch({ ...a, scope, key: listKey, id: goal.id });
  function remove() {
    const n = sub ? 0 : goal.subs.length;
    if (n && !confirm(`Delete “${goal.text}” and its ${n} sub-goal${n === 1 ? "" : "s"}?`)) return;
    act({ type: "GOAL_DELETE" });
  }
  return (
    <div className={"goal" + (sub ? " is-sub" : "") + (goal.done ? " is-done" : "")}>
      <button className={"goal-box" + (goal.done ? " on" : "")}
        title={goal.done ? "Done — click to reopen" : "Mark done"}
        onClick={() => act({ type: "GOAL_TOGGLE" })} />
      {/* clearing the text deletes the goal, same as a step on a card */}
      <window.InlineText value={goal.text} className="goal-text" placeholder="Goal…"
        onCommit={(t) => { if (t.trim()) act({ type: "GOAL_EDIT", text: t }); else remove(); }} />
      <button className="goal-x" title="Delete" onClick={remove}>×</button>
    </div>
  );
}

// The type-to-add line. Enter adds and keeps the cursor here for the next
// one. Tab makes the line a sub-goal of the last goal in the list; Shift+Tab,
// or Backspace on an empty line, turns it back. The parent is pinned once
// nested, so adding more sub-goals keeps them under the same goal.
function GoalAdd({ scope, listKey, goals }) {
  const { dispatch } = window.useFocusStore();
  const [text, setText] = React.useState("");
  const [parentId, setParentId] = React.useState(null);
  const [focused, setFocused] = React.useState(false);
  const inputRef = React.useRef(null);

  // a parent deleted mid-typing: fall back to a top-level goal, draft stays put
  const parent = parentId ? goals.find(g => g.id === parentId) || null : null;
  const last = goals[goals.length - 1] || null;

  function add() {
    const v = text.trim();
    if (!v) return;
    dispatch({ type: "GOAL_ADD", scope, key: listKey, text: v, parentId: parent ? parent.id : null });
    setText("");
  }

  function onKeyDown(e) {
    if (e.nativeEvent.isComposing) return; // mid-IME: Enter picks a candidate
    if (e.key === "Enter") { e.preventDefault(); add(); return; }
    // with nothing to nest or un-nest, Tab passes through so focus can leave
    if (e.key === "Tab" && e.shiftKey) {
      if (!parent) return;
      e.preventDefault(); setParentId(null); return;
    }
    if (e.key === "Tab") {
      if (parent || !last) return;
      e.preventDefault(); setParentId(last.id); return;
    }
    if (e.key === "Backspace" && parent && text === "") { e.preventDefault(); setParentId(null); return; }
    if (e.key === "Escape") { setText(""); setParentId(null); e.currentTarget.blur(); }
  }

  // the box doubles as the Tab key on phones: tap to nest or un-nest
  const canToggle = !!parent || !!last;
  return (
    <div className={"goal goal-add" + (parent ? " is-sub" : "") + (focused ? " is-focused" : "")}>
      <button type="button" className="goal-box goal-add-box" disabled={!canToggle}
        title={parent ? "Make it a goal again (Shift+Tab)" : last ? "Make it a sub-goal of “" + last.text + "” (Tab)" : "Add a goal"}
        // keep focus in the input so the keyboard stays up on phones
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => { setParentId(parent ? null : last.id); inputRef.current.focus(); }}>+</button>
      <input ref={inputRef} className="goal-add-input" value={text}
        placeholder={parent ? "Add a sub-goal…" : "Add a goal…"}
        aria-label={parent ? "Add a sub-goal to " + parent.text : "Add a " + scope + " goal"}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={onKeyDown} />
      {focused && (
        <span className="goal-add-hints">
          ↵ add{last && !parent ? " · ⇥ sub-goal" : ""}{parent ? " · ⇧⇥ back" : ""}
        </span>
      )}
    </div>
  );
}
window.Goals = Goals;
