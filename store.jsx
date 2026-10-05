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
  return localISO(d);
}
// Local calendar date of a Date (toISOString would read it in UTC, a day off
// for anyone east of Greenwich, or after 7-8pm ET for "now").
function localISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---- due-date helpers ----
const DUE_LEAD_DAYS = 10;
function todayISO() { return localISO(new Date()); }
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

// ---- goals (the quarter's and the month's) ----
// state.quarter.goals and state.month.goals share one shape:
// [{ id, text, done, subs: [{ id, text, done }] }] — one level of sub-goals.
// Quarter goals were plain strings before the Goals tile; normGoal lifts them.
// A tab still running the old code crashes on the first pull of goal objects
// — on purpose: a crashed tab saves nothing, while one kept alive on a string
// copy could close the quarter with that copy and wipe the real list.
function normGoal(g) {
  if (typeof g === "string") return { id: uid(), text: g, done: false, subs: [] };
  const o = g && typeof g === "object" ? g : {};
  return { id: o.id || uid(), text: String(o.text || ""), done: !!o.done,
    subs: (Array.isArray(o.subs) ? o.subs : []).map(s => ({ id: (s && s.id) || uid(), text: String((s && s.text) || ""), done: !!(s && s.done) })) };
}
// A blank line (Enter, then nothing typed) doesn't outlive a reload. A blank
// goal still holding sub-goals stays, so they aren't lost with it.
function tidyGoals(goals) {
  return goals.map(g => ({ ...g, subs: g.subs.filter(x => x.text.trim()) }))
    .filter(g => g.text.trim() || g.subs.length);
}
// "YYYY-MM" for the local calendar month
function monthKey(iso = todayISO()) { return iso.slice(0, 7); }
// The month list belongs to one calendar month. On the 1st the old list is
// filed in monthHistory ({ key, goals, closedAt }, like quarterHistory) and a
// fresh, empty one starts. Runs with the day roll (load, pull, and before
// every action — never on the hourly timer). A list dated after the device's
// own month (a clock running behind) is left alone.
function rollMonth(state) {
  const now = monthKey(), m = state.month;
  if (!m || m.key >= now) return state;
  const hist = state.monthHistory || [];
  return { ...state,
    month: { key: now, goals: [] },
    monthHistory: m.goals.length ? [{ key: m.key, goals: m.goals, closedAt: Date.now() }, ...hist] : hist };
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
    // not shown since the Goals tile replaced North Star — kept so it can return
    affirmations: [
      "I own a 20-unit agritourism micro-hotel and wedding venue that promotes regenerative agriculture.",
      "I am in the best shape of my life — mentally, physically, emotionally — because I stick to my habits and AM/PM routines and put the important first.",
      "I notice all the incredible things that are constantly happening for me.",
    ],
    quarter: { label: "Q2", range: "Apr 1 – Jun 30", goals: [
      "Airbnb $10k+ / mo",
      "Motion 5%+ MoM growth",
      "$200K capital + land/farm identified",
    ].map(normGoal) },
    quarterHistory: [],
    month: { key: monthKey(), goals: [] },
    monthHistory: [],
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
    today: { date: todayISO(), items: [] },
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
  // Today list added later: an empty list dated today
  if (!s.today || !Array.isArray(s.today.items)) s.today = { date: todayISO(), items: [] };
  // Goals tile added later: quarter goals were plain strings (see normGoal);
  // the month list is new
  if (!s.quarter) s.quarter = { label: "Q?", range: "", goals: [] };
  s.quarter.goals = tidyGoals((Array.isArray(s.quarter.goals) ? s.quarter.goals : []).map(normGoal));
  if (!s.month || !Array.isArray(s.month.goals)) s.month = { key: monthKey(), goals: [] };
  s.month.goals = tidyGoals(s.month.goals.map(normGoal));
  if (!Array.isArray(s.monthHistory)) s.monthHistory = [];
  // day tabs added later: a list per day ahead (see planToday)
  if (!s.plans || typeof s.plans !== "object" || Array.isArray(s.plans)) s.plans = {};
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
    // a plan day used to be a field on the task; it moves to that day's list
    // (tidyPlans drops a repeat). A tab still on the old code can set one
    // again, so this runs on every load and pull, not once.
    const plan = cleanDue(t.plan);
    delete t.plan;
    if (plan && t.type !== "habit" && t.status !== "done")
      s.plans[plan] = [...(Array.isArray(s.plans[plan]) ? s.plans[plan] : []), { taskId: t.id, subId: null }];
  }));
  // load and every server pull come through here: roll the day over on fresh data
  return rollDay(sinkDone(s));
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
// ============================================================
// Today — a hand-picked list of tasks and steps for the day
// ============================================================
// state.today = { date: "YYYY-MM-DD", items: [{ taskId, subId|null }] }.
// Items are *references*: the row on screen is always the live task or step,
// so a check-off or an edit in either place shows in both. Array order is the
// day's order; the first three rows are numbered 1-3 (the day's big three).
// Something typed into the list is a real task (or step) on a card first,
// then a reference here — see TODAY_NEW.
const todayKey = (taskId, subId) => taskId + ":" + (subId || "");
// Monday-first weekday index (matches habit.days) for a YYYY-MM-DD date.
function weekdayIdx(iso) { return (new Date(iso + "T00:00:00").getDay() + 6) % 7; }
// Finished for the purposes of the Today list. A habit counts as finished
// on a given date when that date's day-mark is set.
function todayItemDone(task, sub, dateISO) {
  if (sub) return !!sub.done;
  if (task.type === "habit") return !!(task.days || [])[weekdayIdx(dateISO)];
  return task.status === "done";
}
// Resolve one item to its live task/step, or null when either is gone.
function resolveTodayItem(state, it) {
  if (!it || !it.taskId) return null;
  const { project, task } = findTask(state, it.taskId);
  if (!task) return null;
  if (!it.subId) return { project, task, sub: null };
  // habits never show their steps, so a step of a habit cannot be picked
  if (task.type === "habit") return null;
  const sub = (task.subtasks || []).find(s => s.id === it.subId);
  return sub ? { project, task, sub } : null;
}
// Drop references to things that no longer exist (prune), and when `roll` is
// set and the date has moved on, drop whatever was finished — the unfinished
// list carries over. Pruning runs inside sinkDone (every action, every
// hydrate). Rolling runs only from a user action, a load, or a hydrate —
// never from the hourly timer: a timer-only state change would push this
// tab's whole planner to the server, and an idle tab's copy may be stale.
function tidyToday(state, roll) {
  const cur = state.today;
  if (!cur || !Array.isArray(cur.items)) return { ...state, today: { date: todayISO(), items: [] } };
  const now = todayISO();
  const newDay = roll && cur.date !== now;
  const seen = new Set();
  const items = cur.items.filter(it => {
    const r = resolveTodayItem(state, it);
    if (!r) return false;
    const k = todayKey(it.taskId, it.subId);
    if (seen.has(k)) return false;
    seen.add(k);
    return !(newDay && todayItemDone(r.task, r.sub, cur.date));
  });
  if (!newDay && items.length === cur.items.length) return state;
  // An empty list has nothing to roll, so leave its date alone — an idle tab
  // sitting past midnight would otherwise mint a "changed" state every day
  // and push a stale copy of the whole planner over newer edits elsewhere.
  if (items.length === 0 && cur.items.length === 0) return state;
  return { ...state, today: { date: newDay ? now : cur.date, items } };
}
// ---- plan days: a list for each day ahead, filled from the day tabs ----
// state.plans = { "YYYY-MM-DD": [{ taskId, subId|null }] } — the same shape
// as Today's items, one ordered list per day after today. A task or step is
// in one place at most: Today, or one day ahead (see unpick). When a day
// comes (or has passed — the app may not have been opened that day) its list
// goes on top of Today in the order it was planned, ahead of what carried
// over from the day before, and the day's list is spent. A task joining
// Today moves to its card's This week lane (a Today task is this week's
// work). Something finished ahead of its day is left behind.
function planToday(state) {
  const now = todayISO(), plans = state.plans || {};
  const due = Object.keys(plans).filter(d => d <= now).sort();
  if (!due.length) return state;
  const keys = selTodayKeys(state), add = [], rest = { ...plans };
  due.forEach(d => {
    delete rest[d];
    (Array.isArray(plans[d]) ? plans[d] : []).forEach(it => {
      const r = resolveTodayItem(state, it), k = r && todayKey(it.taskId, it.subId);
      if (!r || keys.has(k) || todayItemDone(r.task, r.sub, now)) return;
      keys.add(k);
      add.push({ taskId: it.taskId, subId: it.subId || null });
    });
  });
  const lift = new Set(add.filter(it => !it.subId).map(it => it.taskId));
  let laneMoved = false;
  const projects = state.projects.map(p => {
    if (!p.tasks.some(t => lift.has(t.id) && t.lane === "queue")) return p;
    laneMoved = true;
    return { ...p, tasks: p.tasks.map(t => lift.has(t.id) && t.lane === "queue" ? { ...t, lane: "active" } : t) };
  });
  const items = [...add, ...state.today.items];
  // an empty list keeps a stale date (see tidyToday) — restart it now
  const date = state.today.items.length === 0 && items.length > 0 ? now : state.today.date;
  const out = { ...state, projects, plans: rest, today: { date, items } };
  // a lane change must re-sort the cards so stored order matches the screen
  return laneMoved ? sinkDone(out) : out;
}
// Keep the plan lists sound: drop references to things that no longer exist,
// habits (they keep no plan day), anything on Today (Today wins) or already
// on an earlier day, and bad or emptied day keys. Finished rows sink below
// open ones, as on Today, so the stored order matches the tab (drag indexes
// are read against it). Runs inside sinkDone; a day that has come round is
// left for the roll (planToday) to move. Same state back when nothing changed.
function tidyPlans(state) {
  const plans = state.plans;
  if (!plans) return state;
  if (typeof plans !== "object" || Array.isArray(plans)) return { ...state, plans: {} };
  const seen = selTodayKeys(state), out = {};
  let changed = false;
  Object.keys(plans).sort().forEach(d => {
    const list = plans[d];
    if (!cleanDue(d) || !Array.isArray(list)) { changed = true; return; }
    const rows = [];
    list.forEach(it => {
      const r = resolveTodayItem(state, it), k = r && todayKey(it.taskId, it.subId);
      if (!r || (!r.sub && r.task.type === "habit") || seen.has(k)) return;
      seen.add(k);
      rows.push({ it, task: r.task, sub: r.sub, sortDone: todayItemDone(r.task, r.sub, d) });
    });
    const kept = stableSort(rows, cmpTodayRows).map(r => r.it);
    const same = kept.length === list.length && kept.every((it, i) => it === list[i]);
    // an empty day goes too — left in, the roll would drop it later as a
    // change of its own
    if (!same || !kept.length) changed = true;
    if (kept.length) out[d] = same ? list : kept;
  });
  return changed ? { ...state, plans: out } : state;
}
// plans without this key (same object back when it isn't there)
function dropFromPlans(plans, k) {
  if (!plans) return plans;
  const hit = Object.keys(plans).filter(d => plans[d].some(it => todayKey(it.taskId, it.subId) === k));
  if (!hit.length) return plans;
  const out = { ...plans };
  hit.forEach(d => {
    const list = plans[d].filter(it => todayKey(it.taskId, it.subId) !== k);
    if (list.length) out[d] = list; else delete out[d];
  });
  return out;
}
// Take a task or step off Today and every day ahead — the step before it
// lands somewhere new, so it is only ever in one place.
function unpick(state, k) {
  let s = state;
  if (s.today.items.some(it => todayKey(it.taskId, it.subId) === k))
    s = { ...s, today: { ...s.today, items: s.today.items.filter(it => todayKey(it.taskId, it.subId) !== k) } };
  const plans = dropFromPlans(s.plans, k);
  return plans === s.plans ? s : { ...s, plans };
}

