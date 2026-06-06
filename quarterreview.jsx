// ============================================================
// quarterreview.jsx — recap the quarter's 12-week goals, set the next
// ============================================================
const Q_NEXT = { Q1: ["Q2", "Apr 1 – Jun 30"], Q2: ["Q3", "Jul 1 – Sep 30"], Q3: ["Q4", "Oct 1 – Dec 31"], Q4: ["Q1", "Jan 1 – Mar 31"] };

function QuarterReview({ onClose }) {
  const { state, dispatch } = window.useFocusStore();
  const q = state.quarter;
  const [hits, setHits] = React.useState(q.goals.map(() => null)); // true=hit, false=missed, null=unset
  const suggest = Q_NEXT[q.label] || ["Next", ""];
  const [label, setLabel] = React.useState(suggest[0]);
  const [range, setRange] = React.useState(suggest[1]);
  const [goals, setGoals] = React.useState(["", "", ""]);
  const [reflection, setReflection] = React.useState("");
  const hist = state.quarterHistory || [];

  function setGoal(i, v) {setGoals((g) => {const n = g.slice();n[i] = v;return n;});}

  function finish() {
    const archive = {
      label: q.label, range: q.range,
      goals: q.goals.map((text, i) => ({ text, done: hits[i] === true })),
      journal: reflection.trim(),
      closedAt: Date.now()
    };
    const next = { label: label.trim() || "Next", range: range.trim(), goals: goals.map((g) => g.trim()).filter(Boolean) };
    if (next.goals.length === 0) next.goals = ["", "", ""];
    dispatch({ type: "ROLL_QUARTER", archive, next });
    onClose();
  }

  const hitCount = hits.filter((h) => h === true).length;

  return (
    <div className="overlay" onMouseDown={(e) => {if (e.target === e.currentTarget) onClose();}}>
      <div className="cw qr">
        <div className="cw-head">
          <div>
            <div className="eyebrow">New 12-week cycle</div>
            <h2 className="cw-title">Close out {q.label} · {q.range}</h2>
          </div>
          <button className="cw-x ttool" onClick={onClose}>×</button>
        </div>

        <div className="cw-body">
          {/* recap */}
          <div className="cw-section-label"><span className="eyebrow">How did the {q.label} goals land?</span><span className="cw-tally">{hitCount}/{q.goals.length}</span></div>
          <div className="qr-recap">
            {q.goals.map((g, i) =>
            <div className={"qr-goal" + (hits[i] === true ? " hit" : hits[i] === false ? " miss" : "")} key={i}>
                <span className="qr-goal-text">{g}</span>
                <div className="qr-mark">
                  <button className={"qr-btn hit" + (hits[i] === true ? " on" : "")} onClick={() => setHits((h) => {const n = h.slice();n[i] = true;return n;})}>Hit</button>
                  <button className={"qr-btn miss" + (hits[i] === false ? " on" : "")} onClick={() => setHits((h) => {const n = h.slice();n[i] = false;return n;})}>Missed</button>
                </div>
              </div>
            )}
          </div>

          {/* reflection journal — logged with this 12-week cycle */}
          <div className="cw-journal qr-reflect">
            <div className="cw-section-label"><span className="eyebrow">Reflect on the 12 weeks</span><span className="cw-esp">a journal entry for this cycle</span></div>
            <p className="qr-reflect-hint">Talk it through, like you would out loud — what went well, what didn’t, what you learned, and what matters most heading into {label.trim() || "the next cycle"}.</p>
            <textarea className="cw-textarea" value={reflection} onChange={(e) => setReflection(e.target.value)}
              placeholder="This quarter I… what went well, what I’d do differently, what I’m proud of, and where my focus goes next." />
          </div>

          {/* next quarter */}
          <div className="qr-next">
            <div className="cw-section-label"><span className="eyebrow">Set the next 12 weeks</span></div>
            <div className="qr-meta">
              <input className="qr-input qr-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Q3" />
              <input className="qr-input qr-range" value={range} onChange={(e) => setRange(e.target.value)} placeholder="Jul 1 – Sep 30" />
            </div>
            {goals.map((g, i) =>
            <div className="qr-goal-input" key={i}>
                <span className="qr-num">{i + 1}</span>
                <input className="qr-input" value={g} onChange={(e) => setGoal(i, e.target.value)} placeholder={["Big goal one…", "Big goal two…", "Big goal three…"][i]} />
              </div>
            )}
          </div>

          {hist.length > 0 &&
          <div className="qr-history">
              <div className="cw-section-label"><span className="eyebrow">Past quarters</span></div>
              {hist.map((h, i) =>
            <div className="qr-past" key={i}>
                  <div className="qr-past-head"><span className="qr-past-label">{h.label}</span><span className="qr-past-range">{h.range}</span><span className="qr-past-tally">{h.goals.filter((g) => g.done).length}/{h.goals.length} hit</span></div>
                  {h.journal && <p className="qr-past-journal">{h.journal}</p>}
                  <div className="qr-past-goals">
                    {h.goals.map((g, j) => <div className="qr-past-goal" key={j}><span className={"qr-past-mark " + (g.done ? "hit" : "miss")}>{g.done ? "✓" : "○"}</span>{g.text}</div>)}
                  </div>
                </div>
            )}
            </div>
          }

          <div className="cw-actions">
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={finish}>Start {label.trim() || "next quarter"} →</button>
          </div>
        </div>
      </div>
    </div>);

}
window.QuarterReview = QuarterReview;