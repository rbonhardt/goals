// ============================================================
// projectcard.jsx — task list, statuses, notes, subtasks, queue, DnD
// ============================================================
const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

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

function TaskRow({ task, project, lane }) {
  const { dispatch } = window.useFocusStore();
  const [showNote, setShowNote] = React.useState(!!task.note);
  const [showSubs, setShowSubs] = React.useState(task.subtasks.length > 0);
  const subDone = task.subtasks.filter(s => s.done).length;

  function startDrag(e) {
    window.DRAG = { taskId: task.id, fromProject: project.id, fromLane: lane };
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", task.id); } catch (x) {}
  }

  const isHabit = task.type === "habit";
  return (
    <div className={"task lane-" + lane + " status-" + task.status + (isHabit ? " is-habit" : "")} data-row data-task-id={task.id}
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
              className="task-note" placeholder="Add a note…" serif multiline />
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
                  <window.AddRow className="sub-add" placeholder="Add a step…" onAdd={(t) => dispatch({ type: "ADD_SUB", taskId: task.id, text: t })} />
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
          <div className="ttool-menu">
            <button className="ttool ttool-faint" title="More">⋯</button>
            <div className="menu-pop">
              {!task.note && !showNote && <button onClick={() => setShowNote(true)}>Add note</button>}
              <button onClick={() => dispatch({ type: "SET_TASK_TYPE", taskId: task.id, kind: isHabit ? "todo" : "habit" })}>{isHabit ? "Make a to-do" : "Make a habit"}</button>
              {!isHabit && task.subtasks.length === 0 && <button onClick={() => { dispatch({ type: "ADD_SUB", taskId: task.id, text: "First step" }); setShowSubs(true); }}>Add steps</button>}
              <button onClick={() => dispatch({ type: "MOVE_TASK", taskId: task.id, toProject: project.id, toLane: lane === "active" ? "queue" : "active" }) }>
                {lane === "active" ? "Send to queue" : "Move to active"}
              </button>
              <button className="danger" onClick={() => dispatch({ type: "DELETE_TASK", taskId: task.id })}>Delete</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Lane({ project, lane, tasks, children }) {
  const { dispatch } = window.useFocusStore();
  const [over, setOver] = React.useState(false);
  const ref = React.useRef(null);

  function onDrop(e) {
    e.preventDefault(); setOver(false);
    const d = window.DRAG; if (!d || !d.taskId) return;
    const idx = window.computeDropIndex(ref.current, e.clientY);
    dispatch({ type: "MOVE_TASK", taskId: d.taskId, toProject: project.id, toLane: lane, toIndex: idx });
    window.DRAG = { taskId: null };
  }
  return (
    <div ref={ref}
      className={"lane" + (over ? " lane-over" : "")}
      onDragOver={(e) => { if (window.DRAG && window.DRAG.taskId) { e.preventDefault(); setOver(true); } }}
      onDragLeave={(e) => { if (!ref.current.contains(e.relatedTarget)) setOver(false); }}
      onDrop={onDrop}>
      {tasks.map(t => <TaskRow key={t.id} task={t} project={project} lane={lane} />)}
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
  const doneCount = active.filter(t => t.status === "done").length;

  function startCardDrag(e) {
    if (e.target.closest(".task") || e.target.closest("input") || e.target.closest("textarea")) return;
    window.DRAGCARD = project.id; e.dataTransfer.effectAllowed = "move";
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
        <div className="ttool-menu">
          <button className="ttool ttool-faint" title="Project options" onClick={() => setMenuOpen(o => !o)}>⋯</button>
          {menuOpen && (
            <div className="menu-pop open" onMouseLeave={() => setMenuOpen(false)}>
              <div className="menu-swatches">
                {window.ACCENTS.map(a => (
                  <button key={a.key} className={"sw" + (project.accent === a.val ? " on" : "")} style={{ background: a.val }}
                    onClick={() => { dispatch({ type: "SET_ACCENT", projectId: project.id, accent: a.val }); }} />
                ))}
              </div>
              <button className="danger" onClick={() => { if (confirm("Delete project \"" + project.name + "\"?")) dispatch({ type: "DELETE_PROJECT", projectId: project.id }); }}>Delete project</button>
            </div>
          )}
        </div>
      </div>

      <Lane project={project} lane="active" tasks={active}>
        <window.AddRow className="task-add" placeholder="Add a to-do…" onAdd={(t) => dispatch({ type: "ADD_TASK", projectId: project.id, text: t, lane: "active" })} />
      </Lane>

      <div className="queue-section">
        <button className="queue-head" onClick={() => dispatch({ type: "TOGGLE_QUEUE", projectId: project.id })}>
          <span className={"queue-chev" + (project.queueOpen ? " open" : "")}>⌄</span>
          <span className="queue-label">Queue</span>
          <span className="queue-count">{queue.length}</span>
        </button>
        {project.queueOpen && (
          <Lane project={project} lane="queue" tasks={queue}>
            <window.AddRow className="task-add" placeholder="Park something for later…" onAdd={(t) => dispatch({ type: "ADD_TASK", projectId: project.id, text: t, lane: "queue" })} />
          </Lane>
        )}
      </div>
    </div>
  );
}

window.ProjectCard = ProjectCard;
