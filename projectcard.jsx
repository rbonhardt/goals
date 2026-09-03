// ============================================================
// projectcard.jsx — task list, statuses, notes, subtasks, queue, DnD
// ============================================================
const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// True on devices with a real pointer; hover-to-open only makes sense there.
// Touch browsers synthesize mouse events on tap, which would make the same
// tap open (mouseenter) and immediately close (click-toggle) the menu.
const CAN_HOVER = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

// Close when clicking anywhere outside this menu's own wrapper (ref).
function useClickOutside(open, ref, onClose) {
  React.useEffect(() => {
    if (!open) return;
    const handle = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open, ref, onClose]);
}

// Only one ⋯ menu open at a time, app-wide — opening one closes the previous,
// however the previous was opened (hover, click, or touch).
let closeOpenMenu = null;
function useSoloMenu(open, close) {
  React.useEffect(() => {
    if (!open) return;
    if (closeOpenMenu && closeOpenMenu !== close) closeOpenMenu();
    closeOpenMenu = close;
    return () => { if (closeOpenMenu === close) closeOpenMenu = null; };
  }, [open, close]);
}

// Hover-to-open for the ⋯ menus. Returns a ref for the wrapper div. Native
// mouseenter/mouseleave (not React synthetics) so hover works the same as
// CSS :hover. The short leave-delay forgives the mouse briefly slipping off
// the wrapper on the way into the pop menu; it holds off while keyboard
// focus is inside, so tabbing through the menu doesn't yank it away. On
// touch devices (no hover) the listeners are skipped and click toggles.
function useHoverMenu(setOpen) {
  const ref = React.useRef(null);
  const timer = React.useRef(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || !CAN_HOVER) return;
    const enter = () => { clearTimeout(timer.current); setOpen(true); };
    const leave = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (el.contains(document.activeElement)) return;
        setOpen(false);
      }, 200);
    };
    // Tab-out closes too — the leave timer defers to inside focus, so without
    // this a keyboard user could strand the menu open after the pointer left.
    const focusLeave = (e) => {
      if (!el.contains(e.relatedTarget) && !el.matches(":hover")) setOpen(false);
    };
    el.addEventListener("mouseenter", enter);
    el.addEventListener("mouseleave", leave);
    el.addEventListener("focusout", focusLeave);
    return () => {
      clearTimeout(timer.current);
      el.removeEventListener("mouseenter", enter);
      el.removeEventListener("mouseleave", leave);
      el.removeEventListener("focusout", focusLeave);
    };
  }, [setOpen]);
  return ref;
}

function HabitDays({ task, accent }) {
  const { dispatch } = window.useFocusStore();
  const hit = (task.days || []).filter(Boolean).length;
  const target = task.target || 5;
  const met = hit >= target;
  return (
    <div className="habit">
      <div className="habit-days">
        {DAY_LABELS.map((d, i) => (
          <button key={i} title={DAY_NAMES[i]}
            className={"hday" + (task.days[i] ? " on" : "")}
            style={task.days[i] ? { background: accent, borderColor: accent } : null}
            onClick={(e) => { e.stopPropagation(); dispatch({ type: "TOGGLE_HABIT_DAY", taskId: task.id, day: i }); }}>
            {d}
          </button>
        ))}
      </div>
      <div className="habit-meta">
        <span className={"habit-count" + (met ? " met" : "")}>{met ? "✓ " : ""}{hit}/{target} this week</span>
        <span className="habit-target">
          goal
          <button className="habit-step" title="Fewer days" onClick={(e) => { e.stopPropagation(); dispatch({ type: "SET_HABIT_TARGET", taskId: task.id, target: target - 1 }); }}>−</button>
          <b>{target}×</b>
          <button className="habit-step" title="More days" onClick={(e) => { e.stopPropagation(); dispatch({ type: "SET_HABIT_TARGET", taskId: task.id, target: target + 1 }); }}>+</button>
        </span>
      </div>
    </div>
  );
}

