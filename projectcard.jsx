// ============================================================
// projectcard.jsx — task list, statuses, notes, subtasks, queue, DnD
// ============================================================
const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// Generic click-outside-to-close hook. Element must carry the `data-popmenu` attribute.
function useClickOutside(open, onClose) {
  React.useEffect(() => {
    if (!open) return;
    const handle = (e) => {
      if (!e.target.closest("[data-popmenu]")) onClose();
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open, onClose]);
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

function TaskRow({ task, project, lane, openNoteForId, onNoteOpened, dropMode }) {
  const { dispatch } = window.useFocusStore();
  const [showNote, setShowNote] = React.useState(!!task.note);
  const [showSubs, setShowSubs] = React.useState(task.subtasks.length > 0);
  const [menuOpen, setMenuOpen] = React.useState(false);
  // One-shot flag: when true, the note InlineText mounts already in editing
  // mode so the cursor lands inside it. Cleared after a render so future
  // re-renders don't keep forcing edit mode.
  const [autoEditNote, setAutoEditNote] = React.useState(false);
  useClickOutside(menuOpen, () => setMenuOpen(false));
  const subDone = task.subtasks.filter(s => s.done).length;
  const closeMenu = () => setMenuOpen(false);

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
            {task.big && lane === "active" && <span className="task-bigbadge" style={{ background: project.accent }}>{task.big}</span>}
            {isHabit && <span className="habit-tag" style={{ color: project.accent, borderColor: project.accent }}>habit</span>}
            <window.InlineText value={task.text} onCommit={(t) => dispatch({ type: "EDIT_TASK_TEXT", taskId: task.id, text: t })}
              className={"task-text st-text-" + task.status} placeholder="Task…" />
          </div>

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
              {showSubs && (
                <div className="subs-list">
                  {task.subtasks.map(s => (
                    <div className="sub" key={s.id}>
                      <button className={"sub-box" + (s.done ? " on" : "")} onClick={() => dispatch({ type: "TOGGLE_SUB", taskId: task.id, subId: s.id })} />
                      <window.InlineText value={s.text} onCommit={(t) => { if (t) dispatch({ type: "EDIT_SUB", taskId: task.id, subId: s.id, text: t }); else dispatch({ type: "DEL_SUB", taskId: task.id, subId: s.id }); }}
                        className={"sub-text" + (s.done ? " done" : "")} />
                    </div>
                  ))}
                  <window.AddRow className="sub-add" placeholder="Add a step…" chainOnEnter
                    onAdd={(t) => dispatch({ type: "ADD_SUB", taskId: task.id, text: t })} />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="task-tools">
          {lane === "active" && (
            task.big
              ? <button className="ttool" title="Pinned to Big Three" onClick={() => dispatch({ type: "CLEAR_BIG", taskId: task.id })} style={{ color: project.accent }}>★</button>
              : <button className="ttool ttool-faint" title="Promote to Big Three" onClick={() => dispatch({ type: "PROMOTE_NEXT", taskId: task.id })}>☆</button>
          )}
          <div className="ttool-menu" data-popmenu={menuOpen ? "" : null}>
            <button className="ttool ttool-faint" title="More" onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o); }}>⋯</button>
            {menuOpen && (
              <div className="menu-pop open">
                {!task.note && !showNote && <button onClick={() => { setShowNote(true); closeMenu(); }}>Add note</button>}
                <button onClick={() => { dispatch({ type: "SET_TASK_TYPE", taskId: task.id, kind: isHabit ? "todo" : "habit" }); closeMenu(); }}>{isHabit ? "Make a to-do" : "Make a habit"}</button>
                {!isHabit && task.subtasks.length === 0 && <button onClick={() => { dispatch({ type: "ADD_SUB", taskId: task.id, text: "First step" }); setShowSubs(true); closeMenu(); }}>Add steps</button>}
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

  function computeDrop(e) {
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
      return { type: "into", taskId: rowTaskId };
    }
    // Below all rows
    return { type: "between", index: rows.length };
  }

  function onDragOver(e) {
    if (!window.DRAG || !window.DRAG.taskId) return;
    e.preventDefault();
    setDrop(computeDrop(e));
  }

  function onDrop(e) {
    e.preventDefault();
    const d = window.DRAG;
    const current = drop || computeDrop(e);
    setDrop(null);
    if (!d || !d.taskId || !current) { window.DRAG = { taskId: null }; return; }

    if (current.type === "into" && current.taskId && current.taskId !== d.taskId) {
      // Nest the dragged task as a subtask under the target.
      // Note: subtasks are a flatter shape than tasks (id/text/done only) —
      // dragging a complex task in here drops its note/status/subtasks.
      let draggedText = null;
      for (const p of state.projects) {
        for (const t of p.tasks) if (t.id === d.taskId) { draggedText = t.text; break; }
        if (draggedText) break;
      }
      if (draggedText) {
        dispatch({ type: "ADD_SUB", taskId: current.taskId, text: draggedText });
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
  useClickOutside(menuOpen, () => setMenuOpen(false));
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
        <div className="ttool-menu" data-popmenu={menuOpen ? "" : null}>
          <button className="ttool ttool-faint" title="Project options" onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o); }}>⋯</button>
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
              chainOnEnter allowNote
              onAdd={(t, extras) => handleAdd("queue", t, extras)} />
          </Lane>
        )}
      </div>
    </div>
  );
}

window.ProjectCard = ProjectCard;
