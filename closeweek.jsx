// ============================================================
// closeweek.jsx — end-of-week recap + big-wins journal, saved per week
// + history viewer
// ============================================================
function CloseWeek({ onClose }) {
  const { state, dispatch } = window.useFocusStore();
  const [journal, setJournal] = React.useState("");
  const [view, setView] = React.useState("recap"); // recap | history
  const [plan, setPlan] = React.useState("");
  const [planBusy, setPlanBusy] = React.useState(false);
  const [planMsg, setPlanMsg] = React.useState(null);
  const [planErr, setPlanErr] = React.useState(false);

  const completed = [];
  state.projects.forEach(p => p.tasks.forEach(t => {
    if (t.status === "done") {
      completed.push({ project: p.name, accent: p.accent, text: t.text + (t.type === "habit" ? ` (${t.days.filter(Boolean).length}/7 days)` : "") });
    } else if (Array.isArray(t.subtasks)) {
      t.subtasks.forEach(s => { if (s.done) completed.push({ project: p.name, accent: p.accent, text: s.text, parent: t.text }); });
    }
  }));
  const carry = [];
  state.projects.forEach(p => p.tasks.forEach(t => { if (t.lane === "active" && t.type !== "habit" && t.status !== "done") carry.push(t); }));

  async function runPlan() {
    const input = plan.trim();
    if (!input || planBusy) return;
    setPlanBusy(true); setPlanMsg(null); setPlanErr(false);
    try {
      const r = await window.focusAI({ input, state, dispatch, planning: true });
      if (r.ok) { setPlanMsg(r.reply); setPlan(""); }
      else { setPlanErr(true); setPlanMsg("Tell me the projects and what you want on each."); }
    } catch (e) { setPlanErr(true); setPlanMsg("That didn't parse — try naming a project and a task or two."); }
    finally { setPlanBusy(false); }
  }

  function finish() {
    dispatch({ type: "CLOSE_WEEK", journal });
    onClose();
  }

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cw">
        <div className="cw-head">
          <div>
            <div className="eyebrow">{view === "recap" ? "Closing out" : "Past weeks"}</div>
            <h2 className="cw-title">{view === "recap" ? `Week ${state.week.n} — ${window.fmtRange(state.week.startISO)}` : "Your weekly log"}</h2>
          </div>
          <div className="cw-tabs">
            <button className={view === "recap" ? "on" : ""} onClick={() => setView("recap")}>This week</button>
            <button className={view === "history" ? "on" : ""} onClick={() => setView("history")}>History {state.history.length ? `(${state.history.length})` : ""}</button>
            <button className="cw-x" onClick={onClose}>×</button>
          </div>
        </div>

        {view === "recap" ? (
          <div className="cw-body">
            <div className="cw-wins">
              <div className="cw-section-label"><span className="eyebrow">Completed this week</span><span className="cw-tally">{completed.length}</span></div>
              {completed.length === 0 && <p className="cw-none">Nothing checked off yet — that's okay.</p>}
              <div className="cw-list">
                {window.bundleCompleted(completed).map((c, i) => (
                  <div className="cw-win" key={i}>
                    <span className="cw-check">✓</span>
                    <span className="cw-win-text">{c.text}{c.subCount ? <span className="cw-win-parent"> · {c.subCount} subtask{c.subCount > 1 ? "s" : ""}</span> : null}</span>
                    <span className="cw-win-proj" style={{ color: c.accent }}>{c.project}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="cw-journal">
              <div className="cw-section-label"><span className="eyebrow">Big Wins (ESP)</span><span className="cw-esp">effort · success · progress</span></div>
              <textarea className="cw-textarea" value={journal} onChange={(e) => setJournal(e.target.value)}
                placeholder="What effort did you put in? What were the wins? Where did you make progress? What are you proud of?" />
            </div>

            <div className="cw-plan">
              <div className="cw-section-label"><span className="eyebrow">Set up next week</span></div>
              <p className="cw-plan-hint">Just say it — “Big 3: list the Airbnb, ship Motion outline, hit my AM routine. Add re-shoot photos to Airbnb and park ‘call accountant’.” I’ll lay it out and it carries into Week {state.week.n + 1}.</p>
              <div className="cw-plan-bar">
                <span className="composer-spark">✦</span>
                <textarea className="composer-input" value={plan} rows={2}
                  placeholder="This next week I want to…"
                  onChange={(e) => setPlan(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runPlan(); } }} />
                <button className="composer-go" disabled={planBusy || !plan.trim()} onClick={runPlan}>{planBusy ? <span className="spin" /> : "Plan"}</button>
              </div>
              {planMsg && <div className={"composer-msg" + (planErr ? " err" : "")}>{planMsg}</div>}
            </div>

            {carry.length > 0 && (
              <div className="cw-carry">
                <span className="eyebrow">{carry.length} unfinished task{carry.length > 1 ? "s" : ""} will carry into Week {state.week.n + 1}</span>
              </div>
            )}

            <div className="cw-actions">
              <button className="btn-ghost" onClick={onClose}>Not yet</button>
              <button className="btn-primary" onClick={finish}>Close week & start Week {state.week.n + 1} →</button>
            </div>
          </div>
        ) : (
          <div className="cw-body">
            {state.history.length === 0 && <p className="cw-none">No weeks closed yet. Your log will build here.</p>}
            {state.history.map((h, i) => (
              <div className="cw-past" key={i}>
                <div className="cw-past-head">
                  <span className="cw-past-week">Week {h.n}</span>
                  <span className="cw-past-range">{h.range}</span>
                  <span className="cw-past-tally">{h.completed.length} done</span>
                </div>
                {h.journal && <p className="cw-past-journal">{h.journal}</p>}
                <div className="cw-past-list">
                  {window.bundleCompleted(h.completed).map((c, j) => (
                    <div className="cw-past-item" key={j}><span className="cw-dot" style={{ background: c.accent }} />{c.text}{c.subCount ? <span className="cw-win-parent"> · {c.subCount} subtask{c.subCount > 1 ? "s" : ""}</span> : null}<span className="cw-past-proj">{c.project}</span></div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
window.CloseWeek = CloseWeek;