// Subtask list with drag-to-reorder. A step can be re-ordered among its
// siblings or dragged into any other task's step list — see Lane for the
// case where the destination task has no open list to aim at.
function SubList({ task }) {
  const { dispatch } = window.useFocusStore();
  // drop : null | insertion index (where the dragged step would land)
  const [drop, setDrop] = React.useState(null);
  const ref = React.useRef(null);

  function startDrag(e, subId) {
    e.stopPropagation(); // don't also start the parent task's drag
    // A drag that never fired dragend (source unmounted mid-drag, say) can
    // leave a stale global behind. Every drag start clears the other two so
    // only one kind of drag is ever live.
    window.DRAG = { taskId: null };
    window.DRAGCARD = null;
    window.SUBDRAG = { taskId: task.id, subId };
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", subId); } catch (x) {}
  }

  // First row whose midpoint sits below the cursor. Midpoints (rather than
  // row bounds) mean the 4px gaps between rows, and the space above the first
  // row, still resolve to a sensible index instead of falling through to
  // "append at the end".
  function computeDrop(e) {
    if (!window.SUBDRAG) return null;
    const rows = [...ref.current.querySelectorAll(":scope > [data-sub]")];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) return i;
    }
    return rows.length;
  }

  function onDragOver(e) {
    if (!window.SUBDRAG) return; // not a step drag — let the lane have it
    e.preventDefault();
    // Deliberately not stopping propagation: the Lane needs to see this to
    // drop its own row highlight (it bails on anything inside a .subs-list).
    setDrop(computeDrop(e));
  }

  function onDrop(e) {
    const d = window.SUBDRAG;
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    // recompute from the drop event — the cursor may have moved since the
    // last dragover, and stale hover state must never pick the slot
    const idx = computeDrop(e);
    setDrop(null);
    window.SUBDRAG = null;
    if (idx == null) return;
    if (d.taskId === task.id) dispatch({ type: "MOVE_SUB", taskId: task.id, subId: d.subId, toIndex: idx });
    else dispatch({ type: "MOVE_SUB_TO_TASK", fromTaskId: d.taskId, toTaskId: task.id, subId: d.subId, toIndex: idx });
  }

  return (
    <div className="subs-list" ref={ref}
      onDragOver={onDragOver}
      onDragLeave={(e) => { if (!ref.current.contains(e.relatedTarget)) setDrop(null); }}
      onDrop={onDrop}>
      {task.subtasks.map((s, i) => (
        <div className={"sub" + (drop === i ? " drop-before" : "") + (drop === task.subtasks.length && i === task.subtasks.length - 1 ? " drop-after" : "")}
          key={s.id} data-sub draggable
          onDragStart={(e) => startDrag(e, s.id)}
          onDragEnd={() => { window.SUBDRAG = null; setDrop(null); }}>
          <span className="sub-grip" title="Drag to reorder">⋮⋮</span>
          <button className={"sub-box" + (s.done ? " on" : "")} onClick={() => dispatch({ type: "TOGGLE_SUB", taskId: task.id, subId: s.id })} />
          <window.InlineText value={s.text} onCommit={(t) => { if (t) dispatch({ type: "EDIT_SUB", taskId: task.id, subId: s.id, text: t }); else dispatch({ type: "DEL_SUB", taskId: task.id, subId: s.id }); }}
            className={"sub-text" + (s.done ? " done" : "")} />
        </div>
      ))}
      <window.AddRow className="sub-add" placeholder="Add a step…" chainOnEnter
        onAdd={(t) => dispatch({ type: "ADD_SUB", taskId: task.id, text: t })} />
    </div>
  );
}