// The day roll: file last month's goals, carry Today's unfinished rows over
// (dropping the finished ones), then add what was planned for today. A rolled
// day can flip a habit's done-ness, so the list re-settles after.
const rollDay    = (state) => sinkTodayDone(planToday(tidyToday(rollMonth(state), true)));
const pruneToday = (state) => tidyToday(state, false);

// Applied after every action so the *stored* order always matches what's on
// screen — drag-and-drop insert indexes are computed against the rendered list,
// so the two must not drift apart.
function sinkDone(state) {
  if (!state || !Array.isArray(state.projects)) return state;
  state = promoteDue(state);
  state = pruneToday(state);
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
  return sinkTodayDone(tidyPlans(moved ? { ...state, projects } : state));
}
// Today rows: finished ones drop below the open ones, same as on the cards,
// so the numbered top three are always live work. Sorts the *stored* list
// (drag indexes are computed against what's rendered, so the two must agree).
function cmpTodayRows(a, b) {
  const da = a.sortDone ? 1 : 0, db = b.sortDone ? 1 : 0;
  if (da !== db) return da - db;
  if (!da) return 0;
  // a habit's completedAt marks its weekly target, not today's check — it
  // carries no stamp here and keeps the order it sank in
  const at = (r) => r.sub ? r.sub.completedAt : r.task.type === "habit" ? 0 : r.task.completedAt;
  return (at(a) || 0) - (at(b) || 0);                            // done pile: oldest → newest
}
// Done-ness is judged against the list's own date, not the clock: after
// midnight a habit checked yesterday reads as open again, and re-sorting on
// the hourly timer would push a stale idle tab (see tidyToday). The next
// real action rolls the day first, then this settles the new order.
function sinkTodayDone(state) {
  const cur = state.today;
  if (!cur || !Array.isArray(cur.items) || cur.items.length < 2) return state;
  const rows = cur.items.map(it => {
    const r = resolveTodayItem(state, it);
    // pruneToday already ran, so every item resolves; guard anyway
    return { it, task: r && r.task, sub: r && r.sub, sortDone: r ? todayItemDone(r.task, r.sub, cur.date) : false };
  });
  const sorted = stableSort(rows, cmpTodayRows);
  if (sorted === rows) return state;
  return { ...state, today: { ...cur, items: sorted.map(r => r.it) } };
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

// every dispatch runs through sinkDone so completed items re-settle immediately.
// The day rolls over *before* the action lands: the first thing checked off
// after midnight must count as today's work, not as yesterday's leftovers,
// and a week-close must not resurrect what was finished yesterday. HYDRATE
// replaces the state wholesale, so it rolls afterwards. The hourly DUE_TICK
// never rolls (see tidyToday) — the next real action or tab refocus will.
function reducer(state, action) {
  const timer = action.type === "DUE_TICK";
  const base = action.type === "HYDRATE" || timer ? state : rollDay(state);
  const next = sinkDone(applyAction(base, action));
  return action.type === "HYDRATE" ? rollDay(next) : next;
}

function applyAction(state, action) {
  const A = action;
  switch (A.type) {
    case "RESET_ALL": return seed();
    case "HYDRATE": return A.state;

    // ---- goals: A.scope is "quarter" or "month" (with A.key, the month the
    // list on screen belongs to); A.id may name a sub-goal ----
    case "GOAL_ADD": {
      // a new goal at the end of the list, or — with A.parentId — a new
      // sub-goal at the end of that goal's list
      const at = goalTarget(state, A), text = String(A.text || "").trim();
      if (!at || !text) return state;
      const item = { id: A.id || uid(), text, done: false };
      if (!A.parentId) return at.put([...at.list, { ...item, subs: [] }]);
      if (!at.list.some(g => g.id === A.parentId)) return state;
      return at.put(at.list.map(g => g.id === A.parentId ? { ...g, subs: [...g.subs, item] } : g));
    }
    case "GOAL_TOGGLE": {
      const at = goalTarget(state, A);
      return at ? at.put(mapGoal(at.list, A.id, g => ({ ...g, done: !g.done }))) : state;
    }
    case "GOAL_EDIT": {
      const at = goalTarget(state, A), text = String(A.text || "").trim();
      return at && text ? at.put(mapGoal(at.list, A.id, g => ({ ...g, text }))) : state;
    }
    case "GOAL_DELETE": {
      // deleting a goal takes its sub-goals with it
      const at = goalTarget(state, A);
      if (!at) return state;
      return at.put(at.list.filter(g => g.id !== A.id)
        .map(g => g.subs.some(x => x.id === A.id) ? { ...g, subs: g.subs.filter(x => x.id !== A.id) } : g));
    }
    case "GOAL_INSERT": {
      // Enter on a goal: a blank line at A.index among the goals or, with
      // A.parentId, among that goal's sub-goals. It opens for typing; left
      // blank it is deleted (see GoalRow), and migrate drops any that slip by.
      const at = goalTarget(state, A);
      if (!at || !A.id) return state;
      const item = { id: A.id, text: "", done: false };
      if (!A.parentId) return at.put(insertAt(at.list, A.index, [{ ...item, subs: [] }]));
      if (!at.list.some(g => g.id === A.parentId)) return state;
      return at.put(at.list.map(g => g.id === A.parentId ? { ...g, subs: insertAt(g.subs, A.index, [item]) } : g));
    }
    case "GOAL_INDENT": {
      // Tab: a goal becomes the last sub-goal of the goal above it. Its own
      // sub-goals follow it there (one level only), so no row moves on screen.
      const at = goalTarget(state, A);
      if (!at) return state;
      const gi = at.list.findIndex(g => g.id === A.id);
      if (gi <= 0) return state; // a sub-goal already, or nothing above it
      const g = at.list[gi], prev = at.list[gi - 1];
      const subs = [...prev.subs, { id: g.id, text: g.text, done: g.done }, ...g.subs];
      return at.put(at.list.filter(x => x !== g).map(x => x === prev ? { ...prev, subs } : x));
    }
    case "GOAL_OUTDENT": {
      // Shift+Tab: a sub-goal becomes a goal right after its parent and takes
      // the sub-goals below it as its own, so no row moves on screen
      const at = goalTarget(state, A);
      if (!at) return state;
      const pi = at.list.findIndex(g => g.subs.some(x => x.id === A.id));
      if (pi < 0) return state;
      const p = at.list[pi], si = p.subs.findIndex(x => x.id === A.id);
      const out = at.list.slice();
      out.splice(pi, 1, { ...p, subs: p.subs.slice(0, si) }, { ...p.subs[si], subs: p.subs.slice(si + 1) });
      return at.put(out);
    }
    case "GOAL_MOVE": {
      // drag to re-sort: A.id lands at A.toIndex among the goals or, with
      // A.parentId, among that goal's sub-goals. So a goal dropped into
      // another becomes its sub-goal (its own sub-goals follow it — one level
      // only, as with Tab), and a sub-goal dropped between goals becomes a
      // goal. The index is read against the rendered list, so a move down
      // its own list loses one — same as TODAY_MOVE.
      const at = goalTarget(state, A);
      if (!at) return state;
      const list = at.list;
      const gi = list.findIndex(g => g.id === A.id);
      const from = gi >= 0 ? null : list.find(g => g.subs.some(x => x.id === A.id));
      if (gi < 0 && !from) return state;
      if (gi >= 0 && !A.parentId) {
        const out = moveInList(list, gi, A.toIndex);
        return out ? at.put(out) : state;
      }
      if (from && from.id === A.parentId) {
        const subs = moveInList(from.subs, from.subs.findIndex(x => x.id === A.id), A.toIndex);
        return subs ? at.put(list.map(g => g === from ? { ...g, subs } : g)) : state;
      }
      if (A.parentId) {
        if (A.parentId === A.id || !list.some(g => g.id === A.parentId)) return state;
        const g = list[gi], item = from && from.subs.find(x => x.id === A.id);
        const moved = g ? [{ id: g.id, text: g.text, done: g.done }, ...g.subs] : [item];
        const rest = g ? list.filter(x => x !== g) : list.map(x => x === from ? { ...x, subs: x.subs.filter(y => y !== item) } : x);
        return at.put(rest.map(x => x.id === A.parentId ? { ...x, subs: insertAt(x.subs, A.toIndex, moved) } : x));
      }
      const item = from.subs.find(x => x.id === A.id);
      const rest = list.map(x => x === from ? { ...x, subs: x.subs.filter(y => y !== item) } : x);
      return at.put(insertAt(rest, A.toIndex, [{ ...item, subs: [] }]));
    }

    // ---- tasks ----
    case "CYCLE_STATUS": {
      const next = { todo: "doing", doing: "done", done: "todo" };
      return mapTask(state, A.taskId, (t) => ({ ...t, status: next[t.status] }));
    }
    case "TOGGLE_HABIT_DAY":
      // A.day may be "today": resolved here, at click time, so a tab left open
      // across midnight marks the right day
      return mapTask(state, A.taskId, (t) => {
        const day = A.day === "today" ? weekdayIdx(todayISO()) : A.day;
        const days = t.days.slice(); days[day] = !days[day];
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
      // habits have no due-date UI, so a leftover must not linger invisibly
      // (tidyPlans takes a habit off any day ahead)
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
    case "SET_PLAN":
      // a task's "Plan for a day" picker: on to that day's list, or with
      // A.plan null, off whichever day it was planned for
      return applyAction(state, A.plan
        ? { type: "PLAN_ADD", taskId: A.taskId, subId: null, day: A.plan }
        : { type: "PLAN_REMOVE", taskId: A.taskId, subId: null });

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

    // ---- today ----
    case "TODAY_ADD": {
      // append (or insert at A.toIndex) unless it is already on the list.
      // Planned for a day ahead, it comes off that day — it's today's now.
      if (!resolveTodayItem(state, A)) return state;
      const k = todayKey(A.taskId, A.subId);
      if (state.today.items.some(it => todayKey(it.taskId, it.subId) === k)) return state;
      const items = state.today.items.slice();
      const idx = A.toIndex == null ? items.length : Math.max(0, Math.min(A.toIndex, items.length));
      items.splice(idx, 0, { taskId: A.taskId, subId: A.subId || null });
      // an empty list keeps a stale date (see tidyToday) — restart it now
      return { ...state, plans: dropFromPlans(state.plans, k), today: { date: items.length === 1 ? todayISO() : state.today.date, items } };
    }
    case "PLAN_ADD": {
      // put a task or step on day A.day's list at A.toIndex (null: the end),
      // off Today and any other day. Moved within its own day, the index is
      // read against the rendered list, so a downward move loses one (same as
      // TODAY_MOVE). A day that has already come is Today. Habits keep no
      // plan day.
      const day = cleanDue(A.day);
      if (!day) return state;
      if (day <= todayISO()) return applyAction(state, { type: "TODAY_ADD", taskId: A.taskId, subId: A.subId, toIndex: A.toIndex });
      const r = resolveTodayItem(state, A);
      if (!r || (!r.sub && r.task.type === "habit")) return state;
      const k = todayKey(A.taskId, A.subId);
      const list = (state.plans && state.plans[day]) || [];
      const from = list.findIndex(it => todayKey(it.taskId, it.subId) === k);
      if (from >= 0) {
        const moved = moveInList(list, from, A.toIndex);
        if (!moved) return state;
        // a done row dragged above open ones sinks straight back — hand back
        // the same state then, so a no-op drop doesn't trigger a sync push
        const out = tidyPlans({ ...state, plans: { ...state.plans, [day]: moved } });
        const after = out.plans[day] || [];
        return after.length === list.length && after.every((it, i) => it === list[i]) ? state : out;
      }
      const s = unpick(state, k);
      const plans = s.plans || {};
      return { ...s, plans: { ...plans, [day]: insertAt(plans[day] || [], A.toIndex, [{ taskId: A.taskId, subId: A.subId || null }]) } };
    }
    case "PLAN_REMOVE":
      // off its day — and off Today too: a page left open past midnight
      // still shows yesterday's "tomorrow", whose list the roll has just
      // moved onto Today, and the click means "not on that day"
      return unpick(state, todayKey(A.taskId, A.subId));
    case "TODAY_REMOVE": {
      const k = todayKey(A.taskId, A.subId);
      const items = state.today.items.filter(it => todayKey(it.taskId, it.subId) !== k);
      return items.length === state.today.items.length ? state : { ...state, today: { ...state.today, items } };
    }
    case "TODAY_TOGGLE": {
      const k = todayKey(A.taskId, A.subId);
      const on = state.today.items.some(it => todayKey(it.taskId, it.subId) === k);
      return applyAction(state, { ...A, type: on ? "TODAY_REMOVE" : "TODAY_ADD" });
    }
    case "TODAY_NEW": {
      // typed straight into the Today list: a fresh to-do on card
      // A.projectId's This week lane (never the queue), or — with
      // A.parentTaskId — a new step on that task. It joins the list in the
      // same action, so the list and the card change in one render/push.
      // With A.day (a day ahead) it joins that day's list instead.
      const text = String(A.text || "").trim();
      if (!text) return state;
      const pick = (s, taskId, subId) => applyAction(s, A.day
        ? { type: "PLAN_ADD", taskId, subId, day: A.day }
        : { type: "TODAY_ADD", taskId, subId });
      if (A.parentTaskId) {
        const { task } = findTask(state, A.parentTaskId);
        if (!task || task.type === "habit") return state;
        const subId = A.id || uid();
        const s = mapTask(state, task.id, (t) => ({ ...t, subtasks: [...t.subtasks, { id: subId, text, done: false }] }));
        return pick(s, task.id, subId);
      }
      if (!state.projects.some(p => p.id === A.projectId)) return state;
      const id = A.id || uid();
      const s = applyAction(state, { type: "ADD_TASK", id, projectId: A.projectId, text, lane: "active" });
      return pick(s, id, null);
    }
    case "TODAY_MOVE": {
      // reorder within the list: A.key moves to A.toIndex (read against the
      // rendered list, so a downward move loses one — same as MOVE_SUB)
      const items = state.today.items.slice();
      const from = items.findIndex(it => todayKey(it.taskId, it.subId) === A.key);
      if (from < 0) return state;
      const [moved] = items.splice(from, 1);
      const want = A.toIndex == null ? items.length : A.toIndex > from ? A.toIndex - 1 : A.toIndex;
      const idx = Math.max(0, Math.min(want, items.length));
      items.splice(idx, 0, moved);
      // a done row dragged above open ones sinks straight back — hand back
      // the same state then, so a no-op drop doesn't trigger a sync push
      const out = sinkTodayDone({ ...state, today: { ...state.today, items } });
      return out.today.items.every((it, i) => it === state.today.items[i]) ? state : out;
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
    case "NEST_TASK": {
      // fold task A.taskId into A.intoTaskId as its last step. Steps are a
      // flatter shape (id/text/done), so note/status/steps of the nested task
      // are dropped — the caller refuses tasks that own steps. One action so
      // a Today entry for the task follows it to the new step id.
      const { task } = findTask(state, A.taskId);
      const { task: into } = findTask(state, A.intoTaskId);
      if (!task || !into || task.id === into.id || into.type === "habit"
          || (Array.isArray(task.subtasks) && task.subtasks.length > 0)) return state;
      const sub = { id: uid(), text: task.text, done: task.status === "done" };
      let s = mapTask(state, into.id, (t) => ({ ...t, subtasks: [...t.subtasks, sub] }));
      s = retargetItem(s, task.id, null, into.id, sub.id);
      return { ...s, projects: s.projects.map(p => ({ ...p, tasks: p.tasks.filter(t => t.id !== task.id) })) };
    }
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
      // a step on the Today list (or a day ahead) stays on it after it changes parent
      return retargetItem(s, A.fromTaskId, A.subId, A.toTaskId, A.subId);
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
      // a step on the Today list (or a day ahead) stays on it as the task it became
      const s = retargetItem(mapTask(state, A.fromTaskId, (x) => ({ ...x, subtasks: x.subtasks.filter(y => y.id !== A.subId) })), A.fromTaskId, A.subId, t.id, null);
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
      // something finished ahead of its plan day comes off that day first —
      // the reset above could reopen it and land it on Today after all
      const plans = {};
      Object.keys(state.plans || {}).forEach(d => {
        const list = state.plans[d].filter(it => { const r = resolveTodayItem(state, it); return r && !todayItemDone(r.task, r.sub, d); });
        if (list.length) plans[d] = list;
      });
      return { ...state, history: [entry, ...state.history], projects, plans, week: { n: state.week.n + 1, startISO: addDaysISO(state.week.startISO, 7) } };
    }

    // ---- quarter rollover ----
    case "ROLL_QUARTER":
      return {
        ...state,
        quarterHistory: [A.archive, ...(state.quarterHistory || [])],
        quarter: { ...A.next, goals: (A.next.goals || []).map(normGoal) },
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
// Point a Today or plan-day item at a new (taskId, subId) — used when a step
// moves between tasks or becomes a task of its own, so it keeps its place in
// the day.
function retargetItem(state, taskId, subId, toTaskId, toSubId) {
  const k = todayKey(taskId, subId), to = { taskId: toTaskId, subId: toSubId || null };
  const swap = (list) => list.some(it => todayKey(it.taskId, it.subId) === k)
    ? list.map(it => todayKey(it.taskId, it.subId) === k ? to : it) : list;
  let s = state;
  if (s.today) {
    const items = swap(s.today.items);
    if (items !== s.today.items) s = { ...s, today: { ...s.today, items } };
  }
  const plans = s.plans || {};
  const days = Object.keys(plans).filter(d => swap(plans[d]) !== plans[d]);
  if (days.length) {
    const next = { ...plans };
    days.forEach(d => { next[d] = swap(plans[d]); });
    s = { ...s, plans: next };
  }
  return s;
}
function mapClearBig(state, taskId) { return mapTask(state, taskId, t => t); }
// The goal list a GOAL_* action lands on: { list, put(newList) -> state },
// or null for an unknown scope. A month action made on a list that has since
// rolled over (a tab left open past the 1st, the roll running just before
// the action) lands in that month's archive, so the click isn't lost. With
// no archive (that month had no goals) it lands on the current month.
function goalTarget(state, A) {
  if (A.scope === "quarter")
    return { list: state.quarter.goals, put: (goals) => ({ ...state, quarter: { ...state.quarter, goals } }) };
  if (A.scope !== "month") return null;
  const hist = state.monthHistory || [];
  const i = A.key && A.key !== state.month.key ? hist.findIndex(h => h.key === A.key) : -1;
  if (i < 0) return { list: state.month.goals, put: (goals) => ({ ...state, month: { ...state.month, goals } }) };
  return { list: hist[i].goals, put: (goals) => ({ ...state, monthHistory: hist.map((h, j) => j === i ? { ...h, goals } : h) }) };
}
// arr with items spliced in at index (null: the end)
function insertAt(arr, index, items) {
  const out = arr.slice();
  out.splice(index == null ? out.length : Math.max(0, Math.min(index, out.length)), 0, ...items);
  return out;
}
// arr with the item at `from` moved to `toIndex` (read with the item still in
// place, like TODAY_MOVE), or null when it would not move — so a no-op drop
// hands back the same state and triggers no sync push
function moveInList(arr, from, toIndex) {
  const out = arr.slice();
  const [it] = out.splice(from, 1);
  const want = toIndex == null ? out.length : toIndex > from ? toIndex - 1 : toIndex;
  const idx = Math.max(0, Math.min(want, out.length));
  if (idx === from) return null;
  out.splice(idx, 0, it);
  return out;
}
// transform the one goal or sub-goal with this id
function mapGoal(goals, id, fn) {
  return goals.map(g => g.id === id ? fn(g)
    : g.subs.some(x => x.id === id) ? { ...g, subs: g.subs.map(x => x.id === id ? fn(x) : x) } : g);
}

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
// The Today list, resolved to live rows. Anything that no longer exists is
// skipped (the day roll prunes it from state on the next action).
function selToday(state) {
  // done: as of today; sort key: the list's own date, same as the stored
  // sort, so rendered and stored order agree (drag indexes are read against
  // the rendered list)
  return dayRows(state, (state.today && state.today.items) || [], todayISO(), state.today.date);
}
// One tab's list: Today's, or what's planned for a day ahead
function selDay(state, iso) {
  if (iso === todayISO()) return selToday(state);
  return dayRows(state, (state.plans && state.plans[iso]) || [], iso, iso);
}
function dayRows(state, items, doneDate, sortDate) {
  const out = [];
  items.forEach(it => {
    const r = resolveTodayItem(state, it);
    if (!r) return;
    out.push({
      key: todayKey(it.taskId, it.subId), taskId: it.taskId, subId: it.subId || null,
      task: r.task, sub: r.sub, project: r.project,
      text: r.sub ? r.sub.text : r.task.text,
      done: todayItemDone(r.task, r.sub, doneDate),
      sortDone: todayItemDone(r.task, r.sub, sortDate),
    });
  });
  // sinkTodayDone / tidyPlans already settle the stored order; this keeps the
  // rendered list independent of that (one definition, two call sites)
  return stableSort(out, cmpTodayRows);
}
function selTodayKeys(state) {
  return new Set(((state.today && state.today.items) || []).map(it => todayKey(it.taskId, it.subId)));
}
// the day ahead a task or step is planned for, or null
function selPlanDay(state, taskId, subId) {
  const k = todayKey(taskId, subId), plans = state.plans || {};
  return Object.keys(plans).sort().find(d => plans[d].some(it => todayKey(it.taskId, it.subId) === k)) || null;
}
function selProgress(state) {
  let done = 0, total = 0;
  state.projects.forEach(p => p.tasks.filter(t => t.lane === "active").forEach(t => { total++; if (t.status === "done") done++; }));
  return { done, total };
}

Object.assign(window, { FocusProvider, useFocusStore, fmtRange, addDaysISO, selBigThree, selActive, selQueue, selProgress, selSchedCompletedForWeek, selToday, selDay, selTodayKeys, selPlanDay, todayKey, weekdayIdx, uid, quarterIsDue, quarterEndDate, todayISO, daysUntil, DUE_LEAD_DAYS, monthKey });
