// ============================================================
// northstar.jsx — inked tile: 3 affirmations + quarter goals
// ============================================================
function NorthStar() {
  const { state, dispatch } = window.useFocusStore();
  const collapsed = state.quarterCollapsed;
  const due = window.quarterIsDue(state);
  return (
    <div className="ns-tile">
      <div className="ns-head">
        <span className="eyebrow ns-eyebrow">North Star</span>
        <span className="ns-sub">I am becoming</span>
      </div>

      <div className="ns-affs">
        {state.affirmations.map((a, i) =>
        <div className="ns-aff" key={i}>
            <span className="ns-aff-mark">{romional(i)}</span>
            <window.InlineText
            value={a}
            onCommit={(t) => dispatch({ type: "EDIT_AFFIRMATION", i, text: t })}
            className="ns-aff-text" multiline serif
            placeholder="Write an affirmation…" />
          </div>
        )}
      </div>

      <div className="ns-quarter">
        <div className="ns-q-row">
          <button className="ns-q-head" onClick={() => dispatch({ type: "TOGGLE_QUARTER" })}>
            <span className="eyebrow ns-q-eyebrow">{state.quarter.label} Goals · {state.quarter.range}</span>
            <span className={"ns-chev" + (collapsed ? " closed" : "")}>⌄</span>
          </button>
          <button className={"ns-q-new" + (due ? " due" : "")} title={due ? `${state.quarter.label} is complete — recap it & set your next 12 weeks` : "Recap this quarter & set new 12-week goals"} onClick={() => window.__openQuarterReview && window.__openQuarterReview()}>↻</button>
        </div>
        {!collapsed &&
        <div className="ns-goals">
            {state.quarter.goals.map((g, i) =>
          <div className="ns-goal" key={i}>
                <span className="ns-goal-dot" />
                <window.InlineText value={g} onCommit={(t) => dispatch({ type: "EDIT_QUARTER_GOAL", i, text: t })} className="ns-goal-text" placeholder="Goal…" />
              </div>
          )}
          </div>
        }
      </div>
    </div>);

}
function romional(i) {return ["I.", "II.", "III."][i] || i + 1 + ".";}
window.NorthStar = NorthStar;