// Small date pill on a task row. Muted normally, amber inside 3 days,
// clay when overdue. Click opens the row's date editor.
function DueChip({ task, onEdit, chipRef }) {
  const d = window.daysUntil(task.due);
  const label = new Date(task.due + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const cls = d < 0 ? " overdue" : d <= 3 ? " soon" : "";
  const rel = d < 0 ? "late" : d === 0 ? "today" : d <= window.DUE_LEAD_DAYS ? `${d}d` : null;
  return (
    <button className={"due-chip" + cls} ref={chipRef}
      title={`Due ${label}${rel ? " (" + (d < 0 ? "overdue" : rel === "today" ? "due today" : "in " + rel) + ")" : ""} — click to change`}
      onClick={(e) => { e.stopPropagation(); onEdit(); }}>
      {label}{rel ? " · " + rel : ""}
    </button>
  );
}

function TaskRow({ task, project, lane, openNoteForId, onNoteOpened, dropMode }) {
  const { dispatch } = window.useFocusStore();
  const [showNote, setShowNote] = React.useState(!!task.note);
  const [showSubs, setShowSubs] = React.useState(false);
  const [showDue, setShowDue] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const chipRef = React.useRef(null);
  // refocus=true hands keyboard focus back to the chip (Enter/Escape close);
  // the timeout lets the chip re-mount first
  const closeDueEditor = (refocus) => {
    setShowDue(false);
    if (refocus) setTimeout(() => { if (chipRef.current) chipRef.current.focus(); }, 0);
  };
  // One-shot flag: when true, the note InlineText mounts already in editing
  // mode so the cursor lands inside it. Cleared after a render so future
  // re-renders don't keep forcing edit mode.
  const [autoEditNote, setAutoEditNote] = React.useState(false);
  const subDone = task.subtasks.filter(s => s.done).length;
  const closeMenu = React.useCallback(() => setMenuOpen(false), []);
  const hoverMenu = useHoverMenu(setMenuOpen);
  useClickOutside(menuOpen, hoverMenu, closeMenu);
  useSoloMenu(menuOpen, closeMenu);

  // AddRow Shift+N signals "open the note field for the task it just created".
  // ProjectCard sets openNoteForId; we react once, then clear it via onNoteOpened.
  React.useEffect(() => {
    if (openNoteForId && openNoteForId === task.id) {
      setShowNote(true);
      setAutoEditNote(true);
      onNoteOpened && onNoteOpened();
    }
  }, [openNoteForId, task.id, onNoteOpened]);

  // Consume the one-shot flag after it has been passed into InlineText.
  React.useEffect(() => { if (autoEditNote) setAutoEditNote(false); }, [autoEditNote]);

  function startDrag(e) {
    window.SUBDRAG = null; // never let a stale step drag ride along
    window.DRAGCARD = null;
    window.DRAG = { taskId: task.id, fromProject: project.id, fromLane: lane };
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", task.id); } catch (x) {}
  }

  const isHabit = task.type === "habit";
  const dropClass = dropMode ? " drop-" + dropMode : "";
  return (
    <div className={"task lane-" + lane + " status-" + task.status + (isHabit ? " is-habit" : "") + dropClass} data-row data-task-id={task.id}
      draggable onDragStart={startDrag}
      onDragEnd={() => { window.DRAG = { taskId: null }; }}>
      <div className="task-main">
        <span className="task-grip" title="Drag to reorder or move">⋮⋮</span>
        {isHabit
          ? <span className={"st st-" + task.status + " st-readonly"} title={"Habit — " + (task.status === "done" ? "goal met" : "in progress")} style={{ width: 18, height: 18 }}><span className="st-glyph" /></span>
          : <window.StatusToggle status={task.status} onCycle={() => dispatch({ type: "CYCLE_STATUS", taskId: task.id })} />}
        <div className="task-body">
          <div className="task-textline">
            {task.big && <span className="task-bigbadge" style={{ background: project.accent }}>{task.big}</span>}
            {isHabit && <span className="habit-tag" style={{ color: project.accent, borderColor: project.accent }}>habit</span>}
            {!isHabit && task.recurring && <span className="habit-tag" style={{ color: project.accent, borderColor: project.accent }} title="Repeats every week">weekly</span>}
            <window.InlineText value={task.text} onCommit={(t) => dispatch({ type: "EDIT_TASK_TEXT", taskId: task.id, text: t })}
              className={"task-text st-text-" + task.status} placeholder="Task…" />
            {!isHabit && task.due && !showDue && <DueChip task={task} chipRef={chipRef} onEdit={() => setShowDue(true)} />}
          </div>

          {showDue && (
            <div className="due-edit" onClick={(e) => e.stopPropagation()}
              onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setShowDue(false); }}>
              {/* Blur sits on the wrapper: clicking or tabbing anywhere outside
                  it closes the editor, while moving focus to the clear button
                  keeps it open — the chip is then the one way back in. The
                  clear button also eats mousedown for Safari, where buttons
                  don't take focus on click (relatedTarget would be null). */}
              <input type="date" className="due-input" value={task.due || ""} aria-label="Due date" autoFocus
                onChange={(e) => dispatch({ type: "SET_DUE", taskId: task.id, due: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); closeDueEditor(true); } }} />
              {lane === "queue" && <span className="due-hint">surfaces {window.DUE_LEAD_DAYS} days out</span>}
              {task.due && <button onMouseDown={(e) => e.preventDefault()}
                onClick={() => { dispatch({ type: "SET_DUE", taskId: task.id, due: null }); closeDueEditor(false); }}>clear</button>}
            </div>
          )}

          {showNote || task.note ? (
            <window.InlineText value={task.note} onCommit={(t) => { dispatch({ type: "EDIT_TASK_NOTE", taskId: task.id, note: t }); if (!t) setShowNote(false); }}
              className="task-note" placeholder="Add a note…" serif multiline
              defaultEditing={autoEditNote} />
          ) : null}

          {isHabit && <HabitDays task={task} accent={project.accent} />}

          {!isHabit && task.subtasks.length > 0 && (
            <div className="subs">
              <button className="subs-toggle" onClick={() => setShowSubs(s => !s)}>
                <span className={"subs-chev" + (showSubs ? "" : " closed")}>⌄</span>
                {subDone}/{task.subtasks.length} steps
              </button>
              {showSubs && <SubList task={task} />}
            </div>
          )}
        </div>

        <div className="task-tools">
          {/* starring a queued task promotes it out of the queue and into this week */}
          {task.big
            ? <button className="ttool" title="Pinned to Big Three" onClick={() => dispatch({ type: "CLEAR_BIG", taskId: task.id })} style={{ color: project.accent }}>★</button>
            : <button className="ttool ttool-faint" title={lane === "queue" ? "Promote to Big Three (moves it to this week)" : "Promote to Big Three"} onClick={() => dispatch({ type: "PROMOTE_NEXT", taskId: task.id })}>☆</button>}
          <div className="ttool-menu" data-popmenu={menuOpen ? "" : null} ref={hoverMenu}>
            {/* on hover-capable devices the menu is already open by the time a
                click lands, so a toggle would close it — open-only there */}
            <button className="ttool ttool-faint" title="More" onClick={(e) => { e.stopPropagation(); setMenuOpen(o => CAN_HOVER || !o); }}>⋯</button>
            {menuOpen && (
              <div className="menu-pop open">
                {!task.note && !showNote && <button onClick={() => { setShowNote(true); closeMenu(); }}>Add note</button>}
                <button onClick={() => { dispatch({ type: "SET_TASK_TYPE", taskId: task.id, kind: isHabit ? "todo" : "habit" }); closeMenu(); }}>{isHabit ? "Make a to-do" : "Make a habit"}</button>
                <button onClick={() => { dispatch({ type: "TOGGLE_RECURRING", taskId: task.id }); closeMenu(); }}>{task.recurring ? "Don’t repeat weekly" : "Repeat weekly"}</button>
                {!isHabit && task.subtasks.length === 0 && <button onClick={() => { dispatch({ type: "ADD_SUB", taskId: task.id, text: "First step" }); setShowSubs(true); closeMenu(); }}>Add steps</button>}
                {!isHabit && <button onClick={() => { setShowDue(true); closeMenu(); }}>{task.due ? "Change due date" : "Set due date"}</button>}
                <button onClick={() => { dispatch({ type: "MOVE_TASK", taskId: task.id, toProject: project.id, toLane: lane === "active" ? "queue" : "active" }); closeMenu(); }}>
                  {lane === "active" ? "Send to queue" : "Move to active"}
                </button>
                <button className="danger" onClick={() => { dispatch({ type: "DELETE_TASK", taskId: task.id }); closeMenu(); }}>Delete</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Lane({ project, lane, tasks, children, openNoteForId, onNoteOpened }) {
  const { state, dispatch } = window.useFocusStore();
  // drop : null | { type: "between", index } | { type: "into", taskId } | { type: "lane" }
  // - "between": insertion line between two rows; index = position to insert at
  // - "into":    drop highlights a target row; dragged becomes its subtask
  // - "lane":    lane is empty / dropped below all rows → append to lane
  const [drop, setDrop] = React.useState(null);
  const ref = React.useRef(null);

  // A task that owns subtasks can't be nested into another — doing so would
  // orphan its steps. Drags of such tasks only ever produce insertion lines.
  function draggedHasSubtasks() {
    const d = window.DRAG;
    if (!d || !d.taskId) return false;
    for (const p of state.projects)
      for (const t of p.tasks)
        if (t.id === d.taskId) return Array.isArray(t.subtasks) && t.subtasks.length > 0;
    return false;
  }

  // A step dragged out of one task can be dropped straight onto another task
  // row — that appends it as the target's last step. This is the only route
  // into a task whose step list is collapsed or still empty.
  function computeSubDrop(e) {
    const d = window.SUBDRAG;
    // An open step list handles its own drops — returning null here also
    // clears this lane's row highlight as the cursor moves into one.
    if (e.target && e.target.closest && e.target.closest(".subs-list")) return null;
    const rows = [...ref.current.querySelectorAll(":scope > [data-row]")];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (e.clientY < r.top || e.clientY > r.bottom) continue;
      const rowTaskId = rows[i].dataset.taskId;
      if (!rowTaskId || rowTaskId === d.taskId) return null; // placeholder, or its own parent
      const target = tasks.find(t => t.id === rowTaskId);
      if (!target || target.type === "habit") return null; // habits don't show steps
      return { type: "into", taskId: rowTaskId };
    }
    return null;
  }

  function computeDrop(e) {
    if (window.SUBDRAG) return computeSubDrop(e);
    const d = window.DRAG;
    if (!d || !d.taskId) return null;
    const rows = [...ref.current.querySelectorAll(":scope > [data-row]")];
    // Iterate task rows looking for the one under cursor
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (e.clientY < r.top) continue;
      if (e.clientY > r.bottom) continue;
      const rowTaskId = rows[i].dataset.taskId;
      const rel = (e.clientY - r.top) / r.height;
      // dragging a task onto itself disables nest-into, just bail (no preview)
      if (rowTaskId === d.taskId) {
        if (rel < 0.5) return { type: "between", index: i };
        return { type: "between", index: i + 1 };
      }
      // Empty lane placeholder rows don't have a taskId
      if (!rowTaskId) return { type: "between", index: i };
      // Top 30% / bottom 30% drop between rows; middle 40% nests
      if (rel < 0.3) return { type: "between", index: i };
      if (rel > 0.7) return { type: "between", index: i + 1 };
      // Tasks with their own subtasks can't be nested — fall back to an
      // insertion line so their steps never get silently dropped.
      if (draggedHasSubtasks()) return { type: "between", index: rel < 0.5 ? i : i + 1 };
      // Habits never show steps, so nesting into one would hide the task.
      const target = tasks.find(t => t.id === rowTaskId);
      if (target && target.type === "habit") return { type: "between", index: rel < 0.5 ? i : i + 1 };
      return { type: "into", taskId: rowTaskId };
    }
    // Above the first row (the lane's top padding, or the 3px the indicator
    // line is drawn above it) means "insert first", not "append last".
    if (rows.length && e.clientY < rows[0].getBoundingClientRect().top)
      return { type: "between", index: 0 };
    // Below all rows
    return { type: "between", index: rows.length };
  }

  function onDragOver(e) {
    if (!window.SUBDRAG && (!window.DRAG || !window.DRAG.taskId)) return;
    const current = computeDrop(e);
    // Only claim the drop when there is somewhere to put it, so a habit row
    // (or a step list's own territory) shows a "no drop" cursor rather than
    // accepting the drag and then doing nothing.
    if (current) e.preventDefault();
    setDrop(current);
  }

  function onDrop(e) {
    e.preventDefault();
    const sub = window.SUBDRAG;
    // Recompute rather than trust the hover state: the cursor may have moved
    // since the last dragover, and stale state must never pick the target.
    const current = computeDrop(e);
    setDrop(null);
    if (sub) {
      window.SUBDRAG = null;
      if (current && current.type === "into" && current.taskId !== sub.taskId)
        dispatch({ type: "MOVE_SUB_TO_TASK", fromTaskId: sub.taskId, toTaskId: current.taskId, subId: sub.subId, toIndex: null });
      return;
    }
    const d = window.DRAG;
    if (!d || !d.taskId || !current) { window.DRAG = { taskId: null }; return; }

    if (current.type === "into" && current.taskId && current.taskId !== d.taskId) {
      // Nest the dragged task as a subtask under the target.
      // Note: subtasks are a flatter shape than tasks (id/text/done only) —
      // dragging a complex task in here drops its note/status/subtasks.
      let dragged = null;
      for (const p of state.projects) {
        for (const t of p.tasks) if (t.id === d.taskId) { dragged = t; break; }
        if (dragged) break;
      }
      // Never nest a task that has subtasks — that would discard its steps —
      // and never nest into a habit, which never renders steps at all.
      const target = tasks.find(t => t.id === current.taskId);
      if (dragged && target && target.type !== "habit"
          && !(Array.isArray(dragged.subtasks) && dragged.subtasks.length > 0)) {
        dispatch({ type: "ADD_SUB", taskId: current.taskId, text: dragged.text });
        dispatch({ type: "DELETE_TASK", taskId: d.taskId });
      }
    } else if (current.type === "between") {
      dispatch({ type: "MOVE_TASK", taskId: d.taskId, toProject: project.id, toLane: lane, toIndex: current.index });
    }
    window.DRAG = { taskId: null };
  }

  // Pre-compute the dropMode for each row so TaskRow can render the indicator
  // without recomputing positions itself.
  const dropForIndex = (i) => {
    if (!drop) return null;
    if (drop.type === "into" && tasks[i] && drop.taskId === tasks[i].id) return "into";
    if (drop.type === "between") {
      if (drop.index === i) return "before";
      if (drop.index === tasks.length && i === tasks.length - 1) return "after";
    }
    return null;
  };

  return (
    <div ref={ref}
      className={"lane" + (drop ? " lane-over" : "")}
      onDragOver={onDragOver}
      onDragLeave={(e) => { if (!ref.current.contains(e.relatedTarget)) setDrop(null); }}
      onDrop={onDrop}>
      {tasks.map((t, i) => <TaskRow key={t.id} task={t} project={project} lane={lane}
        openNoteForId={openNoteForId} onNoteOpened={onNoteOpened} dropMode={dropForIndex(i)} />)}
      {tasks.length === 0 && <div className="lane-empty" data-row>{lane === "queue" ? "Queue is empty" : "Drop a task here"}</div>}
      {children}
    </div>
  );
}

