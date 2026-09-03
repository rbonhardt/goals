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

// ---- due-date helpers ----
// Local calendar date (toISOString would jump to tomorrow after 7-8pm ET).
const DUE_LEAD_DAYS = 10;
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysUntil(dueISO, fromISO = todayISO()) {
  const a = new Date(fromISO + "T00:00:00"), b = new Date(dueISO + "T00:00:00");
  return Math.round((b - a) / 86400000);
}
// Strict YYYY-MM-DD or null. Round-trips through Date to reject impossible
// dates ("2026-02-31" silently becomes Mar 3) — a malformed due would make
// daysUntil return NaN, and NaN > lead is false, which would auto-promote.
function cleanDue(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(v + "T00:00:00");
  if (isNaN(d)) return null;
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return iso === v ? v : null;
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

// ---- default scheduled commitments (used by seed + first migration) ----
function defaultScheduled() {
  return [
    { id: uid(), text: "Charlotte Social — weekly pricing review", note: "Sun 7:00 pm · run /pricing-review in the Arete folder", cadence: "weekly", day: 6, date: 1, doneFor: null, doneAt: null },
    { id: uid(), text: "Charlotte Social — monthly finance review", note: "1st · 9:00 am · review flagged items from the auto-close", cadence: "monthly", day: 6, date: 1, doneFor: null, doneAt: null },
  ];
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
    scheduled: defaultScheduled(),
    history: [],
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (e) {}
  return migrate(seed());
}

// backfill fields added in later versions so older saved state never crashes
function migrate(s) {
  if (!s || !s.projects) return seed();
  if (!s.quarterHistory) s.quarterHistory = [];
  // scheduled strip added later: seed the defaults only when the field has
  // never existed (an emptied list stays empty)
  if (!Array.isArray(s.scheduled)) s.scheduled = defaultScheduled();
  s.scheduled.forEach(it => {
    if (!it.cadence) it.cadence = "weekly";
    if (it.day == null) it.day = 6;
    if (!it.date) it.date = 1;
    if (it.doneFor === undefined) it.doneFor = null;
    if (it.doneAt === undefined) it.doneAt = null;
  });
  s.projects.forEach(p => (p.tasks || []).forEach(t => {
    if (!t.type) t.type = "todo";
    if (!Array.isArray(t.days)) t.days = [false, false, false, false, false, false, false];
    if (!t.target) t.target = 5;
    if (!Array.isArray(t.subtasks)) t.subtasks = [];
    if (t.recurring === undefined) t.recurring = t.type === "habit";
    t.due = cleanDue(t.due);
    if (t.duePromoted === undefined) t.duePromoted = false;
  }));
  return sinkDone(s);
}

// ============================================================
// ordering — finished work sinks
// ============================================================
// A task that gets checked off drops to the bottom of the lane it lives in,
// and a checked step drops to the bottom of its parent's list. The done pile
// stays in completion order (newest at the very bottom); everything unfinished
// keeps the order it was dragged into.

// Strictly-increasing stamp: wall-clock so the order survives a reload or a
// sync from another device, bumped by hand if two things land in the same
// millisecond so the last thing checked is always last.
let lastStamp = 0;
function nowStamp() { lastStamp = Math.max(Date.now(), lastStamp + 1); return lastStamp; }

// Pull the high-water mark up to anything already in state before we issue a
// new stamp. Without this a fresh tab (lastStamp back at 0) or a state synced
// from a device whose clock runs ahead could mint a stamp that sorts *above*
// items completed earlier, and the newest thing wouldn't land at the bottom.
function absorbStamps(state) {
  state.projects.forEach(p => (p.tasks || []).forEach(t => {
    if (t.completedAt > lastStamp) lastStamp = t.completedAt;
    if (Array.isArray(t.subtasks)) t.subtasks.forEach(s => { if (s.completedAt > lastStamp) lastStamp = s.completedAt; });
  }));
}

// Records when something was completed, and forgets it when unchecked.
// Returns the same object when nothing changed so the store doesn't churn.
function stamp(item, done) {
  if (done && !item.completedAt) return { ...item, completedAt: nowStamp() };
  if (!done && item.completedAt) return { ...item, completedAt: null };
  return item;
}

// 0 when the task is due today or already overdue, 1 otherwise. Habits have
// no due date, and a done task never counts as pressing.
function dueRank(t) {
  if (!t.due || t.type === "habit" || t.status === "done") return 1;
  const d = daysUntil(t.due);
  return Number.isFinite(d) && d <= 0 ? 0 : 1;
}
function cmpTasks(a, b) {
  const da = a.status === "done" ? 1 : 0, db = b.status === "done" ? 1 : 0;
  if (da !== db) return da - db;                                 // unfinished first
  if (da) return (a.completedAt || 0) - (b.completedAt || 0);    // done pile: oldest → newest
  const ra = dueRank(a), rb = dueRank(b);
  if (ra !== rb) return ra - rb;                                 // due today / overdue pop to the top
  if (ra === 0 && a.due !== b.due) return a.due < b.due ? -1 : 1; // most overdue first
  return (a.big || 9) - (b.big || 9);                            // then Big Three
}
function cmpSubs(a, b) {
  const da = a.done ? 1 : 0, db = b.done ? 1 : 0;
  if (da !== db) return da - db;
  return da ? (a.completedAt || 0) - (b.completedAt || 0) : 0;
}

function stableSort(list, cmp) {
  const out = list
    .map((x, i) => ({ x, i }))
    .sort((a, b) => cmp(a.x, b.x) || a.i - b.i)
    .map(o => o.x);
  // hand back the original array when nothing moved, so an action that changes
  // no order doesn't churn state (and re-trigger a sync push)
  return out.some((x, i) => x !== list[i]) ? out : list;
}

// ---- due dates: queued work surfaces on its own ----
// A queued task whose due date is DUE_LEAD_DAYS away or closer hops to the
// active lane, once. duePromoted remembers the hop, so dragging it back to the
// queue sticks — it won't bounce out again unless the due date is changed
// (SET_DUE re-arms it). Runs inside sinkDone, so it fires on load, on every
// action, and on every remote-sync hydrate.
function promoteDue(state) {
  const today = todayISO();
  let moved = false;
  const projects = state.projects.map(p => {
    const tasks = (p.tasks || []).map(t => {
      if (t.lane !== "queue" || !t.due || t.duePromoted || t.type === "habit" || t.status === "done") return t;
      const d = daysUntil(t.due, today);
      if (!Number.isFinite(d) || d > DUE_LEAD_DAYS) return t;
      moved = true;
      return { ...t, lane: "active", duePromoted: true };
    });
    return tasks.some((t, i) => t !== p.tasks[i]) ? { ...p, tasks } : p;
  });
  return moved ? { ...state, projects } : state;
}

// Applied after every action so the *stored* order always matches what's on
// screen — drag-and-drop insert indexes are computed against the rendered list,
// so the two must not drift apart.
function sinkDone(state) {
  if (!state || !Array.isArray(state.projects)) return state;
  state = promoteDue(state);
  absorbStamps(state); // must run before any stamp() below mints a new one
  let moved = false;
  const projects = state.projects.map(p => {
    const orig = p.tasks || [];
    // lanes sort independently; anything with an unknown lane is left untouched
    const active = [], queue = [], other = [];
    orig.map(t => {
      t = stamp(t, t.status === "done");
      if (!Array.isArray(t.subtasks) || !t.subtasks.length) return t;
      const subtasks = stableSort(t.subtasks.map(s => stamp(s, s.done)), cmpSubs);
      return subtasks.every((s, i) => s === t.subtasks[i]) ? t : { ...t, subtasks };
    }).forEach(t => (t.lane === "queue" ? queue : t.lane === "active" ? active : other).push(t));
    const tasks = [...stableSort(active, cmpTasks), ...stableSort(queue, cmpTasks), ...other];
    if (tasks.every((t, i) => t === orig[i])) return p;
    moved = true;
    return { ...p, tasks };
  });
  return moved ? { ...state, projects } : state;
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

// every dispatch runs through sinkDone so completed items re-settle immediately
function reducer(state, action) {
  return sinkDone(applyAction(state, action));
}

function applyAction(state, action) {
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
      // habits have no due-date UI, so a leftover due must not linger invisibly
      return mapTask(state, A.taskId, (t) => A.kind === "habit"
        ? { ...t, type: "habit", days: t.days || [false,false,false,false,false,false,false], target: t.target || 5, status: "todo", recurring: true, due: null, duePromoted: false }
        : { ...t, type: "todo", status: "todo" });
    case "TOGGLE_RECURRING":
      return mapTask(state, A.taskId, (t) => ({ ...t, recurring: !t.recurring }));
    case "SET_STATUS":
      return mapTask(state, A.taskId, (t) => ({ ...t, status: A.status }));
    case "EDIT_TASK_TEXT":
      return mapTask(state, A.taskId, (t) => ({ ...t, text: A.text }));
    case "EDIT_TASK_NOTE":
      return mapTask(state, A.taskId, (t) => ({ ...t, note: A.note }));
    case "SET_DUE":
      // a fresh date re-arms auto-promotion (duePromoted back to false)
      return mapTask(state, A.taskId, (t) => ({ ...t, due: cleanDue(A.due), duePromoted: false }));

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
      const t = { id: A.id || uid(), text: A.text, status: "todo", note: A.note || "", big: null, lane: A.lane || "active", subtasks: A.subtasks || [], type: A.taskType || "todo", days: [false,false,false,false,false,false,false], target: 5, recurring: A.taskType === "habit", due: cleanDue(A.due), duePromoted: false };
      return { ...state, projects: state.projects.map(p =>
        p.id === A.projectId ? { ...p, tasks: A.toTop ? [t, ...p.tasks] : [...p.tasks, t] } : p) };
    }
    case "DELETE_TASK":
      return { ...state, projects: state.projects.map(p => ({ ...p, tasks: p.tasks.filter(t => t.id !== A.taskId) })) };

    case "MOVE_TASK": {
      // move task to {toProject, toLane, toIndex} computed against the target lane's filtered list
      const { project: from, task } = findTask(state, A.taskId);
      // bail before the removal step below if there's nowhere to put it —
      // otherwise an unknown destination silently deletes the task
      if (!task || !state.projects.some(p => p.id === A.toProject)) return state;
      const moved = { ...task, lane: A.toLane, big: A.toLane === "queue" ? null : task.big };
      // The drop index was measured against the rendered lane, which still had
      // the dragged row in it. Sliding a row *down* inside its own lane must
      // therefore lose one, or it lands a slot further than where it was let go.
      let want = A.toIndex;
      if (want != null && from && from.id === A.toProject && task.lane === A.toLane) {
        const wasAt = from.tasks.filter(t => t.lane === A.toLane).findIndex(t => t.id === A.taskId);
        if (wasAt > -1 && wasAt < want) want -= 1;
      }
      // remove from all
      let projects = state.projects.map(p => ({ ...p, tasks: p.tasks.filter(t => t.id !== A.taskId) }));
      projects = projects.map(p => {
        if (p.id !== A.toProject) return p;
        // rebuild: keep other-lane tasks in place, splice moved into the target lane at toIndex
        const sameLane = p.tasks.filter(t => t.lane === A.toLane);
        const otherLane = p.tasks.filter(t => t.lane !== A.toLane);
        const idx = Math.max(0, Math.min(want == null ? sameLane.length : want, sameLane.length));
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
        // same off-by-one as MOVE_TASK: the index was read with the dragged
        // step still occupying a slot, so a downward move loses one
        const want = A.toIndex == null ? subs.length : A.toIndex > from ? A.toIndex - 1 : A.toIndex;
        const idx = Math.max(0, Math.min(want, subs.length));
        subs.splice(idx, 0, moved);
        return { ...t, subtasks: subs };
      });
    case "MOVE_SUB_TO_TASK": {
      // move a step out of one task and into another (any project), landing at
      // A.toIndex in the destination list (null = append)
      if (A.fromTaskId === A.toTaskId)
        return applyAction(state, { type: "MOVE_SUB", taskId: A.toTaskId, subId: A.subId, toIndex: A.toIndex });
      const { task: fromTask } = findTask(state, A.fromTaskId);
      const { task: toTask } = findTask(state, A.toTaskId);
      // bail before the removal step if either end is missing — otherwise the
      // step would be deleted with nowhere to land. Habits never render their
      // steps, so landing one there would look like data loss.
      if (!fromTask || !toTask || toTask.type === "habit") return state;
      const moved = fromTask.subtasks.find(s => s.id === A.subId);
      if (!moved) return state;
      let s = mapTask(state, A.fromTaskId, (t) => ({ ...t, subtasks: t.subtasks.filter(x => x.id !== A.subId) }));
      s = mapTask(s, A.toTaskId, (t) => {
        const subs = t.subtasks.slice();
        const idx = Math.max(0, Math.min(A.toIndex == null ? subs.length : A.toIndex, subs.length));
        subs.splice(idx, 0, moved);
        return { ...t, subtasks: subs };
      });
      return s;
    }
    case "PROMOTE_SUB_TO_TASK": {
      // pull a step out of its task and make it a task of its own, landing at
      // A.toIndex in {toProject, toLane} (null = append). A done step becomes
      // a done task so it settles the same way it did as a step.
      const { task: fromTask } = findTask(state, A.fromTaskId);
      const sub = fromTask && fromTask.subtasks.find(x => x.id === A.subId);
      // bail before removal if there is nowhere to land — otherwise the step
      // would vanish
      if (!sub || !state.projects.some(p => p.id === A.toProject)) return state;
      const t = { id: uid(), text: sub.text, status: sub.done ? "done" : "todo", note: "", big: null, lane: A.toLane, subtasks: [], type: "todo", days: [false,false,false,false,false,false,false], target: 5, recurring: false, due: null, duePromoted: false };
      const s = mapTask(state, A.fromTaskId, (x) => ({ ...x, subtasks: x.subtasks.filter(y => y.id !== A.subId) }));
      return { ...s, projects: s.projects.map(p => {
        if (p.id !== A.toProject) return p;
        // same rebuild as MOVE_TASK: splice into the target lane, keep the rest
        const sameLane = p.tasks.filter(x => x.lane === A.toLane);
        const otherLane = p.tasks.filter(x => x.lane !== A.toLane);
        const idx = Math.max(0, Math.min(A.toIndex == null ? sameLane.length : A.toIndex, sameLane.length));
        sameLane.splice(idx, 0, t);
        return { ...p, tasks: [...sameLane, ...otherLane] };
      }) };
    }

    // ---- projects ----
    case "TOGGLE_QUEUE":
      return { ...state, projects: state.projects.map(p => p.id === A.projectId ? { ...p, queueOpen: !p.queueOpen } : p) };
    case "ADD_PROJECT": {
      const used = state.projects.map(p => p.accent);
      const accent = A.accent || (window.ACCENTS.find(a => !used.includes(a.val)) || window.ACCENTS[state.projects.length % window.ACCENTS.length]).val;
      const tasks = (A.tasks || []).map(t => ({ id: uid(), text: t.text || String(t), status: "todo", note: t.note || "", big: null, lane: t.queue ? "queue" : (t.lane || "active"), subtasks: t.subtasks || [], due: cleanDue(t.due), duePromoted: false }));
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

    // ---- scheduled (recurring commitments on a weekly/monthly cadence) ----
    case "ADD_SCHEDULED":
      return { ...state, scheduled: [...(state.scheduled || []), {
        id: uid(), text: A.text, note: A.note || "",
        cadence: A.cadence === "monthly" ? "monthly" : "weekly",
        day: A.day != null ? A.day : 6,
        date: A.date != null ? Math.max(1, Math.min(31, A.date)) : 1,
        doneFor: null, doneAt: null,
      }] };
    case "TOGGLE_SCHEDULED":
      // done-state is per period: A.periodKey is the week startISO (weekly)
      // or "YYYY-MM" (monthly); a stale doneFor simply stops matching
      return { ...state, scheduled: state.scheduled.map(it => it.id !== A.id ? it
        : it.doneFor === A.periodKey ? { ...it, doneFor: null, doneAt: null }
        : { ...it, doneFor: A.periodKey, doneAt: A.todayISO }) };
    case "EDIT_SCHEDULED_TEXT":
      return { ...state, scheduled: state.scheduled.map(it => it.id === A.id ? { ...it, text: A.text } : it) };
    case "EDIT_SCHEDULED_NOTE":
      return { ...state, scheduled: state.scheduled.map(it => it.id === A.id ? { ...it, note: A.note } : it) };
    case "SET_SCHEDULED_CADENCE":
      return { ...state, scheduled: state.scheduled.map(it => it.id === A.id ? {
        ...it,
        cadence: A.cadence || it.cadence,
        day: A.day != null ? A.day : it.day,
        date: A.date != null ? Math.max(1, Math.min(31, A.date)) : it.date,
      } : it) };
    case "DELETE_SCHEDULED":
      return { ...state, scheduled: state.scheduled.filter(it => it.id !== A.id) };

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
      selSchedCompletedForWeek(state).forEach(c => completed.push(c));
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
          // a recurring to-do restarts each week, so a fixed calendar date would
          // just go stale and read "late" forever — drop it with the reset
          if (t.recurring) return { ...t, status: "todo", due: null, duePromoted: false, subtasks: Array.isArray(t.subtasks) ? t.subtasks.map(s => ({ ...s, done: false })) : t.subtasks };
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
        } else if (act.kind === "add_scheduled") {
          s = reducer(s, { type: "ADD_SCHEDULED", text: act.text, note: act.note, cadence: act.cadence, day: act.day, date: act.date });
        } else if (act.kind === "add_task") {
          const proj = resolveProject(s, act.project);
          if (proj) {
            const newId = uid();
            s = reducer(s, { type: "ADD_TASK", id: newId, projectId: proj.id, text: act.text, note: act.note, lane: act.queue ? "queue" : "active", taskType: act.habit ? "habit" : "todo", due: act.due || null, subtasks: (act.subtasks || []).map(x => ({ id: uid(), text: x, done: false })) });
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

  // A tab left open across midnight would otherwise never re-run promoteDue
  // (it only fires inside the reducer). The unknown action is a no-op for
  // applyAction, so when nothing qualifies the same state object comes back
  // and React skips the render.
  useEffect(() => {
    const t = setInterval(() => dispatch({ type: "DUE_TICK" }), 60 * 60 * 1000);
    return () => clearInterval(t);
  }, [dispatch]);

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
// sinkDone already normalises the stored order; these sorts just make the
// rendered list independent of that (and keep the two definitions in one place)
function selActive(p) { return p.tasks.filter(t => t.lane === "active").sort(cmpTasks); }
function selQueue(p)  { return p.tasks.filter(t => t.lane === "queue").sort(cmpTasks); }
// scheduled items completed during the current app-week (used by the
// close-week recap): weekly items done for this week, plus monthly items
// whose check-off date falls inside the week
function selSchedCompletedForWeek(state) {
  const start = state.week.startISO, end = addDaysISO(start, 7);
  return (state.scheduled || [])
    .filter(it => (it.cadence !== "monthly" && it.doneFor === start)
               || (it.cadence === "monthly" && it.doneAt && it.doneAt >= start && it.doneAt < end))
    .map(it => ({ project: "Scheduled", accent: "oklch(0.640 0.100 75)", text: it.text }));
}
function selProgress(state) {
  let done = 0, total = 0;
  state.projects.forEach(p => p.tasks.filter(t => t.lane === "active").forEach(t => { total++; if (t.status === "done") done++; }));
  return { done, total };
}

Object.assign(window, { FocusProvider, useFocusStore, fmtRange, addDaysISO, selBigThree, selActive, selQueue, selProgress, selSchedCompletedForWeek, uid, quarterIsDue, quarterEndDate, todayISO, daysUntil, DUE_LEAD_DAYS });
