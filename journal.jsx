// ============================================================
// journal.jsx — the backlog: every closed week and every closed
// 12-week cycle, logged as journal entries in one timeline.
// Each entry can be copied as Markdown — the seam for later piping
// these into Obsidian / a vector store / shared AI memory.
// ============================================================
function fmtClosed(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function isoDay(ts) { return ts ? new Date(ts).toISOString().slice(0, 10) : ""; }

function weekToMd(h) {
  let s = `## Week ${h.n} — ${h.range}`;
  if (h.savedAt) s += `\n*Closed ${isoDay(h.savedAt)}*`;
  if (h.journal) s += `\n\n**Big Wins (ESP):**\n${h.journal}`;
  if (h.completed && h.completed.length) {
    s += `\n\n**Completed (${h.completed.length}):**`;
    h.completed.forEach(c => { s += `\n- ${c.text}${c.parent ? ` _(under ${c.parent})_` : ""} _[${c.project}]_`; });
  }
  return s.trim();
}
function quarterToMd(h) {
  const hit = h.goals.filter(g => g.done).length;
  let s = `## ${h.label} (12 weeks) — ${h.range}  ·  ${hit}/${h.goals.length} goals hit`;
  if (h.closedAt) s += `\n*Closed ${isoDay(h.closedAt)}*`;
  if (h.journal) s += `\n\n**Reflection:**\n${h.journal}`;
  if (h.goals && h.goals.length) {
    s += `\n\n**Goals:**`;
    h.goals.forEach(g => { s += `\n- ${g.done ? "✓" : "○"} ${g.text}`; });
  }
  return s.trim();
}

function CopyBtn({ getText, label = "Copy as Markdown" }) {
  const [done, setDone] = React.useState(false);
  async function copy() {
    const text = getText();
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (_) {}
      document.body.removeChild(ta);
    }
    setDone(true); setTimeout(() => setDone(false), 1600);
  }
  return <button className={"jr-copy" + (done ? " ok" : "")} onClick={copy}>{done ? "Copied ✓" : label}</button>;
}

function Journal({ onClose }) {
  const { state } = window.useFocusStore();
  const [filter, setFilter] = React.useState("all"); // all | week | quarter

  const items = React.useMemo(() => {
    const weeks = (state.history || []).map(h => ({ kind: "week", when: h.savedAt || 0, data: h }));
    const quarters = (state.quarterHistory || []).map(h => ({ kind: "quarter", when: h.closedAt || 0, data: h }));
    let all = [...weeks, ...quarters].sort((a, b) => b.when - a.when);
    if (filter !== "all") all = all.filter(i => i.kind === filter);
    return all;
  }, [state.history, state.quarterHistory, filter]);

  const weekCount = (state.history || []).length;
  const qCount = (state.quarterHistory || []).length;

  function exportAll() {
    const weeks = (state.history || []).map(h => ({ when: h.savedAt || 0, md: weekToMd(h) }));
    const quarters = (state.quarterHistory || []).map(h => ({ when: h.closedAt || 0, md: quarterToMd(h) }));
    const body = [...weeks, ...quarters].sort((a, b) => b.when - a.when).map(x => x.md).join("\n\n---\n\n");
    return `# Focus — Journal\n*Exported ${isoDay(Date.now())}*\n\n${body}`;
  }

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cw jr">
        <div className="cw-head">
          <div>
            <div className="eyebrow">Looking back</div>
            <h2 className="cw-title">Journal</h2>
          </div>
          <div className="cw-tabs">
            <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>All</button>
            <button className={filter === "week" ? "on" : ""} onClick={() => setFilter("week")}>Weeks{weekCount ? ` (${weekCount})` : ""}</button>
            <button className={filter === "quarter" ? "on" : ""} onClick={() => setFilter("quarter")}>12-week{qCount ? ` (${qCount})` : ""}</button>
            <button className="cw-x" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="cw-body">
          {items.length > 0 && (
            <div className="jr-bar">
              <span className="jr-bar-note">Every closed week &amp; 12-week cycle, logged. Export to carry it into Obsidian or your own memory later.</span>
              <CopyBtn getText={exportAll} label="Export all" />
            </div>
          )}

          {items.length === 0 && (
            <div className="jr-empty">
              <p className="jr-empty-lead">Your journal is empty — for now.</p>
              <p className="jr-empty-sub">Close out a week or finish a 12-week cycle and each one lands here as a dated entry: what you finished, what you reflected on, and how your goals landed.</p>
            </div>
          )}

          {items.map((it, i) => it.kind === "week" ? (
            <WeekEntry key={"w" + i} h={it.data} />
          ) : (
            <QuarterEntry key={"q" + i} h={it.data} />
          ))}
        </div>
      </div>
    </div>
  );
}

function WeekEntry({ h }) {
  return (
    <div className="jr-entry">
      <div className="jr-entry-head">
        <span className="jr-kind jr-kind-week">Week {h.n}</span>
        <span className="jr-range">{h.range}</span>
        <span className="jr-when">{fmtClosed(h.savedAt)}</span>
        <span className="jr-tally">{h.completed.length} done</span>
      </div>
      {h.journal && <p className="jr-journal">{h.journal}</p>}
      {h.completed.length > 0 && (
        <div className="jr-list">
          {window.bundleCompleted(h.completed).map((c, j) => (
            <div className="jr-item" key={j}><span className="cw-dot" style={{ background: c.accent }} />{c.text}{c.subCount ? <span className="cw-win-parent"> · {c.subCount} subtask{c.subCount > 1 ? "s" : ""}</span> : null}<span className="jr-item-proj">{c.project}</span></div>
          ))}
        </div>
      )}
      <div className="jr-entry-foot"><CopyBtn getText={() => weekToMd(h)} /></div>
    </div>
  );
}

function QuarterEntry({ h }) {
  const hit = h.goals.filter(g => g.done).length;
  return (
    <div className="jr-entry jr-entry-q">
      <div className="jr-entry-head">
        <span className="jr-kind jr-kind-q">{h.label} · 12 weeks</span>
        <span className="jr-range">{h.range}</span>
        <span className="jr-when">{fmtClosed(h.closedAt)}</span>
        <span className="jr-tally">{hit}/{h.goals.length} hit</span>
      </div>
      {h.journal && <p className="jr-journal">{h.journal}</p>}
      {h.goals && h.goals.length > 0 && (
        <div className="jr-goals">
          {h.goals.map((g, j) => (
            <div className="jr-goal-line" key={j}><span className={"jr-goal-mark " + (g.done ? "hit" : "miss")}>{g.done ? "✓" : "○"}</span>{g.text}</div>
          ))}
        </div>
      )}
      <div className="jr-entry-foot"><CopyBtn getText={() => quarterToMd(h)} /></div>
    </div>
  );
}

window.Journal = Journal;
