// ============================================================
// store.jsx — state model, reducer, persistence, seed
// Exposes: window.useFocusStore() -> { state, dispatch, actions helpers }
// ============================================================
const { useState, useEffect, useRef, useCallback, createContext, useContext } = React;

const STORE_KEY = "focus.store.v1";
const uid = () => Math.random().toString(36).slice(2, 9);

// ---- accent palette (project colors) ----
window.ACCENTS = [
  { key: "clay",  val: "oklch(0.605 0.108 42)" },
  { key: "denim", val: "oklch(0.555 0.078 248)" },
  { key: "sage",  val: "oklch(0.575 0.066 142)" },
  { key: "plum",  val: "oklch(0.520 0.090 330)" },
  { key: "teal",  val: "oklch(0.560 0.070 195)" },
  { key: "gold",  val: "oklch(0.640 0.100 75)" },
];

// ---- week helpers ----
function fmtRange(startISO) {
  const start = new Date(startISO + "T00:00:00");
  const end = new Date(start); end.setDate(end.getDate() + 6);
  const mo = (d) => d.toLocaleDateString("en-US", { month: "short" });
  const sameMonth = start.getMonth() === end.getMonth();
  return sameMonth
    ? `${mo(start)} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`
    : `${mo(start)} ${start.getDate()} – ${mo(end)} ${end.getDate()}, ${end.getFullYear()}`;
}
function addDaysISO(iso, n) {
  const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---- quarter end-date helpers ----
// Quarter ranges are stored as plain text like "Apr 1 – Jun 30" (no year).
// We pull the year from the active week so the end date tracks the real timeline.
const MONTHS3 = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
function quarterEndDate(state) {
  const range = state.quarter && state.quarter.range;
  if (!range) return null;
  const parts = range.split(/[–—-]/);
  if (parts.length < 2) return null;
  const m = parts[parts.length - 1].trim().match(/([A-Za-z]{3,})\s*(\d{1,2})/);
  if (!m) return null;
  const mo = MONTHS3[m[1].slice(0, 3).toLowerCase()];
  if (mo == null) return null;
  const year = parseInt((state.week && state.week.startISO || "").slice(0, 4), 10) || new Date().getFullYear();
  return new Date(year, mo, parseInt(m[2], 10));
}
// true on the quarter's end date or any day after it — stays true until ROLL_QUARTER
// sets a new (future) range. Lets the recap button nag the user to close the cycle.
function quarterIsDue(state, now = new Date()) {
  const end = quarterEndDate(state);
  if (!end) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return today >= end;
}

// ---- seed (from the user's Notion "Focus" doc) ----
function seed() {
  const startISO = "2026-05-25";
  const mk = (text, o = {}) => ({ id: uid(), text, status: o.status || "todo", note: o.note || "", big: o.big || null, lane: o.lane || "active", subtasks: o.subtasks || [], type: o.type || "todo", days: o.days || [false, false, false, false, false, false, false], target: o.target || 5, recurring: o.recurring != null ? o.recurring : (o.type === "habit") });
  return {
    version: 1,
    week: { n: 22, startISO },
    quarterCollapsed: false,
    affirmations: [
      "I own a 20-unit agritourism micro-hotel and wedding venue that promotes regenerative agriculture.",
      "I am in the best shape of my life — mentally, physically, emotionally — because I stick to my habits and AM/PM routines and put the important first.",
      "I notice all the incredible things that are constantly happening for me.",
    ],
    quarter: { label: "Q2", range: "Apr 1 – Jun 30", goals: [
      "Airbnb $10k+ / mo",
      "Motion 5%+ MoM growth",
      "$200K capital + land/farm identified",
    ]},
    quarterHistory: [],
    projects: [
      { id: "airbnb", name: "Airbnb", accent: "oklch(0.605 0.108 42)", queueOpen: false, tasks: [
        mk("List on VRBO, Booking.com & direct site", { big: 1 }),
        mk("Set up new cleaner for Sunday", { status: "doing", note: "Trying Daiza" }),
        mk("Hire landscaper", { status: "done", note: "Check on Richard in 2 wks" }),
        mk("Re-shoot hero photos", { lane: "queue" }),
        mk("Order replacement linens", { lane: "queue" }),
      ]},
      { id: "motion", name: "Motion", accent: "oklch(0.555 0.078 248)", queueOpen: false, tasks: [
        mk("Create team-meeting outline by Thursday", { big: 2 }),
        mk("Arketa — 1 hr/day", { status: "doing", note: "Tue · Wed · Thu blocks", type: "habit", days: [false, true, true, true, false, false, false], target: 5 }),
        mk("Set the team schedule", { status: "done" }),
        mk("Q3 roadmap draft", { lane: "queue" }),
      ]},
      { id: "self", name: "Self", accent: "oklch(0.575 0.066 142)", queueOpen: false, tasks: [
        mk("Hold AM/PM routine all 7 days", { big: 3, type: "habit", days: [true, true, true, false, false, false, false], target: 7 }),
        mk("Blood Cancer United follow-up", {}),
        mk("File claim against insurance", { status: "done", note: "Need crash report" }),
        mk("Reply to Diego", { lane: "queue" }),
        mk("Harada method — pg 26", { lane: "queue" }),
      ]},
    ],
    history: [],
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (e) {}
  return seed();
}

// backfill fields added in later versions so older saved state never crashes
function migrate(s) {
  if (!s || !s.projects) return seed();
  if (!s.quarterHistory) s.quarterHistory = [];
  s.projects.forEach(p => (p.tasks || []).forEach(t => {
    if (!t.type) t.type = "todo";
    if (!Array.isArray(t.days)) t.days = [false, false, false, false, false, false, false];
    if (!t.target) t.target = 5;
    if (!Array.isArray(t.subtasks)) t.subtasks = [];
    if (t.recurring === undefined) t.recurring = t.type === "habit";
  }));
  return s;
}

// ============================================================
// reducer
// ============================================================
function findTask(state, taskId) {
  for (const p of state.projects)
    for (const t of p.tasks)
      if (t.id === taskId) return { project: p, task: t };
  return {};
}

function reducer(state, action) {
  const A = action;
  switch (A.type) {
    case "RESET_ALL": return seed();
    case "HYDRATE": return A.state;

    case "TOGGLE_QUARTER":
      return { ...state, quarterCollapsed: !state.quarterCollapsed };

    case "EDIT_AFFIRMATION": {
      const aff = state.affirmations.slice(); aff[A.i] = A.text;
      return { ...state, affirmations: aff };
    }
    case "EDIT_QUARTER_GOAL": {
      const g = state.quarter.goals.slice(); g[A.i] = A.text;
      return { ...state, quarter: { ...state.quarter, goals: g } };
    }

    // ---- tasks ----
    case "CYCLE_STATUS": {
      const next = { todo: "doing", doing: "done", done: "todo" };
      return mapTask(state, A.taskId, (t) => ({ ...t, status: next[t.status] }));
    }
    case "TOGGLE_HABIT_DAY":
      return mapTask(state, A.taskId, (t) => {
        const days = t.days.slice(); days[A.day] = !days[A.day];
        const hit = days.filter(Boolean).length;
        const status = hit >= (t.target || 5) ? "done" : hit > 0 ? "doing" : "todo";
        return { ...t, days, status };
      });
    case "SET_HABIT_TARGET":
      return mapTask(state, A.taskId, (t) => {
        const target = Math.max(1, Math.min(7, A.target));
        const hit = (t.days || []).filter(Boolean).length;
        const status = hit >= target ? "done" : hit > 0 ? "doing" : "todo";
        return { ...t, target, status };
      });
    case "SET_TASK_TYPE":
      return mapTask(state, A.taskId, (t) => A.kind === "habit"
        ? { ...t, type: "habit", days: t.days || [false,false,false,false,false,false,false], target: t.target || 5, status: "todo", recurring: true }
        : { ...t, type: "todo", status: "todo" });
    case "TOGGLE_RECURRING":
      return mapTask(state, A.taskId, (t) => ({ ...t, recurring: !t.recurring }));
    case "SET_STATUS":
      return mapTask(state, A.taskId, (t) => ({ ...t, status: A.status }));
    case "EDIT_TASK_TEXT":
      return mapTask(state, A.taskId, (t) => ({ ...t, text: A.text }));
    case "EDIT_TASK_NOTE":
      return mapTask(state, A.taskId, (t) => ({ ...t, note: A.note }));

    case "SET_BIG": {
      // assign this task to big slot A.n; clear any other task holding it
      let s = state;
      s = { ...s, projects: s.projects.map(p => ({ ...p, tasks: p.tasks.map(t =>
        t.big === A.n ? { ...t, big: null } : t) })) };
      s = mapTaskIn(s, A.taskId, (t) => ({ ...t, big: A.n, lane: "active" }));
      return s;
    }
    case "CLEAR_BIG":
      return mapTask(state, A.taskId, (t) => ({ ...t, big: null }));
    case "PROMOTE_NEXT": {
      // assign lowest free big slot to this task
      const used = new Set();
      state.projects.forEach(p => p.tasks.forEach(t => t.big && used.add(t.big)));
      let n = [1, 2, 3].find(x => !used.has(x));
      if (!n) return state; // all full
      return mapTaskIn(mapClearBig(state, A.taskId), A.taskId, (t) => ({ ...t, big: n, lane: "active" }));
    }
    case "REORDER_BIG": {
      // A.order is array of taskIds in desired big-order
      let s = state;
      A.order.forEach((tid, i) => { s = mapTaskIn(s, tid, (t) => ({ ...t, big: i + 1 })); });
      return s;
    }

    case "ADD_TASK": {
      const t = { id: A.id || uid(), text: A.text, status: "todo", note: A.note || "", big: null, lane: A.lane || "active", subtasks: A.subtasks || [], type: A.taskType || "todo", days: [false,false,false,false,false,false,false], target: 5, recurring: A.taskType === "habit" };
      return { ...state, projects: state.projects.map(p =>
        p.id === A.projectId ? { ...p, tasks: A.toTop ? [t, ...p.tasks] : [...p.tasks, t] } : p) };
    }
    case "DELETE_TASK":
      return { ...state, projects: state.projects.map(p => ({ ...p, tasks: p.tasks.filter(t => t.id !== A.taskId) })) };

    case "MOVE_TASK": {
      // move task to {toProject, toLane, toIndex} computed against the target lane's filtered list
      const { task } = findTask(state, A.taskId);
      if (!task) return state;
      const moved = { ...task, lane: A.toLane, big: A.toLane === "queue" ? null : task.big };
      // remove from all
      let projects = state.projects.map(p => ({ ...p, tasks: p.tasks.filter(t => t.id !== A.taskId) }));
      projects = projects.map(p => {
        if (p.id !== A.toProject) return p;
        // rebuild: keep other-lane tasks in place, splice moved into the target lane at toIndex
        const sameLane = p.tasks.filter(t => t.lane === A.toLane);
        const otherLane = p.tasks.filter(t => t.lane !== A.toLane);
        const idx = Math.max(0, Math.min(A.toIndex == null ? sameLane.length : A.toIndex, sameLane.length));
        sameLane.splice(idx, 0, moved);
        return { ...p, tasks: [...sameLane, ...otherLane] };
      });
      return { ...state, projects };
    }

    // ---- subtasks ----
    case "ADD_SUB":
      return mapTask(state, A.taskId, (t) => ({ ...t, subtasks: [...t.subtasks, { id: uid(), text: A.text, done: false }] }));
    case "TOGGLE_SUB":
      return mapTask(state, A.taskId, (t) => ({ ...t, subtasks: t.subtasks.map(s => s.id === A.subId ? { ...s, done: !s.done } : s) }));
    case "EDIT_SUB":
      return mapTask(state, A.taskId, (t) => ({ ...t, subtasks: t.subtasks.map(s => s.id === A.subId ? { ...s, text: A.text } : s) }));
    case "DEL_SUB":
      return mapTask(state, A.taskId, (t) => ({ ...t, subtasks: t.subtasks.filter(s => s.id !== A.subId) }));
    case "MOVE_SUB":
      // reorder a subtask within its parent task to A.toIndex
      return mapTask(state, A.taskId, (t) => {
        const from = t.subtasks.findIndex(s => s.id === A.subId);
        if (from < 0) return t;
        const subs = t.subtasks.slice();
        const [moved] = subs.splice(from, 1);
        const idx = Math.max(0, Math.min(A.toIndex, subs.length));
        subs.splice(idx, 0, moved);
        return { ...t, subtasks: subs };
      });

    // ---- projects ----
    case "TOGGLE_QUEUE":
      return { ...state, projects: state.projects.map(p => p.id === A.projectId ? { ...p, queueOpen: !p.queueOpen } : p) };
    case "ADD_PROJECT": {
      const used = state.projects.map(p => p.accent);
      const accent = A.accent || (window.ACCENTS.find(a => !used.includes(a.val)) || window.ACCENTS[state.projects.length % window.ACCENTS.length]).val;
      const tasks = (A.tasks || []).map(t => ({ id: uid(), text: t.text || String(t), status: "todo", note: t.note || "", big: null, lane: t.lane || "active", subtasks: t.subtasks || [] }));
      return { ...state, projects: [...state.projects, { id: uid(), name: A.name || "New Project", accent, queueOpen: false, tasks }] };
    }
    case "RENAME_PROJECT":
      return { ...state, projects: state.projects.map(p => p.id === A.projectId ? { ...p, name: A.name } : p) };
    case "SET_ACCENT":
      return { ...state, projects: state.projects.map(p => p.id === A.projectId ? { ...p, accent: A.accent } : p) };
    case "DELETE_PROJECT":
      return { ...state, projects: state.projects.filter(p => p.id !== A.projectId) };
    case "REORDER_PROJECTS": {
      const byId = Object.fromEntries(state.projects.map(p => [p.id, p]));
      return { ...state, projects: A.order.map(id => byId[id]).filter(Boolean) };
    }

    // ---- close the week ----
    case "CLOSE_WEEK": {
      const completed = [];
      state.projects.forEach(p => p.tasks.forEach(t => {
        if (t.status === "done") {
          const habitInfo = t.type === "habit" ? ` (${t.days.filter(Boolean).length}/7 days)` : "";
          completed.push({ project: p.name, accent: p.accent, text: t.text + habitInfo });
        } else if (Array.isArray(t.subtasks)) {
          t.subtasks.forEach(s => {
            if (s.done) completed.push({ project: p.name, accent: p.accent, text: s.text, parent: t.text });
          });
        }
      }));
      const entry = { n: state.week.n, range: fmtRange(state.week.startISO), completed, journal: A.journal || "", savedAt: Date.now() };
      // Carry-forward rules for the new week:
      //  • recurring habit → keep it, reset day-marks + status
      //  • recurring to-do → keep it, full fresh reset (status→todo, all steps unchecked)
      //  • non-recurring   → behave like a one-off: drop it if done, otherwise carry it
      //                      over (a habit with recurring off keeps its marks; a to-do
      //                      drops any steps already checked off)
      const reset7 = [false,false,false,false,false,false,false];
      const projects = state.projects.map(p => ({ ...p, tasks: p.tasks
        .filter(t => t.recurring || t.status !== "done")
        .map(t => {
          if (t.type === "habit") return t.recurring ? { ...t, days: reset7, status: "todo" } : t;
          if (t.recurring) return { ...t, status: "todo", subtasks: Array.isArray(t.subtasks) ? t.subtasks.map(s => ({ ...s, done: false })) : t.subtasks };
          return { ...t, subtasks: Array.isArray(t.subtasks) ? t.subtasks.filter(s => !s.done) : t.subtasks };
        })
      }));
      return { ...state, history: [entry, ...state.history], projects, week: { n: state.week.n + 1, startISO: addDaysISO(state.week.startISO, 7) } };
    }

    // ---- quarter rollover ----
    case "ROLL_QUARTER":
      return {
        ...state,
        quarterHistory: [A.archive, ...(state.quarterHistory || [])],
        quarter: A.next,
        quarterCollapsed: false,
      };

    case "APPLY_AI": {
      let s = state;
      for (const act of A.actions) {
        if (act.kind === "add_project") {
          s = reducer(s, { type: "ADD_PROJECT", name: act.name, tasks: act.tasks });
        } else if (act.kind === "add_task") {
          const proj = resolveProject(s, act.project);
          if (proj) {
            const newId = uid();
            s = reducer(s, { type: "ADD_TASK", id: newId, projectId: proj.id, text: act.text, note: act.note, lane: act.queue ? "queue" : "active", taskType: act.habit ? "habit" : "todo", subtasks: (act.subtasks || []).map(x => ({ id: uid(), text: x, done: false })) });
            if (act.big && act.big >= 1 && act.big <= 3) s = reducer(s, { type: "SET_BIG", taskId: newId, n: act.big });
          }
        }
      }
      return s;
    }

    default: return state;
  }
}

// helpers that return new state with one task transformed
function mapTask(state, taskId, fn) {
  return { ...state, projects: state.projects.map(p => ({ ...p, tasks: p.tasks.map(t => t.id === taskId ? fn(t) : t) })) };
}
const mapTaskIn = mapTask;
function mapClearBig(state, taskId) { return mapTask(state, taskId, t => t); }

function resolveProject(state, ref) {
  if (!ref) return state.projects[0];
  const r = String(ref).toLowerCase().trim();
  return state.projects.find(p => p.id.toLowerCase() === r)
      || state.projects.find(p => p.name.toLowerCase() === r)
      || state.projects.find(p => p.name.toLowerCase().includes(r) || r.includes(p.name.toLowerCase()));
}

// ============================================================
// hook + context
// ============================================================
const FocusCtx = createContext(null);

function useReducerStore(userId) {
  const [state, setState] = useState(load);
  const dispatch = useCallback((action) => setState(s => reducer(s, action)), []);

  // local cache — always on, gives instant paint and offline buffer
  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }, [state]);

  // ---- remote sync (only when authed) ----
  // Pull on auth-ready and on tab refocus. First-load migration: if the
  // server row is empty and localStorage has something, push the local copy
  // up so we don't lose anything when sync turns on for the first time.
  const hydrated = useRef(false);
  useEffect(() => {
    if (!userId || !window.supaPull) return;
    hydrated.current = false;
    let alive = true;
    async function pull() {
      try {
        const row = await window.supaPull(userId);
        if (!alive) return;
        if (row && row.data) {
          setState(migrate(row.data));
        } else {
          // empty server row — seed it with whatever we have locally
          try { await window.supaPush(userId, state); } catch (e) {}
        }
      } catch (e) {
        // network/auth error: keep showing local cache, don't blow up
        console.warn("[sync] pull failed:", e.message || e);
      } finally {
        hydrated.current = true;
      }
    }
    pull();
    const onFocus = () => { if (document.visibilityState === "visible") pull(); };
    window.addEventListener("visibilitychange", onFocus);
    return () => { alive = false; window.removeEventListener("visibilitychange", onFocus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Debounced push on every state change. We skip the first burst until
  // the initial pull completes — otherwise we'd race-clobber the server row
  // with the unhydrated local state.
  const saveTimer = useRef(null);
  useEffect(() => {
    if (!userId || !window.supaPush) return;
    if (!hydrated.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      window.supaPush(userId, state).catch(e => console.warn("[sync] push failed:", e.message || e));
    }, 800);
    return () => clearTimeout(saveTimer.current);
  }, [state, userId]);

  return { state, dispatch };
}

function FocusProvider({ children, userId }) {
  const store = useReducerStore(userId);
  return <FocusCtx.Provider value={store}>{children}</FocusCtx.Provider>;
}
function useFocusStore() { return useContext(FocusCtx); }

// derived selectors
function selBigThree(state) {
  const out = [null, null, null];
  state.projects.forEach(p => p.tasks.forEach(t => { if (t.big >= 1 && t.big <= 3) out[t.big - 1] = { ...t, projectId: p.id, projectName: p.name, accent: p.accent }; }));
  return out;
}
function selActive(p) {
  const a = p.tasks.filter(t => t.lane === "active");
  return a.slice().sort((x, y) => (x.big || 99) - (y.big || 99));
}
function selQueue(p) { return p.tasks.filter(t => t.lane === "queue"); }
function selProgress(state) {
  let done = 0, total = 0;
  state.projects.forEach(p => p.tasks.filter(t => t.lane === "active").forEach(t => { total++; if (t.status === "done") done++; }));
  return { done, total };
}

Object.assign(window, { FocusProvider, useFocusStore, fmtRange, selBigThree, selActive, selQueue, selProgress, uid, quarterIsDue, quarterEndDate });
