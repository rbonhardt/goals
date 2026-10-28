// ============================================================
// sync.test.mjs — two devices, one server row: nothing overwritten.
//
// Run:  node tests/sync.test.mjs
// Needs esbuild (only to turn store.jsx's JSX into plain JS). Set ESBUILD to
// its path; the default is the copy in the MOTION Employee Hub repo.
//
// Each device is its own vm context running its own copy of store.jsx (its
// own localStorage, uid tape, stamps), with createSync talking to a fake
// server that keeps the same rule as app_state_save: a save lands only if
// the row is still at the rev it names.
// ============================================================
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ESBUILD = process.env.ESBUILD
  || path.join(process.env.HOME, "AntiGravity/Motion Employee Hub/frontend/node_modules/.bin/esbuild");
const code = execFileSync(ESBUILD, ["--loader=jsx"], { input: readFileSync(path.join(root, "store.jsx")) }).toString();

// ---- the server: one row, compare-and-set on rev ----
function makeServer() {
  const srv = { rev: 0, json: null, saves: 0 };
  srv.read = () => srv.json == null ? null : JSON.parse(srv.json);
  // a write by a tab still on the old code: a plain upsert, no rev check —
  // refused once the new app has saved (the row carries _sync), as the
  // migration's trigger does
  srv.oldWrite = (data) => {
    if (srv.json != null && "_sync" in srv.read()) throw new Error("Focus: this tab runs old code; reload it to save");
    srv.json = JSON.stringify(data); srv.rev++;
  };
  return srv;
}

// ---- a device ----
function makeStorage(from) {
  const m = new Map(from ? from.m : []);
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

function makeDevice(name, srv, storage = makeStorage(), { random } = {}) {
  const warnings = [];
  const React = {
    useState: () => [], useEffect: () => {}, useRef: () => ({}), useCallback: (f) => f,
    createContext: () => ({ Provider: "Provider" }), useContext: () => null, createElement: () => null,
  };
  const ctx = vm.createContext({
    React, localStorage: storage, console: { log() {}, warn: (...a) => warnings.push(a.join(" ")) },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  });
  ctx.window = ctx;
  vm.runInContext(code, ctx, { filename: "store.jsx" });
  // a chosen page id (createSync draws it from Math.random)
  const realRandom = vm.runInContext("Math.random", ctx);
  if (random) vm.runInContext("Math", ctx).random = random;

  const net = { offline: false, loseAnswer: false, gate: null };
  const api = {
    async pull() {
      if (net.offline) throw new Error("offline");
      return srv.json == null ? null : { rev: srv.rev, data: srv.read() };
    },
    async save(rev, data) {
      if (net.offline) throw new Error("offline");
      if (net.gate) await net.gate;
      const json = JSON.stringify(data);   // what goes over the wire
      let res;
      if (srv.rev === rev) {
        srv.json = json; srv.rev++; srv.saves++;
        res = { ok: true, rev: srv.rev };
      } else {
        res = { ok: false, rev: srv.rev, data: srv.read() };
      }
      if (net.loseAnswer) { net.loseAnswer = false; throw new Error("connection dropped"); }
      return res;
    },
  };

  const dev = { name, ctx, net, storage, warnings, renders: 0 };
  dev.sync = ctx.createSync({ state: ctx.load(), onChange: () => { dev.renders++; }, onPulled: () => {} });
  vm.runInContext("Math", ctx).random = realRandom;
  dev.start = (user = "u1") => dev.sync.start(user, api);
  dev.state = () => dev.sync.getState();
  dev.dispatch = (a) => dev.sync.dispatch(a);
  dev.flush = () => dev.sync.flush();
  dev.pull = () => dev.sync.pull();
  dev.persist = () => dev.sync.persist();
  return dev;
}

// ---- helpers ----
const tasks = (s) => s.projects.flatMap(p => p.tasks.map(t => ({ ...t, projectId: p.id })));
const taskByText = (s, text) => tasks(s).find(t => t.text === text);
const taskById = (s, id) => tasks(s).find(t => t.id === id);
const idCount = (s, id) => tasks(s).filter(t => t.id === id).length;
const habitByText = (s, text) => (s.habits || []).find(h => h.text === text);
const habitById = (s, id) => (s.habits || []).find(h => h.id === id);
const selBig = (s, dev) => vm.runInContext("selBigThree", dev.ctx)(s);
const hubCount = (s, hubId) => tasks(s).filter(t => t.hub && t.hub.id === hubId).length;
// sandbox arrays have their own Array.prototype, so compare them as JSON
const sameList = (a, b, msg) => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);

// Two devices on one fresh server: A goes first and seeds the row; B starts
// from its own (different) seed and takes the server's copy on its first pull.
async function twoDevices() {
  const srv = makeServer();
  const A = makeDevice("A", srv), B = makeDevice("B", srv);
  A.start(); await A.flush();
  assert.equal(srv.rev, 1, "A seeded the row");
  B.start(); await B.flush();
  sameList(tasks(B.state()).map(t => t.id), tasks(A.state()).map(t => t.id), "B took the server copy");
  return { srv, A, B };
}

const todayPlus = (dev, n) => vm.runInContext(`addDaysISO(todayISO(), ${n})`, dev.ctx);
const hubTask = (id, title, extra = {}) => ({ id, title, note: "", due: null, done: false, project: "Ops", section: "", ...extra });

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ============================================================
test("two devices edit different tasks: both edits kept", async () => {
  const { srv, A, B } = await twoDevices();
  const x = taskByText(A.state(), "Re-shoot hero photos"), y = taskByText(A.state(), "Reply to Diego");
  A.dispatch({ type: "EDIT_TASK_TEXT", taskId: x.id, text: "Re-shoot hero photos (A)" });
  B.dispatch({ type: "EDIT_TASK_NOTE", taskId: y.id, note: "note from B" });
  await A.flush();
  await B.flush();   // turned down (A saved first): B plays its edit on A's copy and saves
  const s = srv.read();
  assert.equal(taskById(s, x.id).text, "Re-shoot hero photos (A)");
  assert.equal(taskById(s, y.id).note, "note from B");
  await A.pull();
  assert.equal(taskById(A.state(), y.id).note, "note from B", "A sees B's edit after a pull");
  assert.equal(taskById(B.state(), x.id).text, "Re-shoot hero photos (A)", "B sees A's edit");
});

test("two devices add tasks at once: both kept, ids unchanged", async () => {
  const { srv, A, B } = await twoDevices();
  A.dispatch({ type: "ADD_TASK", projectId: "self", text: "added on A" });
  B.dispatch({ type: "ADD_TASK", projectId: "self", text: "added on B" });
  const idB = taskByText(B.state(), "added on B").id;
  B.dispatch({ type: "TODAY_ADD", taskId: idB, subId: null });   // points at the new id
  await A.flush(); await B.flush();
  const s = srv.read();
  assert.ok(taskByText(s, "added on A"));
  assert.equal(taskByText(s, "added on B").id, idB, "replay kept B's id");
  assert.ok(s.today.items.some(it => it.taskId === idB), "B's Today pick still points at its task");
});

