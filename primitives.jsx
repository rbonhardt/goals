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

// InlineText — click to edit a single line; blur/Enter commits
function InlineText({ value, onCommit, placeholder, className, style, multiline, serif }) {
  const [editing, setEditing] = uS(false);
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
          if (e.key === "Enter" && !multiline) { e.preventDefault(); commit(); }
          if (e.key === "Enter" && multiline && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
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

// AddRow — a "+ add" affordance that turns into an input
function AddRow({ onAdd, placeholder = "Add…", className }) {
  const [open, setOpen] = uS(false);
  const [val, setVal] = uS("");
  const ref = uR(null);
  uE(() => { if (open && ref.current) ref.current.focus(); }, [open]);
  const commit = () => { const v = val.trim(); if (v) onAdd(v); setVal(""); setOpen(false); };
  if (!open) return <button className={"addrow " + (className || "")} onClick={() => setOpen(true)}><span className="addrow-plus">+</span>{placeholder}</button>;
  return (
    <input ref={ref} className={"addrow-input " + (className || "")} value={val} placeholder={placeholder}
      onChange={(e) => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setVal(""); setOpen(false); } }} />
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
