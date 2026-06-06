// ============================================================
// composer.jsx — conversational capture (Claude). Shared helper +
// the always-on capture bar. The Close-Week planner reuses focusAI().
// ============================================================
async function focusAI({ input, state, dispatch, planning }) {
  const projectList = state.projects.map(p => `- ${p.name} (id: ${p.id})`).join("\n");
  const planNote = planning
    ? `\nThis is WEEKLY PLANNING. The user is setting up the upcoming week. You may also:
- set a task as one of the three weekly priorities with "big": 1, 2, or 3 (only three exist; assign thoughtfully).
- mark a recurring task as a habit with "habit": true (it gets a daily check-off tracker).`
    : "";
  const sys = `You convert a person's natural language into structured actions for their weekly planner.
Existing projects:
${projectList}

Return ONLY valid JSON, no prose, shaped exactly:
{"actions":[ ... ],"reply":"one short friendly sentence"}

Action kinds:
- {"kind":"add_task","project":"<existing project name or id>","text":"...","note":"optional","queue":false,"subtasks":["optional step"],"big":null,"habit":false}
- {"kind":"add_project","name":"...","tasks":[{"text":"...","note":"optional","queue":false}]}

Rules:
- Match projects loosely by name (e.g. "motion" -> Motion). If a project clearly doesn't exist, create it with add_project.
- "queue" / "later" / "someday" => queue:true. Otherwise queue:false (active this week).
- Nested or "sub" items become subtasks. Recurring "every day / X a day / routine" tasks => habit:true.
- Keep task text concise. Don't invent tasks the user didn't mention.${planNote}

User: """${input}"""`;
  const raw = await window.claude.complete({ messages: [{ role: "user", content: sys }] });
  const json = JSON.parse(raw.replace(/```json|```/g, "").trim());
  if (json.actions && json.actions.length) {
    dispatch({ type: "APPLY_AI", actions: json.actions });
    return { ok: true, count: json.actions.length, reply: json.reply || `Added ${json.actions.length} item${json.actions.length > 1 ? "s" : ""}.` };
  }
  return { ok: false };
}
window.focusAI = focusAI;

function Composer() {
  const { state, dispatch } = window.useFocusStore();
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [reply, setReply] = React.useState(null);
  const [err, setErr] = React.useState(null);

  async function run() {
    const input = text.trim();
    if (!input || busy) return;
    setBusy(true); setReply(null); setErr(null);
    try {
      const r = await window.focusAI({ input, state, dispatch });
      if (r.ok) { setReply(r.reply); setText(""); }
      else setErr("I couldn't find anything to add — try naming a project and a task.");
    } catch (e) {
      setErr("Hmm, that didn't parse. Try: \"add re-grout the bath and call the plumber to Airbnb\".");
    } finally { setBusy(false); }
  }

  return (
    <div className="composer">
      <div className="composer-bar">
        <span className="composer-spark">✦</span>
        <textarea className="composer-input" value={text} rows={1}
          placeholder="Tell me what to add — e.g. “add re-shoot photos and order linens to Airbnb; new project Garden with build raised beds”"
          onChange={(e) => { setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); } }} />
        <button className="composer-go" disabled={busy || !text.trim()} onClick={run}>
          {busy ? <span className="spin" /> : "Add"}
        </button>
      </div>
      {(reply || err) && <div className={"composer-msg" + (err ? " err" : "")}>{err || reply}</div>}
    </div>
  );
}
window.Composer = Composer;