test("same task, different fields: both changes kept", async () => {
  const { srv, A, B } = await twoDevices();
  const t = taskByText(A.state(), "Hire landscaper") || taskByText(A.state(), "Re-shoot hero photos");
  A.dispatch({ type: "EDIT_TASK_TEXT", taskId: t.id, text: "renamed on A" });
  B.dispatch({ type: "SET_DUE", taskId: t.id, due: "2030-01-15" });
  B.dispatch({ type: "EDIT_TASK_NOTE", taskId: t.id, note: "B's note" });
  await B.flush(); await A.flush();
  const got = taskById(srv.read(), t.id);
  assert.equal(got.text, "renamed on A");
  assert.equal(got.due, "2030-01-15");
  assert.equal(got.note, "B's note");
});

test("same task, same field: the later save wins, nothing else lost", async () => {
  const { srv, A, B } = await twoDevices();
  const t = taskByText(A.state(), "Reply to Diego");
  const u = taskByText(A.state(), "Harada method — pg 26");
  A.dispatch({ type: "EDIT_TASK_TEXT", taskId: t.id, text: "A's title" });
  A.dispatch({ type: "EDIT_TASK_NOTE", taskId: u.id, note: "A's other edit" });
  B.dispatch({ type: "EDIT_TASK_TEXT", taskId: t.id, text: "B's title" });
  await A.flush(); await B.flush();
  const s = srv.read();
  assert.equal(taskById(s, t.id).text, "B's title");
  assert.equal(taskById(s, u.id).note, "A's other edit");
});

test("both devices check the same step: it stays checked (toggles are pinned)", async () => {
  const { srv, A, B } = await twoDevices();
  const t = taskByText(A.state(), "Reply to Diego");
  A.dispatch({ type: "ADD_SUB", taskId: t.id, text: "draft" });
  await A.flush(); await B.pull();
  const sub = taskById(B.state(), t.id).subtasks[0];
  A.dispatch({ type: "TOGGLE_SUB", taskId: t.id, subId: sub.id });
  B.dispatch({ type: "TOGGLE_SUB", taskId: t.id, subId: sub.id });
  await A.flush(); await B.flush();
  const s = srv.read();
  assert.equal(taskById(s, t.id).subtasks[0].done, true);
  // (habit days: see "both devices check the same habit day")
});

test("both devices close the week: it closes once", async () => {
  const { srv, A, B } = await twoDevices();
  const n = A.state().week.n;
  A.dispatch({ type: "CLOSE_WEEK", journal: "from A" });
  B.dispatch({ type: "CLOSE_WEEK", journal: "from B" });
  await A.flush(); await B.flush();
  const s = srv.read();
  assert.equal(s.week.n, n + 1);
  assert.equal(s.history.length, 1);
  assert.equal(s.history[0].journal, "from A");
});

test("Hub sync lands on A mid-edit while B saves: all three kept, no copies", async () => {
  const { srv, A, B } = await twoDevices();
  const x = taskByText(A.state(), "Q3 roadmap draft"), y = taskByText(A.state(), "Order replacement linens");
  A.dispatch({ type: "EDIT_TASK_NOTE", taskId: x.id, note: "typing on A" });
  A.dispatch({ type: "HUB_SYNC", tasks: [hubTask("h1", "Hub: order towels")], gone: [], sent: [] });
  B.dispatch({ type: "HUB_SYNC", tasks: [hubTask("h1", "Hub: order towels")], gone: [], sent: [] });
  B.dispatch({ type: "EDIT_TASK_TEXT", taskId: y.id, text: "linens (B)" });
  await B.flush();
  await A.flush();
  const s = srv.read();
  assert.equal(taskById(s, x.id).note, "typing on A");
  assert.equal(taskById(s, y.id).text, "linens (B)");
  assert.equal(hubCount(s, "h1"), 1, "the Hub task is in once, not once per device");
});

test("Hub check-off on A while B renames the same linked task: both kept", async () => {
  const { srv, A, B } = await twoDevices();
  A.dispatch({ type: "HUB_SYNC", tasks: [hubTask("h2", "Call the roofer")], gone: [], sent: [] });
  await A.flush(); await B.pull();
  const id = tasks(B.state()).find(t => t.hub && t.hub.id === "h2").id;
  B.dispatch({ type: "EDIT_TASK_TEXT", taskId: id, text: "Call the roofer re: leak" });
  A.dispatch({ type: "HUB_SYNC", tasks: [hubTask("h2", "Call the roofer", { done: true })], gone: [], sent: [] });
  assert.equal(taskById(A.state(), id).status, "done", "the Hub's check-off landed on A");
  await B.flush(); await A.flush();
  const got = taskById(srv.read(), id);
  assert.equal(got.text, "Call the roofer re: leak");
  assert.equal(got.status, "done");
});

test("an action made while a save is in flight goes up in the next save", async () => {
  const { srv, A } = await twoDevices();
  const x = taskByText(A.state(), "Q3 roadmap draft");
  A.dispatch({ type: "EDIT_TASK_NOTE", taskId: x.id, note: "first" });
  let open; A.net.gate = new Promise(r => { open = r; });
  const saving = A.flush();
  await new Promise(r => setImmediate(r));
  A.dispatch({ type: "HUB_SYNC", tasks: [hubTask("h3", "Hub mid-save")], gone: [], sent: [] });
  A.net.gate = null; open(); await saving;
  assert.equal(taskById(srv.read(), x.id).note, "first");
  assert.equal(hubCount(srv.read(), "h3"), 0, "not in the save that was already out");
  await A.flush();
  assert.equal(hubCount(srv.read(), "h3"), 1);
  assert.equal(hubCount(A.state(), "h3"), 1);
});

test("a save that landed but whose answer was lost is not applied twice", async () => {
  const { srv, A, B } = await twoDevices();
  A.dispatch({ type: "ADD_TASK", projectId: "airbnb", text: "landed once" });
  const id = taskByText(A.state(), "landed once").id;
  A.net.loseAnswer = true;
  await A.flush();   // the server took it; A never heard back
  assert.ok(A.warnings.some(w => /connection dropped/.test(w)));
  B.dispatch({ type: "EDIT_TASK_NOTE", taskId: taskByText(B.state(), "Reply to Diego").id, note: "B meanwhile" });
  await B.flush();
  A.dispatch({ type: "EDIT_TASK_NOTE", taskId: id, note: "more on A" });
  await A.flush();
  const s = srv.read();
  assert.equal(idCount(s, id), 1, "one copy of the task");
  assert.equal(taskById(s, id).note, "more on A");
  assert.equal(taskByText(s, "Reply to Diego").note, "B meanwhile");
});

