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
  // a write by a tab still on the old code: a plain upsert, no rev check
  srv.oldWrite = (data) => { srv.json = JSON.stringify(data); srv.rev++; };
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

function makeDevice(name, srv, storage = makeStorage()) {
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
  const habit = taskByText(A.state(), "Arketa — 1 hr/day");
  A.dispatch({ type: "TOGGLE_HABIT_DAY", taskId: habit.id, day: 0 });
  B.dispatch({ type: "TOGGLE_HABIT_DAY", taskId: habit.id, day: 0 });
  await A.flush(); await B.flush();
  const s = srv.read();
  assert.equal(taskById(s, t.id).subtasks[0].done, true);
  assert.equal(taskById(s, habit.id).days[0], true);
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

test("a write from a tab still on the old code is not overwritten", async () => {
  const { srv, A } = await twoDevices();
  const old = srv.read();
  old.projects.forEach(p => p.tasks.forEach(t => { if (t.text === "Reply to Diego") t.text = "edited on an old tab"; }));
  srv.oldWrite(old);
  A.dispatch({ type: "EDIT_TASK_NOTE", taskId: taskByText(A.state(), "Q3 roadmap draft").id, note: "new code" });
  await A.flush();
  const s = srv.read();
  assert.ok(taskByText(s, "edited on an old tab"));
  assert.equal(taskByText(s, "Q3 roadmap draft").note, "new code");
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
