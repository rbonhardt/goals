// ============================================================
// primitives.jsx — shared UI atoms + drag-and-drop helper
// ============================================================
const { useState: uS, useRef: uR, useEffect: uE } = React;

// ---- drag state (module-level, shared across cards) ----
window.DRAG = { taskId: null, fromProject: null, fromLane: null };

// StatusToggle — 3-state: todo (ring) -> doing (half amber) -> done (filled)
function StatusToggle({ status, onCycle, size = 18 }) {
  const title = status === "todo" ? "To do — click for In progress"
    : status === "doing" ? "In progress — click for Done"
    : "Done — click to reset";
  return (
    <button className={"st st-" + status} title={title}
      onClick={(e) => { e.stopPropagation(); onCycle(); }}
      style={{ width: size, height: size }}>
      <span className="st-glyph" />
    </button>
  );
}

// InlineText — click to edit a single line; blur/Enter commits.
// On multiline (notes, affirmations): plain Enter SUBMITS; Shift+Enter inserts a newline.
// defaultEditing: starts in editing mode and immediately focuses (used by Shift+N
// to drop the cursor right into a new task's note field).
function InlineText({ value, onCommit, placeholder, className, style, multiline, serif, defaultEditing }) {
  const [editing, setEditing] = uS(!!defaultEditing);
  const [draft, setDraft] = uS(value);
  const ref = uR(null);
  uE(() => { setDraft(value); }, [value]);
  uE(() => { if (editing && ref.current) { ref.current.focus(); ref.current.select && ref.current.select(); } }, [editing]);
  const commit = () => { setEditing(false); if (draft !== value) onCommit(draft); };
  if (editing) {
    const Tag = multiline ? "textarea" : "input";
    return (
      <Tag ref={ref} className={"inl-edit " + (className || "")}
        style={{ ...style, ...(serif ? { fontFamily: "var(--serif)" } : {}) }}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          // Plain Enter submits in both single-line and multiline.
          // Shift+Enter on multiline inserts a newline.
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
          if (e.key === "Escape") { setDraft(value); setEditing(false); }
        }}
        rows={multiline ? 2 : undefined} />
    );
  }
  return (
    <span className={className} style={{ ...style, cursor: "text" }} onClick={(e) => { e.stopPropagation(); setEditing(true); }}>
      {value || <span className="inl-ph">{placeholder}</span>}
    </span>
  );
}

// AddRow — a "+ add" affordance that turns into an input.
//
// Standard mode (no hotkey props): Enter commits + closes; blur commits; Esc closes.
//
// Power-mode props (used by the task add row inside ProjectCard):
//   chainOnEnter    — after a successful Enter the input clears but stays focused,
//                     so you can rattle off tasks. Enter on empty input closes.
//   allowTab        — Tab commits the current text and signals "treat the next
//                     entries as subtasks of the just-added task". Parent reads
//                     extras.asSubtask and dispatches ADD_SUB on lastTaskId.
//   allowHabit      — Shift+H toggles "habit mode". The placeholder swaps to
//                     "Habit name…" and on commit extras.habit === true so the
//                     parent can add the task as a habit.
//
// onAdd receives (text, extras), where extras = { habit, asSubtask }.
function AddRow({ onAdd, placeholder = "Add…", className, chainOnEnter, allowTab, allowHabit, allowNote }) {
  const [open, setOpen]       = uS(false);
  const [val, setVal]         = uS("");
  const [habit, setHabit]     = uS(false);
  const [note, setNote]       = uS(false);   // set by Shift+N; opens note field on commit
  const [subMode, setSubMode] = uS(false);   // set after Tab; child of last task
  const ref = uR(null);
  uE(() => { if (open && ref.current) ref.current.focus(); }, [open]);

  const closeAll = () => { setVal(""); setHabit(false); setNote(false); setSubMode(false); setOpen(false); };

  const commit = (extras = {}) => {
    const v = val.trim();
    if (v) onAdd(v, { habit, addNote: note, asSubtask: subMode, ...extras });
    setVal("");
    if (extras.keepOpen) {
      // chain-mode: stay open, clear the per-task flags (they applied to that one task)
      setHabit(false);
      setNote(false);
      // subMode persists across commits so you can chain subtasks under the same parent
    } else {
      closeAll();
    }
  };

  if (!open) {
    return (
      <button className={"addrow " + (className || "")} onClick={() => setOpen(true)}>
        <span className="addrow-plus">+</span>{placeholder}
      </button>
    );
  }

  const hotkeyMode = chainOnEnter || allowTab || allowHabit || allowNote;
  const effectivePlaceholder =
      subMode ? "Add a step…" :
      habit   ? "Habit name…" :
      note    ? "Task (will open note after)…" :
      placeholder;

  return (
    <div className={"addrow-active" + (hotkeyMode ? " has-hints" : "")}>
      <input ref={ref}
        className={"addrow-input " + (className || "") + (habit ? " habit-mode" : "") + (subMode ? " sub-mode" : "")}
        value={val}
        placeholder={effectivePlaceholder}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => {
          // commit on blur if there's pending text, otherwise just close.
          if (val.trim()) commit();
          else closeAll();
        }}
        onKeyDown={(e) => {
          // Esc — always close
          if (e.key === "Escape") {
            e.preventDefault();
            closeAll();
            return;
          }
          // Enter — commit; if chain mode, stay open
          if (e.key === "Enter") {
            e.preventDefault();
            if (chainOnEnter && val.trim()) commit({ keepOpen: true });
            else commit();
            return;
          }
          // Tab — flip into subtask mode (subsequent commits go to the last task)
          if (e.key === "Tab" && allowTab) {
            e.preventDefault();
            if (val.trim()) {
              // commit current line first as a parent task, then flip to sub
              commit({ keepOpen: true });
              setSubMode(true);
            } else {
              // empty Tab on an already-added task → enter sub mode
              setSubMode(true);
            }
            return;
          }
          // Shift+Tab — leave subtask mode
          if (e.key === "Tab" && e.shiftKey) {
            e.preventDefault();
            setSubMode(false);
            return;
          }
          // Shift+H — toggle habit mode for the about-to-be-created task
          if (allowHabit && e.shiftKey && (e.key === "H" || e.key === "h")) {
            e.preventDefault();
            setHabit(h => !h);
            return;
          }
          // Shift+N — flag the task so its note field auto-opens after commit
          if (allowNote && e.shiftKey && (e.key === "N" || e.key === "n")) {
            e.preventDefault();
            setNote(n => !n);
            return;
          }
        }} />
      {hotkeyMode && (
        <div className="addrow-hints">
          {habit   && <span className="addrow-tag">habit</span>}
          {note    && <span className="addrow-tag note">+ note</span>}
          {subMode && <span className="addrow-tag sub">subtask of last</span>}
          <span>↵ add</span>
          {chainOnEnter && <span>· stays open</span>}
          {allowTab    && <span>· ⇥ subtask</span>}
          {allowHabit  && <span>· ⇧H habit</span>}
          {allowNote   && <span>· ⇧N note</span>}
          <span>· esc close</span>
        </div>
      )}
    </div>
  );
}

// Drop indicator helper: given a container + clientY, find insert index among [data-row] children
function computeDropIndex(container, clientY) {
  const rows = [...container.querySelectorAll(":scope > [data-row]")];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect();
    if (clientY < r.top + r.height / 2) return i;
  }
  return rows.length;
}

Object.assign(window, { StatusToggle, InlineText, AddRow, computeDropIndex });