test("offline edits survive a reload and merge with the other device's", async () => {
  const { srv, A, B } = await twoDevices();
  A.net.offline = true;
  A.dispatch({ type: "ADD_TASK", projectId: "motion", text: "typed offline" });
  A.dispatch({ type: "EDIT_TASK_NOTE", taskId: taskByText(A.state(), "Q3 roadmap draft").id, note: "offline note" });
  await A.flush();
  A.persist();   // what the React effect does after each render
  B.dispatch({ type: "EDIT_TASK_TEXT", taskId: taskByText(B.state(), "Reply to Diego").id, text: "Reply to Diego (B)" });
  await B.flush();
  // reload A: a new page on the same browser storage
  const A2 = makeDevice("A2", srv, makeStorage(A.storage));
  assert.ok(taskByText(A2.state(), "typed offline"), "the cached copy paints with the offline edit");
  A2.start(); await A2.flush();
  const s = srv.read();
  assert.ok(taskByText(s, "typed offline"));
  assert.equal(taskByText(s, "Q3 roadmap draft").note, "offline note");
  assert.ok(taskByText(s, "Reply to Diego (B)"));
  assert.equal([...A2.storage.m.keys()].filter(k => k.startsWith("focus.sync.v1.")).length, 0, "no log left once saved");
});

test("two tabs that both took up a closed tab's log save it once", async () => {
  const { srv, A } = await twoDevices();
  A.net.offline = true;
  A.dispatch({ type: "ADD_TASK", projectId: "self", text: "from the closed tab" });
  await A.flush(); A.persist();
  const shared = makeStorage(A.storage);
  const T1 = makeDevice("T1", srv, shared), T2 = makeDevice("T2", srv, makeStorage(shared));   // both loaded before either saved
  T1.start(); T2.start();
  await T1.flush(); await T2.flush();
  assert.equal(tasks(srv.read()).filter(t => t.text === "from the closed tab").length, 1);
});

test("a write from a tab on the old code, before the new app's first save, is kept", async () => {
  const srv = makeServer();
  const L = makeDevice("L", srv);
  srv.oldWrite(JSON.parse(JSON.stringify(L.state())));   // the row as the old app left it
  const A = makeDevice("A", srv);
  A.start(); await A.flush();
  A.dispatch({ type: "EDIT_TASK_NOTE", taskId: taskByText(A.state(), "Q3 roadmap draft").id, note: "new code" });
  const old = srv.read();
  old.projects.forEach(p => p.tasks.forEach(t => { if (t.text === "Reply to Diego") t.text = "edited on an old tab"; }));
  srv.oldWrite(old);   // still allowed: the new app hasn't saved yet
  await A.flush();
  const s = srv.read();
  assert.ok(taskByText(s, "edited on an old tab"));
  assert.equal(taskByText(s, "Q3 roadmap draft").note, "new code");
});

test("after the new app's first save, an old tab's plain write is refused", async () => {
  const { srv, A } = await twoDevices();
  A.dispatch({ type: "ADD_TASK", projectId: "self", text: "saved by new code" });
  await A.flush();
  const stale = srv.read(); delete stale._sync;
  stale.projects.forEach(p => { p.tasks = p.tasks.filter(t => t.text !== "saved by new code"); });
  assert.throws(() => srv.oldWrite(stale), /old code/);
  assert.ok(taskByText(srv.read(), "saved by new code"));
});

test("reordering projects keeps a project the other device just added", async () => {
  const { srv, A, B } = await twoDevices();
  A.dispatch({ type: "ADD_PROJECT", name: "Garden" });
  await A.flush();
  B.dispatch({ type: "REORDER_PROJECTS", order: B.state().projects.map(p => p.id).reverse() });
  await B.flush();
  const s = srv.read();
  assert.ok(s.projects.some(p => p.name === "Garden"));
  assert.equal(s.projects[0].id, "self", "B's order still applied");
});

test("Hub tasks get the same id on every device, so edits land on the right one", async () => {
  const { srv, A, B } = await twoDevices();
  A.dispatch({ type: "HUB_SYNC", tasks: [hubTask("h1", "One")], gone: [], sent: [] });
  B.dispatch({ type: "HUB_SYNC", tasks: [hubTask("h1", "One"), hubTask("h2", "Two")], gone: [], sent: [] });
  const b1 = tasks(B.state()).find(t => t.hub && t.hub.id === "h1").id;
  B.dispatch({ type: "EDIT_TASK_NOTE", taskId: b1, note: "B's note on One" });
  await A.flush(); await B.flush();
  const s = srv.read();
  assert.equal(hubCount(s, "h1"), 1); assert.equal(hubCount(s, "h2"), 1);
  assert.equal(tasks(s).find(t => t.hub && t.hub.id === "h1").note, "B's note on One");
  assert.notEqual(tasks(s).find(t => t.hub && t.hub.id === "h2").note, "B's note on One");
});

test("an older Hub sync played after a newer one doesn't undo it", async () => {
  const { srv, A, B } = await twoDevices();
  A.dispatch({ type: "HUB_SYNC", at: 500, tasks: [hubTask("h1", "One")], gone: [], sent: [] });
  await A.flush(); await B.pull();
  B.dispatch({ type: "HUB_SYNC", at: 1000, tasks: [hubTask("h1", "One", { title: "One (renamed in Hub)" }), hubTask("h2", "Two")], gone: [], sent: [] });
  const id = tasks(A.state()).find(t => t.hub && t.hub.id === "h1").id;
  A.dispatch({ type: "SET_STATUS", taskId: id, status: "done" });
  A.dispatch({ type: "HUB_SYNC", at: 2000, tasks: [hubTask("h1", "One (renamed in Hub)", { done: true }), hubTask("h2", "Two")], gone: [], sent: [{ id: "h1", done: true }] });
  A.dispatch({ type: "EDIT_TASK_TEXT", taskId: id, text: "One, my words" });
  await A.flush(); await B.flush();
  const got = tasks(srv.read()).find(t => t.hub && t.hub.id === "h1");
  assert.equal(got.status, "done", "the confirmed check-off stays");
  assert.equal(got.text, "One, my words", "the local rename stays");
  assert.equal(hubCount(srv.read(), "h2"), 1);
});

