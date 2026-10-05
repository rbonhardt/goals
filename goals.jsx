// ============================================================
// goals.jsx — inked tile: this quarter's goals and this month's.
// Two checklists, each goal with one level of sub-goals. Type on the
// add line; Tab makes it a sub-goal of the goal above it. Editing a goal
// works the same way (see GoalRow), and a row can be dragged to re-sort or
// re-nest it (see GoalList). The quarter rolls by hand (↻ opens the recap);
// the month rolls on its own on the 1st (see rollMonth in store.jsx).
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
//
// Drag a row to re-sort it. Over a goal row, the top edge drops above it,
// the middle drops *into* it (the row becomes its sub-goal) and the bottom
// edge drops below it. Over a sub-goal row it lands among those sub-goals.
// A goal's sub-goals ride along with it. A drag stays in its own list —
// quarter and month goals don't trade places.
const GOAL_MIME = "application/x-focus-goal";
function GoalList({ scope, listKey, goals }) {
  const { dispatch } = window.useFocusStore();
  // drag : null | { id, sub } — the row being dragged from this list
  // drop : null | { kind: "before" | "after" | "into", id, sub } — where the
  //        drop mark shows; sub indents a line to the sub-goal level
  const [drag, setDrag] = React.useState(null);
  const [drop, setDrop] = React.useState(null);
  // the blank line Enter just made, which opens ready to type
  const [editId, setEditId] = React.useState(null);
  const ref = React.useRef(null);

  // rows in render order: each goal, then its sub-goals
  const flat = [];
  goals.forEach((g, gi) => {
    flat.push({ goal: g, gi });
    g.subs.forEach((s, si) => flat.push({ goal: s, gi, si, parent: g }));
  });

  // Enter on a row: a blank line right under it, at the same level. Under a
  // goal it goes past the goal's sub-goals — the next goal's spot.
  function insertBelow(r) {
    const id = window.uid();
    setEditId(id);
    dispatch(r.parent
      ? { type: "GOAL_INSERT", scope, key: listKey, id, parentId: r.parent.id, index: r.si + 1 }
      : { type: "GOAL_INSERT", scope, key: listKey, id, parentId: null, index: r.gi + 1 });
  }

  function startDrag(e, r) {
    e.stopPropagation();
    // one kind of drag at a time — clear the card and Today globals so a goal
    // can't land on a card or in Today
    window.DRAG = { taskId: null }; window.SUBDRAG = null; window.DRAGCARD = null; window.TODAYDRAG = null;
    window.GOALDRAG = { scope, key: listKey, id: r.goal.id };
    setDrag({ id: r.goal.id, sub: !!r.parent });
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData(GOAL_MIME, r.goal.id); } catch (x) {}
  }
  function endDrag() { window.GOALDRAG = null; setDrag(null); setDrop(null); }

  // a goal drag from this very list. The type check keeps a stale global (a
  // drag whose row unmounted before dragend) from catching some other drag.
  function incoming(e) {
    const d = window.GOALDRAG;
    if (!d || d.scope !== scope || d.key !== listKey) return null;
    return Array.from(e.dataTransfer.types || []).includes(GOAL_MIME) ? d : null;
  }

  // where a drop lands: { parentId, index } for GOAL_MOVE plus its mark, or
  // null over the dragged row itself (a goal can't go inside its own group)
  function computeDrop(e, d) {
    const els = ref.current ? [...ref.current.querySelectorAll(":scope > [data-goal]")] : [];
    if (!flat.length || els.length !== flat.length) return null;
    const y = e.clientY;
    for (let i = 0; i < flat.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (y >= r.bottom) continue;
      const row = flat[i], f = (y - r.top) / r.height;
      if (row.goal.id === d.id || (row.parent && row.parent.id === d.id)) return null;
      if (row.parent) {
        return f < 0.5
          ? { parentId: row.parent.id, index: row.si, line: { kind: "before", id: row.goal.id, sub: true } }
          : { parentId: row.parent.id, index: row.si + 1, line: { kind: "after", id: row.goal.id, sub: true } };
      }
      const g = row.goal;
      if (f < 0.3) return { parentId: null, index: row.gi, line: { kind: "before", id: g.id, sub: false } };
      if (f < 0.7) return { parentId: g.id, index: g.subs.length, line: { kind: "into", id: g.id, sub: true } };
      // below a goal that has sub-goals is its first sub-goal's spot
      return g.subs.length
        ? { parentId: g.id, index: 0, line: { kind: "after", id: g.id, sub: true } }
        : { parentId: null, index: row.gi + 1, line: { kind: "after", id: g.id, sub: false } };
    }
    return { parentId: null, index: goals.length, line: { kind: "after", id: flat[flat.length - 1].goal.id, sub: false } };
  }

  function onDragOver(e) {
    const d = incoming(e);
    if (!d) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const at = computeDrop(e, d), m = at && at.line;
    // dragover fires nonstop — keep the same object so the list doesn't re-render
    setDrop(p => p && m && p.kind === m.kind && p.id === m.id && p.sub === m.sub ? p : m);
  }

  function onDrop(e) {
    const d = incoming(e);
    setDrop(null);
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    // recompute from the drop event — the cursor may have moved since the
    // last dragover, and stale hover state must never pick the slot
    const at = computeDrop(e, d);
    if (at) dispatch({ type: "GOAL_MOVE", scope, key: listKey, id: d.id, parentId: at.parentId, toIndex: at.index });
    endDrag();
  }

  return (
    <div className="goals-list" ref={ref}
      onDragOver={onDragOver}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDrop(null); }}
      onDrop={onDrop}>
      {flat.map(r => (
        <GoalRow key={r.goal.id} scope={scope} listKey={listKey} goal={r.goal} sub={!!r.parent}
          autoEdit={r.goal.id === editId}
          canIndent={!r.parent && r.gi > 0}
          onEnter={() => insertBelow(r)}
          // a goal's sub-goals fade with it — they move together
          dragging={!!drag && (drag.id === r.goal.id || (!!r.parent && drag.id === r.parent.id))}
          drop={drop && drop.id === r.goal.id ? drop : null}
          onDragStart={(e) => startDrag(e, r)}
          onDragEnd={endDrag} />
      ))}
      <GoalAdd scope={scope} listKey={listKey} goals={goals} />
    </div>
  );
}

