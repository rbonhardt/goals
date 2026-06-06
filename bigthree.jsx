// ============================================================
// bigthree.jsx — hero tile. 3 slots; promote from projects, reorder by drag.
// ============================================================
function BigThree() {
  const { state, dispatch } = window.useFocusStore();
  const big = window.selBigThree(state); // [slot1, slot2, slot3] each task-or-null
  const [dragId, setDragId] = React.useState(null);
  const [overIdx, setOverIdx] = React.useState(null);

  const filled = big.filter(Boolean);
  const order = filled.map(t => t.id);

  function onDrop(targetIdx) {
    if (dragId == null) return;
    const without = order.filter(id => id !== dragId);
    without.splice(targetIdx, 0, dragId);
    dispatch({ type: "REORDER_BIG", order: without });
    setDragId(null); setOverIdx(null);
  }

  return (
    <div className="b3-tile">
      <div className="b3-head">
        <div>
          <h2 className="b3-title">The Big Three</h2>
          <span className="b3-sub">this week's needle-movers</span>
        </div>
        <span className="eyebrow b3-count">{filled.length}/3 set</span>
      </div>

      <div className="b3-list">
        {big.map((t, i) => {
          if (!t) return (
            <div className="b3-row b3-empty" key={"e" + i}>
              <span className="b3-num b3-num-empty">{i + 1}</span>
              <span className="b3-empty-text">Promote a task from a project below ↓</span>
            </div>
          );
          const visualIdx = order.indexOf(t.id);
          return (
            <div key={t.id}
              data-row
              className={"b3-row" + (dragId === t.id ? " dragging" : "") + (overIdx === visualIdx ? " drop-before" : "")}
              draggable
              onDragStart={(e) => { setDragId(t.id); e.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(e) => { e.preventDefault(); setOverIdx(visualIdx); }}
              onDrop={(e) => { e.preventDefault(); onDrop(visualIdx); }}
              onDragEnd={() => { setDragId(null); setOverIdx(null); }}>
              <span className="b3-num" style={{ color: t.accent }}>{i + 1}</span>
              <div className="b3-body">
                {t.type === "habit"
                  ? <span className={"st st-" + t.status + " st-readonly"} title="Habit — track days on its card" style={{ width: 20, height: 20 }}><span className="st-glyph" /></span>
                  : <window.StatusToggle status={t.status} size={20} onCycle={() => dispatch({ type: "CYCLE_STATUS", taskId: t.id })} />}
                <div className="b3-textwrap">
                  <span className={"b3-text st-text-" + t.status}>{t.text}{t.type === "habit" ? <span className="b3-habit-prog"> · {(t.days || []).filter(Boolean).length}/{t.target || 5}</span> : null}</span>
                  <span className="b3-proj"><span className="b3-proj-dot" style={{ background: t.accent }} />{t.projectName}</span>
                </div>
              </div>
              <button className="b3-unpin" title="Remove from Big Three" onClick={() => dispatch({ type: "CLEAR_BIG", taskId: t.id })}>×</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
window.BigThree = BigThree;