test("offline edits across reloads keep their order, whatever the page ids", async () => {
  const { srv } = await twoDevices();
  const A1 = makeDevice("A1", srv, undefined, { random: () => 0.99 });
  A1.net.offline = true; A1.start(); await A1.flush();
  A1.dispatch({ type: "ADD_TASK", projectId: "self", id: "offline1", text: "made offline" });
  A1.persist();
  const A2 = makeDevice("A2", srv, makeStorage(A1.storage), { random: () => 0.01 });   // sorts first by page id
  A2.net.offline = true; A2.start(); await A2.flush();
  A2.dispatch({ type: "EDIT_TASK_NOTE", taskId: "offline1", note: "note after a reload" });
  A2.persist();
  const A3 = makeDevice("A3", srv, makeStorage(A2.storage));
  A3.start(); await A3.flush();
  assert.equal(taskById(srv.read(), "offline1").note, "note after a reload");
});

test("closing the quarter keeps a goal the other device just added", async () => {
  const { srv, A, B } = await twoDevices();
  A.dispatch({ type: "GOAL_ADD", scope: "quarter", text: "added on A" });
  await A.flush();
  const q = B.state().quarter;
  const hits = { [q.goals[0].id]: true };
  B.dispatch({ type: "ROLL_QUARTER", hits, next: { label: "Q9", range: "", goals: [] },
    archive: { label: q.label, range: q.range, goals: q.goals.map(g => ({ text: g.text, done: !!hits[g.id], subs: [] })), journal: "", closedAt: 1 } });
  await B.flush();
  const arch = srv.read().quarterHistory[0];
  assert.ok(arch.goals.some(g => g.text === "added on A"));
  assert.equal(arch.goals[0].done, true, "B's marks still applied");
  assert.equal(srv.read().quarter.label, "Q9");
});

test("first save to an empty server includes a closed tab's actions the cache lacked", async () => {
  const srv = makeServer();
  const shared = makeStorage();
  const T = makeDevice("T", srv, shared);            // a tab loaded before X's edit
  const X = makeDevice("X", srv, shared);
  X.net.offline = true; X.start(); await X.flush();
  X.dispatch({ type: "ADD_TASK", projectId: "self", id: "fromX", text: "from tab X" });
  X.persist();
  T.persist();                                        // T writes the cache last, without X's task
  assert.ok(!taskById(makeDevice("peek", srv, makeStorage(shared)).state(), "fromX"));
  const N = makeDevice("N", srv, makeStorage(shared));
  N.start(); await N.flush();
  assert.ok(taskById(srv.read(), "fromX"));
});

test("a recurring check-off made last week stays out of the new week; a habit's dated check stays put", async () => {
  const { srv, A, B } = await twoDevices();
  const habit = habitByText(B.state(), "Hold AM/PM routine all 7 days");
  const rec = taskByText(B.state(), "Reply to Diego");
  B.dispatch({ type: "TOGGLE_RECURRING", taskId: rec.id });
  await B.flush(); await A.pull();
  const day = "2026-05-30";
  B.dispatch({ type: "TOGGLE_HABIT_DATE", id: habit.id, dateISO: day });
  B.dispatch({ type: "SET_STATUS", taskId: rec.id, status: "done" });
  A.dispatch({ type: "CLOSE_WEEK", journal: "" });
  await A.flush(); await B.flush();
  const s = srv.read();
  assert.equal(habitById(s, habit.id).log[day], true, "the check keeps its date across the close");
  assert.equal(taskById(s, rec.id).status, "todo");
});

// ---- habits ----
test("habit tasks move out to the Habits card with their marks; the starting set is added", async () => {
  const srv = makeServer();
  const A = makeDevice("A", srv);
  const s = A.state();
  assert.equal(tasks(s).filter(t => t.type === "habit").length, 0, "no habit is left in a project");
  const arketa = habitByText(s, "Arketa — 1 hr/day");
  assert.equal(arketa.projectId, "motion", "it keeps its project as its tag");
  assert.equal(arketa.startISO, "2026-05-25", "it starts on the week its marks came from");
  sameList(Object.keys(arketa.log).sort(), ["2026-05-26", "2026-05-27", "2026-05-28"]);
  sameList(s.habits.map(h => h.id).filter(id => id.startsWith("habit-")), ["habit-breath", "habit-mahali"]);
  assert.equal(selBig(s, A).filter(Boolean).length, 2, "the habit in the Big Three leaves it");
});

test("two devices that both moved the habits out agree: one copy of each", async () => {
  const { srv, A, B } = await twoDevices();
  B.dispatch({ type: "EDIT_TASK_NOTE", taskId: taskByText(B.state(), "Reply to Diego").id, note: "B" });
  A.dispatch({ type: "EDIT_TASK_NOTE", taskId: taskByText(A.state(), "Reply to Diego").id, note: "A" });
  await A.flush(); await B.flush(); await A.pull();
  const s = srv.read();
  const ids = s.habits.map(h => h.id);
  assert.equal(new Set(ids).size, ids.length, "no habit twice");
  assert.equal(ids.length, 4);
  sameList(A.state().habits.map(h => h.id), ids);
});

test("a task made a habit, or one an old tab wrote into a project, moves to the Habits card", async () => {
  const { srv, A, B } = await twoDevices();
  const t = taskByText(A.state(), "Reply to Diego");
  A.dispatch({ type: "SET_TASK_TYPE", taskId: t.id, kind: "habit" });
  assert.equal(taskById(A.state(), t.id), undefined);
  assert.equal(habitById(A.state(), t.id).projectId, t.projectId);
  await A.flush();
  // a tab on the old code put a habit task back into a project
  const s0 = srv.read();
  s0.projects[0].tasks.push({ id: "oldhabit", text: "Old-tab habit", type: "habit", status: "todo", lane: "active", subtasks: [], days: [true, false, false, false, false, false, false], target: 5, recurring: true });
  srv.json = JSON.stringify(s0); srv.rev++;
  await B.pull();
  assert.equal(taskById(B.state(), "oldhabit"), undefined);
  assert.equal(habitById(B.state(), "oldhabit").projectId, s0.projects[0].id);
  assert.equal(habitById(B.state(), t.id).projectId, t.projectId, "B sees A's move");
});

test("both devices check the same habit day: it stays checked; archive and a check both land", async () => {
  const { srv, A, B } = await twoDevices();
  const h = A.state().habits[0];
  A.dispatch({ type: "TOGGLE_HABIT_DATE", id: h.id, dateISO: "2026-10-01" });
  B.dispatch({ type: "TOGGLE_HABIT_DATE", id: h.id, dateISO: "2026-10-01" });
  B.dispatch({ type: "TOGGLE_HABIT_DATE", id: h.id, dateISO: "2026-10-02" });
  A.dispatch({ type: "ARCHIVE_HABIT", id: h.id, archived: true });
  await A.flush(); await B.flush();
  const s = habitById(srv.read(), h.id);
  assert.equal(s.log["2026-10-01"], true);
  assert.equal(s.log["2026-10-02"], true);
  assert.equal(s.archived, true);
  assert.equal(s.startISO <= "2026-10-01", true, "checking a day before the start moves the start back");
});