// One goal or sub-goal. Click the text to edit it. While editing: Enter
// saves and opens a new line under it, Tab nests it under the goal above,
// Shift+Tab lifts it back out, Escape cancels. A line left blank is deleted.
function GoalRow({ scope, listKey, goal, sub, autoEdit, canIndent, onEnter, dragging, drop, onDragStart, onDragEnd }) {
  const { dispatch } = window.useFocusStore();
  const [editing, setEditing] = React.useState(!!autoEdit);
  const [draft, setDraft] = React.useState(goal.text);
  // true while the input is open — Enter closes it, and the blur that
  // follows must not save or delete a second time
  const open = React.useRef(!!autoEdit);
  const inputRef = React.useRef(null);
  React.useEffect(() => { if (!editing) setDraft(goal.text); }, [goal.text, editing]);
  React.useEffect(() => { if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [editing]);
  // leaving the tab saves too: coming back pulls the synced copy, which
  // would drop a line still open here (a new one most of all)
  React.useEffect(() => {
    if (!editing) return;
    const onHide = () => { if (document.visibilityState === "hidden") finish(true); };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  });

  const act = (a) => dispatch({ ...a, scope, key: listKey, id: goal.id });
  function remove() {
    const n = sub ? 0 : goal.subs.length;
    if (n && !confirm(`Delete “${goal.text || "this goal"}” and its ${n} sub-goal${n === 1 ? "" : "s"}?`)) return;
    act({ type: "GOAL_DELETE" });
  }
  function startEdit() { open.current = true; setEditing(true); }
  // leave the input; save=false is Escape. Clearing the text deletes the
  // goal, same as a step on a card. Returns whether the goal is still there.
  function finish(save) {
    if (!open.current) return false;
    open.current = false;
    setEditing(false);
    const t = (save ? draft : goal.text).trim();
    if (!t) { remove(); return false; }
    if (t !== goal.text) act({ type: "GOAL_EDIT", text: t });
    return true;
  }
  function onKeyDown(e) {
    if (e.nativeEvent.isComposing) return; // mid-IME: Enter picks a candidate
    if (e.key === "Enter") { e.preventDefault(); if (finish(true)) onEnter(); return; }
    if (e.key === "Escape") { e.preventDefault(); finish(false); return; }
    // with nothing to nest or lift, Tab passes through so focus can leave
    if (e.key === "Tab" && (e.shiftKey ? sub : canIndent)) {
      e.preventDefault();
      act({ type: e.shiftKey ? "GOAL_OUTDENT" : "GOAL_INDENT" });
    }
  }

  return (
    <div data-goal
      className={"goal" + (sub ? " is-sub" : "") + (goal.done ? " is-done" : "") + (dragging ? " dragging" : "")
        + (drop ? " drop-" + drop.kind + (drop.sub ? " drop-sub" : "") : "")}
      // no dragging while editing, so a mouse-drag selects text
      draggable={!editing} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <span className="goal-grip" title={sub ? "Drag to re-sort, or out between goals to make it a goal" : "Drag to re-sort, or onto another goal to make it a sub-goal"}>⋮⋮</span>
      <button className={"goal-box" + (goal.done ? " on" : "")}
        title={goal.done ? "Done — click to reopen" : "Mark done"}
        onClick={() => act({ type: "GOAL_TOGGLE" })} />
      {editing
        ? <input ref={inputRef} className="inl-edit goal-text" value={draft}
            placeholder={sub ? "Sub-goal…" : "Goal…"} aria-label={sub ? "Sub-goal" : "Goal"}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => finish(true)}
            onKeyDown={onKeyDown} />
        : <span className="goal-text" style={{ cursor: "text" }} onClick={(e) => { e.stopPropagation(); startEdit(); }}>
            {goal.text || <span className="inl-ph">{sub ? "Sub-goal…" : "Goal…"}</span>}
          </span>}
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
