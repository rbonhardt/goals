// ============================================================
// today.jsx — the day's list. Hand-picked tasks and steps from the cards
// below; the first three are numbered (the day's big three). Rows are the
// live items, so a check-off or edit here shows on the card and vice versa.
// A type-to-add line sits under the open rows: new to-dos go onto a card's
// This week lane, and Tab makes the line a step of the task above it.
// Day tabs (Monday to Sunday) sit over the list: pick one to see and fill
// that day's plan, or drop a row on a tab to move it to that day. A day's
// plan joins Today that morning (see planToday in store.jsx).
// ============================================================

// The week the tabs show: this one, Monday to Sunday — or, once it has been
// closed early (the app's week already starts next Monday, say on a Sunday
// evening), next week, so there are days left to plan.
function tabWeek(state, today) {
  const mon = window.addDaysISO(today, -window.weekdayIdx(today));
  const next = window.addDaysISO(mon, 7);
  const start = state.week.startISO === next ? next : mon;
  return [0, 1, 2, 3, 4, 5, 6].map(n => window.addDaysISO(start, n));
}
const dayName = (iso, weekday) => new Date(iso + "T00:00:00").toLocaleDateString("en-US", { weekday });

function Today() {
  const { state, dispatch } = window.useFocusStore();
  const today = window.todayISO();
  const week = tabWeek(state, today);
  // today stays reachable when the tabs show next week
  const tabs = week.includes(today) ? week : [today, ...week];
  // the day on screen: one picked from the tabs, else Today. A picked day
  // that has come round (a page left open overnight) is just Today.
  const [picked, setPicked] = React.useState(null);
  const day = picked && picked > today && week.includes(picked) ? picked : today;
  const isToday = day === today;
  const rows = window.selDay(state, day);
  // drop : null | insertion index; tabOver : the tab a drag is over
  const [drop, setDrop] = React.useState(null);
  const [tabOver, setTabOver] = React.useState(null);
  const [dragKey, setDragKey] = React.useState(null);
  const ref = React.useRef(null);

  const doneCount = rows.filter(r => r.done).length;
  const dateLabel = new Date(day + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

  function startDrag(e, r) {
    e.stopPropagation();
    // one kind of drag at a time — clear the card-level globals
    window.DRAG = { taskId: null }; window.SUBDRAG = null; window.DRAGCARD = null;
    window.TODAYDRAG = { key: r.key, taskId: r.taskId, subId: r.subId, day };
    setDragKey(r.key);
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", r.key); } catch (x) {}
  }
  function endDrag() {
    window.TODAYDRAG = null; window.SUBDRAG = null; window.DRAG = { taskId: null };
    setDragKey(null); setDrop(null); setTabOver(null);
  }

  // Anything draggable in the app can land here: a row of this list
  // (reorder), a task row, or a step row (both add). Card drags carry their
  // own globals.
  function incoming() {
    if (window.TODAYDRAG) return window.TODAYDRAG;
    if (window.SUBDRAG) return { taskId: window.SUBDRAG.taskId, subId: window.SUBDRAG.subId };
    if (window.DRAG && window.DRAG.taskId) return { taskId: window.DRAG.taskId, subId: null };
    return null;
  }
  // The action that lands drag `d` on day `target` at `toIndex` (null: the
  // end), or null when it can't land there: a day gone by, a habit on a day
  // ahead (habits keep no plan day), or a Today row onto the Today tab.
  function landing(d, target, toIndex) {
    if (!d || target < today) return null;
    if (target === today) {
      if (d.key && d.day === today) return toIndex == null ? null : { type: "TODAY_MOVE", key: d.key, toIndex };
      return { type: "TODAY_ADD", taskId: d.taskId, subId: d.subId, toIndex };
    }
    if (!d.subId && state.projects.some(p => p.tasks.some(t => t.id === d.taskId && t.type === "habit"))) return null;
    return { type: "PLAN_ADD", taskId: d.taskId, subId: d.subId, day: target, toIndex };
  }

  function computeDrop(e) {
    const list = ref.current;
    if (!list) return 0;
    const rowEls = [...list.querySelectorAll(":scope > [data-row]")];
    for (let i = 0; i < rowEls.length; i++) {
      const r = rowEls[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) return i;
    }
    return rowEls.length;
  }

  function onDragOver(e) {
    if (!landing(incoming(), day, 0)) return;
    e.preventDefault();
    setDrop(computeDrop(e));
  }

  function onDrop(e) {
    // recompute from the drop event — the cursor may have moved since the
    // last dragover, and stale hover state must never pick the slot
    const act = landing(incoming(), day, computeDrop(e));
    setDrop(null);
    if (!act) return;
    e.preventDefault();
    e.stopPropagation();
    dispatch(act);
    endDrag();
  }

  // A tab takes a drop too: the row goes on the end of that day's list, and
  // the tab on screen stays put, so a run of rows can be sent out in turn.
  // Its events stop here, so the list below shows no drop line meanwhile.
  function tabDragOver(e, iso) {
    e.stopPropagation();
    setDrop(null);
    if (!landing(incoming(), iso, null)) return;
    e.preventDefault();
    setTabOver(iso);
  }
  function tabDrop(e, iso) {
    e.stopPropagation();
    const act = landing(incoming(), iso, null);
    setTabOver(null);
    if (!act) return;
    e.preventDefault();
    dispatch(act);
    endDrag();
  }

  // Open rows come first (the store keeps them there); the add line sits
  // between them and the finished pile. A step right under its own task
  // (or under a sibling step that is) indents like an outline.
  const split = rows.findIndex(r => r.sortDone);
  const openCount = split < 0 ? rows.length : split;
  const nested = [];
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    nested[i] = !!(r.sub && prev && prev.taskId === r.taskId && (!prev.sub || nested[i - 1]));
  });
  // One keyed list, add line included: a row crossing into the finished pile
  // is moved, not rebuilt, so it keeps keyboard focus.
  // the add line is keyed by day, so a draft or a pending step doesn't follow
  // the tabs to another day
  const items = rows.map((r, i) => renderRow(r, i));
  if (state.projects.length > 0)
    items.splice(openCount, 0, <TodayAdd key={"__add" + day} day={isToday ? null : day} above={rows[openCount - 1] || null} projects={state.projects} />);
  if (rows.length === 0) items.unshift(
    <div key="__empty" className={"today-empty" + (drop != null ? " drop-before" : "")} data-row>
      {isToday
        ? <>Nothing picked yet — type one in, hit <span className="today-sun">☀</span> on any task or step below, or drag one up here.</>
        : <>Nothing planned yet — type one in, or drag a task or step here or onto this tab.</>}
    </div>
  );
  function renderRow(r, i) {
    return (
      <TodayRow key={r.key} row={r} index={i} nested={nested[i]} day={isToday ? null : day}
        dragging={dragKey === r.key}
        dropBefore={drop === i}
        dropAfter={drop === rows.length && i === rows.length - 1}
        onDragStart={(e) => startDrag(e, r)}
        onDragEnd={endDrag} />
    );
  }

  return (
    <section className={"today" + (drop != null ? " today-over" : "")}
      onDragOver={onDragOver}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) { setDrop(null); setTabOver(null); } }}
      onDrop={onDrop}>
      <div className="today-head">
        <div>
          <h2 className="today-title">{isToday ? "Today" : dayName(day, "long")}</h2>
          <span className="today-sub">{isToday
            ? dateLabel + " · the top three are the day's big three"
            : dateLabel + " · moves onto Today that morning"}</span>
        </div>
        <span className="eyebrow today-count">{isToday ? doneCount + "/" + rows.length + " done" : rows.length + " planned"}</span>
      </div>

      <div className="today-tabs" role="tablist" aria-label="Day">
        {tabs.map(iso => {
          const past = iso < today, on = iso === day;
          // open rows waiting on a day ahead, as a small count on its tab
          const waiting = iso > today ? window.selDay(state, iso).filter(r => !r.done).length : 0;
          const date = new Date(iso + "T00:00:00");
          return (
            <button key={iso} type="button" role="tab" aria-selected={on} aria-disabled={past || null}
              className={"today-tab" + (on ? " on" : "") + (iso === today ? " is-today" : "") + (past ? " is-past" : "") + (tabOver === iso ? " drop-on" : "")}
              title={past ? dayName(iso, "long") + " has gone by — what was left moved to Today"
                : iso === today ? "Today" : dayName(iso, "long") + (waiting ? " — " + waiting + " planned" : "") + ". Drop a row here to move it to this day"}
              onClick={() => { if (!past) setPicked(iso === today ? null : iso); }}
              onDragOver={(e) => tabDragOver(e, iso)}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setTabOver(null); }}
              onDrop={(e) => tabDrop(e, iso)}>
              <span className="today-tab-wd">{week.includes(today) || iso !== today ? dayName(iso, "short") : "Today"}</span>
              <span className="today-tab-date">{date.getDate()}</span>
              {waiting > 0 && <span className="today-tab-n">{waiting}</span>}
            </button>
          );
        })}
      </div>

      <div className="today-list" ref={ref}>
        {items}
      </div>
    </section>
  );
}

