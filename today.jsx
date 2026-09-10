// ============================================================
// today.jsx — the day's list. Hand-picked tasks and steps from the cards
// below; the first three are numbered (the day's big three). Rows are the
// live items, so a check-off or edit here shows on the card and vice versa.
// ============================================================
function Today() {
  const { state, dispatch } = window.useFocusStore();
  const rows = window.selToday(state);
  // drop : null | insertion index
  const [drop, setDrop] = React.useState(null);
  const [dragKey, setDragKey] = React.useState(null);
  const ref = React.useRef(null);

  const doneCount = rows.filter(r => r.done).length;
  const dateLabel = new Date(window.todayISO() + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

  function startDrag(e, key) {
    e.stopPropagation();
    // one kind of drag at a time — clear the card-level globals
    window.DRAG = { taskId: null }; window.SUBDRAG = null; window.DRAGCARD = null;
    window.TODAYDRAG = key;
    setDragKey(key);
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", key); } catch (x) {}
  }

  // Anything draggable in the app can land here: a Today row (reorder), a
  // task row, or a step row (both add). Card drags carry their own globals.
  function incoming() {
    if (window.TODAYDRAG) return { kind: "today", key: window.TODAYDRAG };
    if (window.SUBDRAG) return { kind: "sub", taskId: window.SUBDRAG.taskId, subId: window.SUBDRAG.subId };
    if (window.DRAG && window.DRAG.taskId) return { kind: "task", taskId: window.DRAG.taskId };
    return null;
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
    if (!incoming()) return;
    e.preventDefault();
    setDrop(computeDrop(e));
  }

  function onDrop(e) {
    const d = incoming();
    setDrop(null);
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    // recompute from the drop event — the cursor may have moved since the
    // last dragover, and stale hover state must never pick the slot
    const idx = computeDrop(e);
    if (d.kind === "today") dispatch({ type: "TODAY_MOVE", key: d.key, toIndex: idx });
    else if (d.kind === "sub") dispatch({ type: "TODAY_ADD", taskId: d.taskId, subId: d.subId, toIndex: idx });
    else dispatch({ type: "TODAY_ADD", taskId: d.taskId, subId: null, toIndex: idx });
    window.TODAYDRAG = null; window.SUBDRAG = null; window.DRAG = { taskId: null };
    setDragKey(null);
  }

  return (
    <section className={"today" + (drop != null ? " today-over" : "")}
      onDragOver={onDragOver}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDrop(null); }}
      onDrop={onDrop}>
      <div className="today-head">
        <div>
          <h2 className="today-title">Today</h2>
          <span className="today-sub">{dateLabel} · the top three are the day's big three</span>
        </div>
        <span className="eyebrow today-count">{doneCount}/{rows.length} done</span>
      </div>

      <div className="today-list" ref={ref}>
        {rows.map((r, i) => (
          <TodayRow key={r.key} row={r} index={i}
            dragging={dragKey === r.key}
            dropBefore={drop === i}
            dropAfter={drop === rows.length && i === rows.length - 1}
            onDragStart={(e) => startDrag(e, r.key)}
            onDragEnd={() => { window.TODAYDRAG = null; setDragKey(null); setDrop(null); }} />
        ))}
        {rows.length === 0 && (
          <div className={"today-empty" + (drop != null ? " drop-before" : "")} data-row>
            Nothing picked yet — hit <span className="today-sun">☀</span> on any task or step below, or drag one up here.
          </div>
        )}
      </div>
    </section>
  );
}

function TodayRow({ row, index, dragging, dropBefore, dropAfter, onDragStart, onDragEnd }) {
  const { dispatch } = window.useFocusStore();
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
      className={"today-row" + (top3 ? " today-top" : "") + (row.done ? " is-done" : "") + (dragging ? " dragging" : "") + (dropBefore ? " drop-before" : "") + (dropAfter ? " drop-after" : "")}
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
        <span className="today-proj">
          <span className="today-proj-dot" style={{ background: project.accent }} />
          {project.name}
          {sub && <span className="today-parent"> · {task.text}</span>}
          {!sub && task.big ? <span className="today-parent"> · big three #{task.big}</span> : null}
        </span>
      </div>
      <button className="today-remove" title="Remove from Today (stays on its card)"
        onClick={() => dispatch({ type: "TODAY_REMOVE", taskId: task.id, subId: sub ? sub.id : null })}>×</button>
    </div>
  );
}
window.Today = Today;