test("a dragged habit lands where dropped, archived ones keep their places, and a replay moves it once", async () => {
  const { srv, A, B } = await twoDevices();
  A.dispatch({ type: "ADD_HABIT", text: "h3" });
  A.dispatch({ type: "ADD_HABIT", text: "h4" });
  A.dispatch({ type: "ARCHIVE_HABIT", id: "habit-mahali", archived: true });
  await A.flush(); await B.pull();
  const h3 = habitByText(A.state(), "h3").id;
  const ids = A.state().habits.map(h => h.id);
  const live = A.state().habits.filter(h => !h.archived).map(h => h.id);
  const slots = ids.map(id => id === "habit-mahali");   // where the archived one sits
  // the order a drop makes, with the index read as the list showed it
  const move = (list, id, to) => { const out = list.filter(x => x !== id), from = list.indexOf(id); out.splice(to > from ? to - 1 : to, 0, id); return out; };
  let want = live;
  // two moves in the middle, so playing them again would move them again
  A.dispatch({ type: "MOVE_HABIT", id: want[0], toIndex: 2 }); want = move(want, want[0], 2);
  A.dispatch({ type: "MOVE_HABIT", id: want[0], toIndex: 3 }); want = move(want, want[0], 3);
  B.dispatch({ type: "EDIT_HABIT_TEXT", id: h3, text: "h3 from B" });
  A.net.loseAnswer = true;
  await A.flush();
  const s0 = srv.read(); s0._sync = {}; srv.json = JSON.stringify(s0); srv.rev++;   // as if the note had been pruned
  const last = want[want.length - 1];
  A.dispatch({ type: "MOVE_HABIT", id: last, toIndex: 0 }); want = move(want, last, 0);   // the bottom one to the top
  await A.flush(); await B.flush();
  const s = srv.read();
  sameList(s.habits.filter(h => !h.archived).map(h => h.id), want);
  sameList(s.habits.map(h => h.archived), slots, "the archived habit kept its slot");
  assert.equal(habitById(s, h3).text, "h3 from B");
  const before = JSON.stringify(A.state().habits);
  A.dispatch({ type: "MOVE_HABIT", id: "habit-mahali", toIndex: 0 });   // archived: stays put
  assert.equal(JSON.stringify(A.state().habits), before);
});

test("an old-style habit check, text edit or delete still lands after the habit moved", async () => {
  const { srv, A } = await twoDevices();
  const h1 = habitById(A.state(), "habit-breath"), h2 = habitById(A.state(), "habit-mahali");
  const week = A.state().week.startISO;
  A.dispatch({ type: "TOGGLE_HABIT_DAY", taskId: h1.id, day: 2 });
  A.dispatch({ type: "EDIT_TASK_TEXT", taskId: h1.id, text: "renamed the old way" });
  A.dispatch({ type: "DELETE_TASK", taskId: h2.id });
  await A.flush();
  const s = srv.read();
  assert.equal(habitById(s, h1.id).log[vm.runInContext(`addDaysISO("${week}", 2)`, A.ctx)], true);
  assert.equal(habitById(s, h1.id).text, "renamed the old way");
  assert.equal(habitById(s, h2.id), undefined);
});

test("a task made a habit keeps its note and its start date, even replayed after the week closed", async () => {
  const { srv, A, B } = await twoDevices();
  const t = taskByText(A.state(), "Reply to Diego");
  A.dispatch({ type: "EDIT_TASK_NOTE", taskId: t.id, note: "keep me" });
  A.dispatch({ type: "SET_TASK_TYPE", taskId: t.id, kind: "habit" });
  const start = habitById(A.state(), t.id).startISO;
  assert.equal(start, vm.runInContext("todayISO()", A.ctx), "a converted task starts today");
  B.dispatch({ type: "CLOSE_WEEK", journal: "" });
  await B.flush(); await A.flush();   // A's save is turned down; its actions replay on B's closed week
  const h = habitById(srv.read(), t.id);
  assert.equal(h.note, "keep me");
  assert.equal(h.startISO, start);
});

test("a step B adds to a task A just moved to Habits becomes a to-do on that card", async () => {
  const { srv, A, B } = await twoDevices();
  const t = taskByText(A.state(), "Reply to Diego");
  A.dispatch({ type: "SET_TASK_TYPE", taskId: t.id, kind: "habit" });
  B.dispatch({ type: "ADD_SUB", taskId: t.id, text: "step from B" });
  await A.flush(); await B.flush();
  const s = srv.read();
  assert.equal(taskById(s, t.id), undefined, "the task moved");
  const todo = taskByText(s, "step from B");
  assert.ok(todo, "the step was kept");
  assert.equal(todo.projectId, t.projectId);
  assert.equal(tasks(s).filter(x => x.text === "step from B").length, 1);
});

test("a habit archived mid-week still shows its days in the close-week recap", async () => {
  const { srv, A } = await twoDevices();
  const h = habitById(A.state(), "habit-breath");
  const week = A.state().week.startISO;
  A.dispatch({ type: "TOGGLE_HABIT_DATE", id: h.id, dateISO: week });
  A.dispatch({ type: "ARCHIVE_HABIT", id: h.id, archived: true });
  A.dispatch({ type: "CLOSE_WEEK", journal: "" });
  await A.flush();
  assert.ok(srv.read().history[0].completed.some(c => c.text === h.text + " (1/7 days)"));
});

test("a habit added twice (its _sync note gone) is one habit; close-week lists the habit's days", async () => {
  const { srv, A } = await twoDevices();
  A.dispatch({ type: "ADD_HABIT", text: "habit once", projectId: "self" });
  A.net.loseAnswer = true;
  await A.flush();
  const s0 = srv.read(); s0._sync = {}; srv.json = JSON.stringify(s0); srv.rev++;
  const h = habitByText(A.state(), "habit once");
  const week = A.state().week.startISO;
  A.dispatch({ type: "TOGGLE_HABIT_DATE", id: h.id, dateISO: vm.runInContext(`addDaysISO("${week}", 1)`, A.ctx) });
  A.dispatch({ type: "CLOSE_WEEK", journal: "" });
  await A.flush();
  const s = srv.read();
  assert.equal(s.habits.filter(x => x.text === "habit once").length, 1);
  assert.ok(s.history[0].completed.some(c => c.text === "habit once (1/7 days)" && c.project === "Self"));
});