function ProjectCard({ project }) {
  const { state, dispatch } = window.useFocusStore();
  const active = window.selActive(project);
  const queue = window.selQueue(project);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const closeMenu = React.useCallback(() => setMenuOpen(false), []);
  const hoverMenu = useHoverMenu(setMenuOpen);
  useClickOutside(menuOpen, hoverMenu, closeMenu);
  useSoloMenu(menuOpen, closeMenu);
  // Remember the last task added via the AddRow so Tab/Enter chain can attach
  // subtasks (or further subtasks) to it. Reset to null whenever the project
  // changes from outside the AddRow flow.
  const [lastTaskId, setLastTaskId] = React.useState(null);
  // Shift+N flag — set to a new task's id so the matching TaskRow auto-opens
  // its note field; the TaskRow clears it back to null when it consumes it.
  const [openNoteForId, setOpenNoteForId] = React.useState(null);
  const doneCount = active.filter(t => t.status === "done").length;

  function startCardDrag(e) {
    if (e.target.closest(".task") || e.target.closest("input") || e.target.closest("textarea")) return;
    window.SUBDRAG = null; window.DRAG = { taskId: null };
    window.DRAGCARD = project.id; e.dataTransfer.effectAllowed = "move";
  }

  // The task-add hotkey handler. extras: { habit, addNote, asSubtask }.
  // - asSubtask=true and we have a lastTaskId → dispatch ADD_SUB on it
  // - otherwise add a fresh task and remember its id for the next round
  // - addNote=true → also signal the new TaskRow to open its note field
  function handleAdd(lane, text, extras = {}) {
    if (extras.asSubtask && lastTaskId) {
      dispatch({ type: "ADD_SUB", taskId: lastTaskId, text });
      return;
    }
    const id = window.uid();
    dispatch({
      type: "ADD_TASK",
      id,
      projectId: project.id,
      text,
      lane,
      taskType: extras.habit ? "habit" : "todo",
    });
    setLastTaskId(id);
    if (extras.addNote) setOpenNoteForId(id);
  }

  return (
    <div className="pcard" style={{ "--accent": project.accent }}
      onDragOver={(e) => { if (window.DRAGCARD && window.DRAGCARD !== project.id) e.preventDefault(); }}
      onDrop={(e) => { if (window.DRAGCARD && window.DRAGCARD !== project.id) {
        e.preventDefault();
        const ids = state.projects.map(p => p.id);
        const from = ids.indexOf(window.DRAGCARD), to = ids.indexOf(project.id);
        ids.splice(to, 0, ids.splice(from, 1)[0]);
        dispatch({ type: "REORDER_PROJECTS", order: ids });
        window.DRAGCARD = null;
      }}}>
      <div className="pcard-head" draggable onDragStart={startCardDrag} onDragEnd={() => window.DRAGCARD = null}>
        <span className="pcard-swatch" style={{ background: project.accent }} />
        <window.InlineText value={project.name} onCommit={(t) => dispatch({ type: "RENAME_PROJECT", projectId: project.id, name: t })} className="pcard-name" serif placeholder="Project" />
        <span className="pcard-count">{doneCount}/{active.length}</span>
        <div className="ttool-menu" data-popmenu={menuOpen ? "" : null} ref={hoverMenu}>
          <button className="ttool ttool-faint" title="Project options" onClick={(e) => { e.stopPropagation(); setMenuOpen(o => CAN_HOVER || !o); }}>⋯</button>
          {menuOpen && (
            <div className="menu-pop open">
              <div className="menu-swatches">
                {window.ACCENTS.map(a => (
                  <button key={a.key} className={"sw" + (project.accent === a.val ? " on" : "")} style={{ background: a.val }}
                    onClick={() => { dispatch({ type: "SET_ACCENT", projectId: project.id, accent: a.val }); }} />
                ))}
              </div>
              <button className="danger" onClick={() => { if (confirm("Delete project \"" + project.name + "\"?")) { dispatch({ type: "DELETE_PROJECT", projectId: project.id }); setMenuOpen(false); } }}>Delete project</button>
            </div>
          )}
        </div>
      </div>

      <Lane project={project} lane="active" tasks={active}
        openNoteForId={openNoteForId}
        onNoteOpened={() => setOpenNoteForId(null)}>
        <window.AddRow className="task-add" placeholder="Add a to-do…"
          chainOnEnter allowTab allowHabit allowNote
          onAdd={(t, extras) => handleAdd("active", t, extras)} />
      </Lane>

      <div className="queue-section">
        <button className="queue-head" onClick={() => dispatch({ type: "TOGGLE_QUEUE", projectId: project.id })}>
          <span className={"queue-chev" + (project.queueOpen ? " open" : "")}>⌄</span>
          <span className="queue-label">Queue</span>
          <span className="queue-count">{queue.length}</span>
        </button>
        {project.queueOpen && (
          <Lane project={project} lane="queue" tasks={queue}
            openNoteForId={openNoteForId}
            onNoteOpened={() => setOpenNoteForId(null)}>
            <window.AddRow className="task-add" placeholder="Park something for later…"
              chainOnEnter allowTab allowHabit allowNote
              onAdd={(t, extras) => handleAdd("queue", t, extras)} />
          </Lane>
        )}
      </div>
    </div>
  );
}

window.ProjectCard = ProjectCard;