// `day` is set on a day ahead, null on Today
function TodayRow({ row, index, nested, day, dragging, dropBefore, dropAfter, onDragStart, onDragEnd }) {
  const { state, dispatch } = window.useFocusStore();
  const { task, sub, project } = row;
  const isHabit = !sub && task.type === "habit";
  const status = sub ? (sub.done ? "done" : "todo") : isHabit ? (row.done ? "done" : "todo") : task.status;

  function toggle() {
    if (sub) dispatch({ type: "TOGGLE_SUB", taskId: task.id, subId: sub.id });
    // "today" is resolved inside the reducer, so a page rendered yesterday
    // still marks the right day
    else if (isHabit) dispatch({ type: "TOGGLE_HABIT_DAY", taskId: task.id, day: "today" });
    else dispatch({ type: "CYCLE_STATUS", taskId: task.id });
  }
  function edit(text) {
    if (!text) return; // deleting happens on the card, not from here
    if (sub) dispatch({ type: "EDIT_SUB", taskId: task.id, subId: sub.id, text });
    else dispatch({ type: "EDIT_TASK_TEXT", taskId: task.id, text });
  }

  const top3 = index < 3;
  return (
    <div data-row
      className={"today-row" + (top3 ? " today-top" : "") + (nested ? " is-nested" : "") + (row.done ? " is-done" : "") + (dragging ? " dragging" : "") + (dropBefore ? " drop-before" : "") + (dropAfter ? " drop-after" : "")}
      draggable onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <span className="today-grip" title="Drag to reorder">⋮⋮</span>
      <span className={"today-num" + (top3 ? "" : " today-num-rest")} style={top3 ? { color: project.accent } : null}>{top3 ? index + 1 : "·"}</span>
      {sub
        ? <button className={"sub-box today-box" + (sub.done ? " on" : "")} title={sub.done ? "Done — click to reset" : "Mark step done"} onClick={toggle} />
        : isHabit
          ? <button className={"st st-" + status} title={row.done ? "Marked for today — click to undo" : "Mark today's habit"} onClick={toggle} style={{ width: 20, height: 20 }}><span className="st-glyph" /></button>
          : <window.StatusToggle status={status} size={20} onCycle={toggle} />}
      <div className="today-textwrap">
        <window.InlineText value={row.text} onCommit={edit}
          className={"today-text st-text-" + status} placeholder="Task…" />
        {/* a step tucked under its task needs no label — the task is right above */}
        {!nested && (
          <span className="today-proj">
            <span className="today-proj-dot" style={{ background: project.accent }} />
            {/* a step lives in its task, so only a task can switch cards */}
            {sub ? project.name : (
              <CardPick project={project} projects={state.projects}
                onPick={(id) => dispatch({ type: "MOVE_TASK", taskId: task.id, toProject: id, toLane: "active", toIndex: null })} />
            )}
            {sub && <span className="today-parent"> · {task.text}</span>}
            {!sub && task.big ? <span className="today-parent"> · big three #{task.big}</span> : null}
          </span>
        )}
      </div>
      <button className="today-remove" title={"Remove from " + (day ? dayName(day, "long") : "Today") + " (stays on its card)"}
        onClick={() => dispatch({ type: day ? "PLAN_REMOVE" : "TODAY_REMOVE", taskId: task.id, subId: sub ? sub.id : null })}>×</button>
    </div>
  );
}

// The card a task lives on, as a quiet dropdown: the label is plain text with
// an invisible native <select> laid over it, so the label keeps its own width
// and phones get their own picker. Picking a card moves the task onto that
// card's This week lane — a Today task is always this week's work.
function CardPick({ project, projects, onPick }) {
  return (
    <span className="today-card" title="Move to another card">
      {project.name}<span className="today-card-caret">▾</span>
      <select value={project.id} aria-label="Card"
        onChange={(e) => { if (e.target.value !== project.id) onPick(e.target.value); }}>
        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </span>
  );
}

// The type-to-add line. Enter adds what's typed and keeps the cursor here for
// the next one. Tab makes the line a step of the task above it (the row above,
// or that row's own task when it is a step); Shift+Tab, or Backspace on an
// empty line, turns it back. A new to-do goes on the picked card — by default
// the card of the row above — and always on its This week lane. On a day
// ahead (`day` set) it lands on that day's list rather than Today's.
function TodayAdd({ day, above, projects }) {
  const { dispatch } = window.useFocusStore();
  const [text, setText] = React.useState("");
  // the task a step will land on — pinned when the line is nested, so a list
  // that reshuffles mid-typing (a sync, a check-off) can't swap the parent
  const [stepParentId, setStepParentId] = React.useState(null);
  const [pickedId, setPickedId] = React.useState(null);
  const [focused, setFocused] = React.useState(false);
  const inputRef = React.useRef(null);

  // habits have no steps, so a habit above leaves nothing to nest under
  const nestable = above && (above.sub || above.task.type !== "habit") ? above.task : null;
  let parent = nestable, parentProject = null;
  if (stepParentId) {
    parentProject = projects.find(p => p.tasks.some(t => t.id === stepParentId && t.type !== "habit")) || null;
    // a parent deleted mid-typing: fall back to a to-do, the draft stays put
    parent = parentProject ? parentProject.tasks.find(t => t.id === stepParentId) : nestable;
  }
  const step = !!parentProject;
  const card = projects.find(p => p.id === pickedId)
    || (above && projects.find(p => p.id === above.project.id))
    || projects[0];

  function add() {
    const v = text.trim();
    if (!v) return;
    dispatch(step
      ? { type: "TODAY_NEW", text: v, parentTaskId: parent.id, day }
      : { type: "TODAY_NEW", text: v, projectId: card.id, day });
    setText("");
  }

  function onKeyDown(e) {
    if (e.nativeEvent.isComposing) return; // mid-IME: Enter picks a candidate
    if (e.key === "Enter") { e.preventDefault(); add(); return; }
    // Shift+Tab first — plain Tab would otherwise swallow it. With nothing
    // to back out of it passes through, so focus can still walk backwards.
    if (e.key === "Tab" && e.shiftKey) {
      if (!step) return;
      e.preventDefault(); setStepParentId(null); return;
    }
    // Tab only nests; once nested (or with nothing above to nest under) it
    // passes through, so focus can always leave the line
    if (e.key === "Tab") {
      if (step || !parent) return;
      e.preventDefault(); setStepParentId(parent.id); return;
    }
    if (e.key === "Backspace" && step && text === "") { e.preventDefault(); setStepParentId(null); return; }
    if (e.key === "Escape") { setText(""); setStepParentId(null); e.currentTarget.blur(); }
  }

  // the box doubles as the Tab key for phones (no Tab there): tap to nest
  const canToggle = step || !!parent;
  return (
    <div className={"today-add" + (step ? " is-step" : "") + (focused ? " is-focused" : "")}
      onClick={(e) => { if (e.target === e.currentTarget) inputRef.current.focus(); }}>
      <span className="today-grip" aria-hidden="true" />
      <span className="today-num today-num-rest" aria-hidden="true" />
      <button type="button" className={"today-add-box" + (step ? " is-step" : "")} disabled={!canToggle}
        title={step ? "Make it a to-do again (Shift+Tab)" : parent ? "Make it a step of “" + parent.text + "” (Tab)" : "Add a to-do"}
        // keep focus in the input so the keyboard stays up on phones
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => { setStepParentId(step ? null : parent.id); inputRef.current.focus(); }}>+</button>
      <div className="today-textwrap">
        <input ref={inputRef} className="today-add-input" value={text}
          placeholder={step ? "Add a step…" : "Add a to-do…"}
          aria-label={step ? "Add a step to " + parent.text : "Add a to-do for " + (day ? dayName(day, "long") : "today")}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown} />
        <span className="today-proj">
          <span className="today-proj-dot" style={{ background: (step ? parentProject : card).accent }} />
          {step
            ? <span className="today-parent">step of {parent.text}</span>
            : <CardPick project={card} projects={projects}
                onPick={(id) => { setPickedId(id); inputRef.current.focus(); }} />}
          {focused && (
            <span className="today-add-hints">
              ↵ add{parent && !step ? " · ⇥ make it a step" : ""}{step ? " · ⇧⇥ back to a to-do" : ""} · esc clear
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
window.Today = Today;