test("an add played twice (its _sync note gone) still makes one copy", async () => {
  const { srv, A } = await twoDevices();
  A.dispatch({ type: "ADD_TASK", projectId: "airbnb", text: "only once" });
  A.dispatch({ type: "ADD_SUB", taskId: taskByText(A.state(), "Reply to Diego").id, text: "step once" });
  A.dispatch({ type: "GOAL_ADD", scope: "quarter", text: "goal once" });
  A.dispatch({ type: "ADD_PROJECT", name: "Project once" });
  A.dispatch({ type: "ADD_SCHEDULED", text: "sched once" });
  A.net.loseAnswer = true;
  await A.flush();
  const s0 = srv.read(); s0._sync = {}; srv.json = JSON.stringify(s0); srv.rev++;   // as if the note had been pruned
  A.dispatch({ type: "EDIT_TASK_NOTE", taskId: taskByText(A.state(), "only once").id, note: "x" });
  await A.flush();
  const s = srv.read();
  assert.equal(tasks(s).filter(t => t.text === "only once").length, 1);
  assert.equal(taskByText(s, "Reply to Diego").subtasks.filter(x => x.text === "step once").length, 1);
  assert.equal(s.quarter.goals.filter(g => g.text === "goal once").length, 1);
  assert.equal(s.projects.filter(p => p.name === "Project once").length, 1);
  assert.equal(s.scheduled.filter(x => x.text === "sched once").length, 1);
});

test("a goal typed into a blank line that already saved survives a merge", async () => {
  const { srv, A, B } = await twoDevices();
  A.dispatch({ type: "GOAL_INSERT", scope: "quarter", id: "g-new", parentId: null, index: 0 });
  await A.flush();   // the blank line is on the server now
  B.dispatch({ type: "EDIT_TASK_NOTE", taskId: taskByText(B.state(), "Reply to Diego").id, note: "B" });
  await B.flush();
  A.dispatch({ type: "GOAL_EDIT", scope: "quarter", id: "g-new", text: "typed on A" });
  await A.flush();
  assert.ok(srv.read().quarter.goals.some(g => g.id === "g-new" && g.text === "typed on A"));
});

test("an offline page that took up a log, then reloaded, still sends it", async () => {
  const srv = makeServer();   // no server row yet
  const shared = makeStorage();
  const T = makeDevice("T", srv, shared);
  const X = makeDevice("X", srv, shared);
  X.net.offline = true; X.start(); await X.flush();
  X.dispatch({ type: "ADD_TASK", projectId: "self", id: "fromX", text: "from tab X" });
  X.persist();
  T.persist();   // the cache, written last, lacks X's task
  const N = makeDevice("N", srv, makeStorage(shared));
  N.net.offline = true; N.start(); await N.flush();
  N.persist();
  const N2 = makeDevice("N2", srv, makeStorage(N.storage));
  N2.start(); await N2.flush();
  assert.ok(taskById(srv.read(), "fromX"));
});

test("a step edited on A while B moved it to another task keeps A's edit", async () => {
  const { srv, A, B } = await twoDevices();
  const x = taskByText(A.state(), "Reply to Diego"), y = taskByText(A.state(), "Q3 roadmap draft");
  A.dispatch({ type: "ADD_SUB", taskId: x.id, text: "draft" });
  A.dispatch({ type: "ADD_SUB", taskId: x.id, text: "send" });
  await A.flush(); await B.pull();
  const [s1, s2] = taskById(A.state(), x.id).subtasks;
  A.dispatch({ type: "EDIT_SUB", taskId: x.id, subId: s1.id, text: "draft v2" });
  A.dispatch({ type: "TOGGLE_SUB", taskId: x.id, subId: s2.id });
  B.dispatch({ type: "MOVE_SUB_TO_TASK", fromTaskId: x.id, toTaskId: y.id, subId: s1.id, toIndex: null });
  B.dispatch({ type: "MOVE_SUB_TO_TASK", fromTaskId: x.id, toTaskId: y.id, subId: s2.id, toIndex: null });
  await B.flush(); await A.flush();
  const subs = taskById(srv.read(), y.id).subtasks;
  assert.equal(subs.find(z => z.id === s1.id).text, "draft v2");
  assert.equal(subs.find(z => z.id === s2.id).done, true);
});

test("a task A edits while B nests it into another task keeps A's edit", async () => {
  const { srv, A, B } = await twoDevices();
  const x = taskByText(A.state(), "Harada method — pg 26"), into = taskByText(A.state(), "Reply to Diego");
  A.dispatch({ type: "EDIT_TASK_TEXT", taskId: x.id, text: "Harada — pg 40" });
  A.dispatch({ type: "SET_STATUS", taskId: x.id, status: "done" });
  B.dispatch({ type: "NEST_TASK", taskId: x.id, intoTaskId: into.id });
  await B.flush(); await A.flush();
  const step = taskById(srv.read(), into.id).subtasks.find(z => z.id === x.id);
  assert.equal(step.text, "Harada — pg 40");
  assert.equal(step.done, true);
  assert.equal(taskById(srv.read(), x.id), undefined);
});

test("a step A checks while B makes it a task keeps the check", async () => {
  const { srv, A, B } = await twoDevices();
  const x = taskByText(A.state(), "Reply to Diego");
  A.dispatch({ type: "ADD_SUB", taskId: x.id, text: "call back" });
  await A.flush(); await B.pull();
  const sub = taskById(A.state(), x.id).subtasks[0];
  A.dispatch({ type: "TOGGLE_SUB", taskId: x.id, subId: sub.id });
  A.dispatch({ type: "EDIT_SUB", taskId: x.id, subId: sub.id, text: "call back today" });
  B.dispatch({ type: "PROMOTE_SUB_TO_TASK", fromTaskId: x.id, subId: sub.id, toProject: "self", toLane: "active", toIndex: null });
  await B.flush(); await A.flush();
  const t = taskById(srv.read(), sub.id);
  assert.ok(t, "the step became a task with the same id");
  assert.equal(t.status, "done");
  assert.equal(t.text, "call back today");
});

test("a goal edit made while B closed the quarter lands in the archive", async () => {
  const { srv, A, B } = await twoDevices();
  const g = A.state().quarter.goals[1];
  A.dispatch({ type: "GOAL_EDIT", scope: "quarter", id: g.id, text: "edited on A" });
  A.dispatch({ type: "GOAL_TOGGLE", scope: "quarter", id: g.id });
  const q = B.state().quarter;
  B.dispatch({ type: "ROLL_QUARTER", hits: {}, next: { label: "Q9", range: "", goals: [] },
    archive: { label: q.label, range: q.range, goals: [], journal: "", closedAt: 1 } });
  await B.flush(); await A.flush();
  const arch = srv.read().quarterHistory[0];
  const got = arch.goals.find(x => x.id === g.id);
  assert.equal(got.text, "edited on A");
  assert.equal(got.done, true);
  assert.equal(srv.read().quarter.goals.length, 0, "nothing leaked into the new quarter");
});

