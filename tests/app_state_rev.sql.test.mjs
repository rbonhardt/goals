// ============================================================
// app_state_rev.sql.test.mjs — the migration on a throwaway Postgres.
//
// Run:  PGLITE=<dir with node_modules/@electric-sql/pglite> node tests/app_state_rev.sql.test.mjs
// (e.g. npm i --prefix /tmp/pg @electric-sql/pglite, then PGLITE=/tmp/pg).
// It stands in for Supabase (auth.uid(), anon / authenticated, the table and
// its "own row" policy as they are today), applies the migration twice, and
// checks the compare-and-set, old-code writes, RLS and grants.
// ============================================================
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const req = createRequire(path.join(process.env.PGLITE || process.cwd(), "noop.js"));
const { PGlite } = await import(req.resolve("@electric-sql/pglite"));
const MIGRATION = path.join(path.dirname(fileURLToPath(import.meta.url)), "../supabase/migrations/20261008120000_app_state_rev.sql");
const db = new PGlite();
const U1 = "11111111-1111-1111-1111-111111111111", U2 = "22222222-2222-2222-2222-222222222222";
// a stand-in for Supabase: auth.uid(), the two API roles, the table as it is today
await db.exec(`
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create role anon; create role authenticated;
grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
create table public.app_state (user_id uuid primary key, data jsonb, updated_at timestamptz default now());
alter table public.app_state enable row level security;
create policy "own row" on public.app_state for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant all on public.app_state to anon, authenticated;
create function public.app_state_touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create trigger app_state_touch_updated_at before update on public.app_state for each row execute function app_state_touch_updated_at();
insert into public.app_state (user_id, data) values ('${U1}', '{"v":"before"}');
`);
await db.exec(readFileSync(MIGRATION, "utf8"));
await db.exec(readFileSync(MIGRATION, "utf8"));   // applying twice is harmless
const as = async (role, uid, sql, params) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ""}', false); set role ${role};`);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec("reset role"); }
};
const save = (uid, rev, data) => as("authenticated", uid, "select public.app_state_save($1, $2) r", [rev, data]).then(r => r[0].r);

let r = (await db.query("select rev from app_state")).rows; assert.equal(r[0].rev, 0, "existing row starts at rev 0");
r = await save(U1, 0, { v: 1 });            assert.deepEqual(r, { ok: true, rev: 1 });
r = await save(U1, 1, { v: 2 });            assert.deepEqual(r, { ok: true, rev: 2 });
r = await save(U1, 1, { v: "stale" });      assert.deepEqual(r, { ok: false, rev: 2, data: { v: 2 } }, "stale rev turned down, newer copy back");
// a tab on the old code, before the new app saved (no _sync yet): a plain upsert still works, and still counts
const oldUpsert = (data) => as("authenticated", U1, "insert into public.app_state (user_id, data) values ($1, $2) on conflict (user_id) do update set data = excluded.data", [U1, data]);
await oldUpsert({ v: "old tab" });
r = await save(U1, 2, { v: "x" });          assert.deepEqual(r, { ok: false, rev: 3, data: { v: "old tab" } }, "old-code write bumped rev");
r = await save(U1, 3, { v: 4, _sync: {} }); assert.deepEqual(r, { ok: true, rev: 4 });
// after the new app's save: a plain write is refused, and the GUC does not leak to the next statement
await assert.rejects(oldUpsert({ v: "old tab again", _sync: {} }), /old code/);
await assert.rejects(as("authenticated", U1, "update public.app_state set data = '{}'::jsonb"), /old code/);
r = await save(U1, 4, { v: 4 });            assert.deepEqual(r, { ok: true, rev: 5 });
// a new user: first save at rev 0 makes the row; a second rev-0 save is turned down
r = await save(U2, 0, { v: "u2" });         assert.deepEqual(r, { ok: true, rev: 1 });
r = await save(U2, 0, { v: "u2 again" });   assert.deepEqual(r, { ok: false, rev: 1, data: { v: "u2" } });
// no row and a rev that isn't 0
await db.exec(`delete from app_state where user_id = '${U2}'`);
r = await save(U2, 5, { v: "?" });          assert.deepEqual(r, { ok: false, rev: null, data: null });
// RLS: one user can't see or write the other's row through the function
const u1 = (await db.query(`select data, rev from app_state where user_id = '${U1}'`)).rows[0];
assert.deepEqual(u1, { data: { v: 4 }, rev: 5 }, "U2's saves never touched U1's row");
// signed out / anon
await assert.rejects(save(null, 5, { v: "anon" }), /not signed in/);
await assert.rejects(as("anon", U1, "select public.app_state_save(5, '{}'::jsonb)"), /permission denied/);
await assert.rejects(save(U1, 5, null), /no data/);
// a hand edit with the setting on goes through
await db.exec("begin; select set_config('focus.app_state_save', 'on', true); update public.app_state set data = data || '{\"hand\": 1}'::jsonb where user_id = '" + U1 + "'; commit;");
assert.equal((await db.query(`select rev from app_state where user_id = '${U1}'`)).rows[0].rev, 6);
console.log("sql: all checks passed");