test("a Hub correction queued during a request is kept through a merge", async () => {
  const { srv, A, B } = await twoDevices();
  A.dispatch({ type: "HUB_SYNC", at: 100, tasks: [hubTask("h5", "Five")], gone: [], sent: [] });
  await A.flush(); await B.pull();
  const id = tasks(A.state()).find(t => t.hub && t.hub.id === "h5").id;
  A.dispatch({ type: "SET_STATUS", taskId: id, status: "done" });
  A.ctx.setHubInflight([{ id: "h5", done: true }]);   // that check-off is on its way to the Hub
  A.dispatch({ type: "SET_STATUS", taskId: id, status: "todo" });
  A.dispatch({ type: "DELETE_TASK", taskId: id });
  A.ctx.setHubInflight([]);
  A.dispatch({ type: "HUB_SYNC", at: 200, tasks: [hubTask("h5", "Five", { done: true })], gone: [], sent: [{ id: "h5", done: true }] });
  const want = JSON.stringify(A.state().hubOutbox);
  assert.equal(want, JSON.stringify([{ id: "h5", done: false }]));
  B.dispatch({ type: "EDIT_TASK_NOTE", taskId: taskByText(B.state(), "Reply to Diego").id, note: "B" });
  await B.flush(); await A.flush();
  assert.equal(JSON.stringify(srv.read().hubOutbox), want);
});

test("an old scheduled check-off doesn't undo the new period's", async () => {
  const { srv, A, B } = await twoDevices();
  const it = A.state().scheduled[0];
  A.dispatch({ type: "TOGGLE_SCHEDULED", id: it.id, periodKey: "2026-10-05", todayISO: "2026-10-11" });
  B.dispatch({ type: "TOGGLE_SCHEDULED", id: it.id, periodKey: "2026-10-12", todayISO: "2026-10-12" });
  await B.flush(); await A.flush();
  assert.equal(srv.read().scheduled[0].doneFor, "2026-10-12");
});

test("a Hub answer that arrives late doesn't undo a newer one", async () => {
  const { srv, A, B } = await twoDevices();
  A.dispatch({ type: "HUB_SYNC", at: 100, tasks: [hubTask("h6", "Six")], gone: [], sent: [] });
  await A.flush(); await B.pull();
  B.dispatch({ type: "HUB_SYNC", at: 2000, tasks: [hubTask("h6", "Six (new title)")], gone: [], sent: [] });
  await B.flush();
  A.dispatch({ type: "HUB_SYNC", at: 1000, tasks: [hubTask("h6", "Six (old title)")], gone: [], sent: [] });   // asked earlier, answered later
  await A.flush();
  assert.equal(tasks(srv.read()).find(t => t.hub && t.hub.id === "h6").text, "Six (new title)");
});

test("a Hub answer that lands after a pull brought a newer one is ignored", async () => {
  const { srv, A, B } = await twoDevices();
  A.dispatch({ type: "HUB_SYNC", at: 100, tasks: [hubTask("h7", "Seven")], gone: [], sent: [] });
  await A.flush(); await B.pull();
  B.dispatch({ type: "HUB_SYNC", at: 2000, tasks: [hubTask("h7", "Seven (new)")], gone: [], sent: [] });
  await B.flush();
  await A.pull();   // A now holds B's newer answer
  A.dispatch({ type: "HUB_SYNC", at: 1000, tasks: [hubTask("h7", "Seven (old)")], gone: [], sent: [] });
  await A.flush();
  assert.equal(tasks(A.state()).find(t => t.hub && t.hub.id === "h7").text, "Seven (new)");
  assert.equal(tasks(srv.read()).find(t => t.hub && t.hub.id === "h7").text, "Seven (new)");
});

test("a Hub task nested into a step isn't imported again", async () => {
  const { srv, A } = await twoDevices();
  A.dispatch({ type: "HUB_SYNC", at: 100, tasks: [hubTask("h8", "Eight")], gone: [], sent: [] });
  const id = tasks(A.state()).find(t => t.hub && t.hub.id === "h8").id;
  A.dispatch({ type: "NEST_TASK", taskId: id, intoTaskId: taskByText(A.state(), "Reply to Diego").id });
  A.dispatch({ type: "HUB_SYNC", at: 200, tasks: [hubTask("h8", "Eight")], gone: [], sent: [] });
  await A.flush();
  const s = srv.read();
  assert.equal(hubCount(s, "h8"), 0);
  assert.equal(tasks(s).filter(t => t.id === id).length + tasks(s).flatMap(t => t.subtasks).filter(x => x.id === id).length, 1, "one thing with that id");
});

test("a delete made while the other device converted the item still lands", async () => {
  const { srv, A, B } = await twoDevices();
  const x = taskByText(A.state(), "Reply to Diego"), y = taskByText(A.state(), "Harada method — pg 26");
  A.dispatch({ type: "ADD_SUB", taskId: x.id, text: "to delete" });
  await A.flush(); await B.pull();
  const sub = taskById(A.state(), x.id).subtasks[0];
  A.dispatch({ type: "DEL_SUB", taskId: x.id, subId: sub.id });
  A.dispatch({ type: "DELETE_TASK", taskId: y.id });
  B.dispatch({ type: "PROMOTE_SUB_TO_TASK", fromTaskId: x.id, subId: sub.id, toProject: "self", toLane: "active", toIndex: null });
  B.dispatch({ type: "NEST_TASK", taskId: y.id, intoTaskId: taskByText(B.state(), "Q3 roadmap draft").id });
  await B.flush(); await A.flush();
  const s = srv.read();
  assert.equal(taskById(s, sub.id), undefined);
  assert.equal(tasks(s).flatMap(t => t.subtasks).filter(z => z.id === y.id).length, 0);
});

test("a Hub check-off cached by the code before this one reaches the server", async () => {
  const { srv } = await twoDevices();
  const storage = makeStorage();
  const old = srv.read(); delete old._sync;
  old.hubOutbox = [{ id: "h9", done: true }];          // the live code's cache: no _cached note
  storage.setItem("focus.store.v1", JSON.stringify(old));
  const A0 = makeDevice("A0", srv, storage);
  A0.net.offline = true; A0.start(); await A0.flush();   // first load of the new code is offline…
  A0.persist();
  const A = makeDevice("A", srv, makeStorage(A0.storage));   // …then a reload, online
  A.start(); await A.flush();
  assert.equal(JSON.stringify(srv.read().hubOutbox), JSON.stringify([{ id: "h9", done: true }]));
  const B = makeDevice("B", srv, makeStorage(A.storage));   // a cache from the new code: no carry-over
  B.start(); await B.flush();
  assert.equal(srv.read().hubOutbox.length, 1);
});

test("Hub due dates stay in the Hub; notes don't say 'From the Hub'", async () => {
  const { srv, A } = await twoDevices();
  A.dispatch({ type: "HUB_SYNC", at: 100, tasks: [hubTask("h10", "Ten", { due: todayPlus(A, 2), project: "Ops", section: "Front desk", note: "call Sam" })], gone: [], sent: [] });
  let t = tasks(A.state()).find(x => x.hub && x.hub.id === "h10");
  assert.equal(t.due, null, "no due date comes over");
  assert.equal(t.lane, "queue", "so nothing promotes it to This Week");
  assert.equal(t.note, "Ops / Front desk — call Sam");
  A.dispatch({ type: "HUB_SYNC", at: 200, tasks: [hubTask("h10", "Ten", { due: todayPlus(A, 1) })], gone: [], sent: [] });
  assert.equal(tasks(A.state()).find(x => x.hub && x.hub.id === "h10").due, null, "a due changed in the Hub doesn't come over either");
  A.dispatch({ type: "SET_DUE", taskId: t.id, due: "2030-05-01" });
  A.dispatch({ type: "HUB_SYNC", at: 300, tasks: [hubTask("h10", "Ten", { due: todayPlus(A, 3) })], gone: [], sent: [] });
  assert.equal(tasks(A.state()).find(x => x.hub && x.hub.id === "h10").due, "2030-05-01", "a due set in Focus is kept");
  await A.flush();
  assert.equal(tasks(srv.read()).find(x => x.hub && x.hub.id === "h10").due, "2030-05-01");
});

test("tasks linked before the change lose the Hub's due date and the 'From the Hub' note", async () => {
  const { srv, A } = await twoDevices();
  // as the previous code left them
  const old = srv.read();
  const motion = old.projects.find(p => p.id === "motion");
  motion.tasks.push(
    { id: "hub-h11", text: "Eleven", status: "todo", note: "From the Hub · Ops — bring keys", big: null, lane: "active", subtasks: [], type: "todo",
      days: [false, false, false, false, false, false, false], target: 5, recurring: false, due: "2026-10-10", duePromoted: true,
      hub: { id: "h11", title: "Eleven", due: "2026-10-10", done: false } },
    { id: "hub-h12", text: "Twelve", status: "todo", note: "From the Hub", big: null, lane: "queue", subtasks: [], type: "todo",
      days: [false, false, false, false, false, false, false], target: 5, recurring: false, due: "2031-01-01", duePromoted: false,
      hub: { id: "h12", title: "Twelve", due: "2030-12-01", done: false } });
  srv.json = JSON.stringify(old); srv.rev++;
  await A.pull();
  A.dispatch({ type: "HUB_SYNC", at: 100, tasks: [hubTask("h11", "Eleven", { due: "2026-10-10" }), hubTask("h12", "Twelve", { due: "2030-12-01" })], gone: [], sent: [] });
  await A.flush();
  const s = srv.read();
  assert.equal(taskById(s, "hub-h11").due, null, "the Hub's date goes");
  assert.equal(taskById(s, "hub-h11").note, "Ops — bring keys");
  assert.equal(taskById(s, "hub-h12").due, "2031-01-01", "a date changed in Focus stays");
  assert.equal(taskById(s, "hub-h12").note, "");
  assert.equal(taskById(s, "hub-h11").hub.due, null);
  // the clean-up ran once: a note or date set here afterwards is left alone
  A.dispatch({ type: "EDIT_TASK_NOTE", taskId: "hub-h11", note: "From the Hub — keep this" });
  A.dispatch({ type: "SET_DUE", taskId: "hub-h11", due: "2026-10-10" });
  const revBefore = srv.rev;
  A.dispatch({ type: "HUB_SYNC", at: 200, tasks: [hubTask("h11", "Eleven", { due: "2026-10-10" }), hubTask("h12", "Twelve", { due: "2030-12-01" })], gone: [], sent: [] });
  await A.flush();
  assert.equal(taskById(srv.read(), "hub-h11").note, "From the Hub — keep this");
  assert.equal(taskById(srv.read(), "hub-h11").due, "2026-10-10");
  A.dispatch({ type: "HUB_SYNC", at: 300, tasks: [hubTask("h11", "Eleven"), hubTask("h12", "Twelve")], gone: [], sent: [] });
  await A.flush();
  assert.equal(srv.rev, revBefore + 1, "an unchanged sync saves nothing");
});

test("a Hub task keeps its Hub project's name (the card groups by it)", async () => {
  const { srv, A } = await twoDevices();
  A.dispatch({ type: "HUB_SYNC", at: 100, tasks: [hubTask("p1", "One", { project: "L10" }), hubTask("p2", "Two", { project: "" })], gone: [], sent: [] });
  const one = () => tasks(A.state()).find(t => t.hub && t.hub.id === "p1");
  assert.equal(one().hub.project, "L10");
  assert.equal(tasks(A.state()).find(t => t.hub && t.hub.id === "p2").hub.project, null, "no project: null");
  // a task linked before this change (no project in its snapshot) gets one
  // on the next sync, and a project moved in the Hub follows
  A.dispatch({ type: "HUB_SYNC", at: 200, tasks: [hubTask("p1", "One", { project: "Events" })], gone: [], sent: [] });
  assert.equal(one().hub.project, "Events");
  await A.flush();
  assert.equal(tasks(srv.read()).find(t => t.hub && t.hub.id === "p1").hub.project, "Events");
});

test("nothing is saved before the first pull works", async () => {
  const srv = makeServer();
  const A = makeDevice("A", srv);
  A.start(); await A.flush();
  const B = makeDevice("B", srv);
  B.net.offline = true;
  B.start(); await B.flush();
  B.dispatch({ type: "ADD_TASK", projectId: "self", text: "before first pull" });
  await B.flush();
  assert.equal(srv.rev, 1, "B, never having pulled, wrote nothing");
  B.net.offline = false;
  await B.flush();   // pulls first, plays its log on the server copy, saves
  const s = srv.read();
  assert.ok(taskByText(s, "before first pull"));
  sameList(tasks(s).filter(t => t.text !== "before first pull").map(t => t.id), tasks(A.state()).map(t => t.id),
    "B's own seed did not replace A's copy");
});

test("an unchanged pull doesn't touch the screen; no-op actions aren't logged", async () => {
  const { A } = await twoDevices();
  const before = A.renders;
  await A.pull();
  A.dispatch({ type: "DUE_TICK" });
  assert.equal(A.renders, before);
});

// ============================================================
let failed = 0;
for (const t of tests) {
  try { await t.fn(); console.log("ok   -", t.name); }
  catch (e) { failed++; console.log("FAIL -", t.name, "\n      ", e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n       ") : e); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
