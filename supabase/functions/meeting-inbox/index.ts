// ============================================================
// meeting-inbox — Edge Function backing the Meeting Inbox strip.
//
// The Granola→inbox pipeline runs on Ryan's machine as a local
// scheduled Claude task. It has no Supabase auth session, so it
// talks to this function instead, guarded by a shared secret
// (INBOX_SECRET, set via `supabase secrets set`). The function
// holds the service-role key and is the only insert path into
// meeting_inbox; the app itself only ever selects/updates its
// own rows through RLS.
//
// POST JSON, header `x-inbox-secret: <secret>`:
//   { "action": "migrate" }              — create tables/policies (idempotent)
//   { "action": "status" }               — list already-processed meeting ids
//   { "action": "add", "meeting_id", "meeting_title", "meeting_date",
//     "items": [{ "text", "note", "owner" }] }
//     — insert items (deduped on meeting_id+text) and mark the
//       meeting processed. items may be [] to mark-only (e.g. a
//       meeting titled "don't process").
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import postgres from "npm:postgres@3.4.5";

const SECRET = Deno.env.get("INBOX_SECRET") ?? "";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const DDL = `
create table if not exists public.meeting_inbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  meeting_id text not null,
  meeting_title text default '',
  meeting_date timestamptz,
  text text not null,
  note text default '',
  owner text default '',
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  unique (meeting_id, text)
);
create table if not exists public.processed_meetings (
  meeting_id text primary key,
  meeting_title text default '',
  processed_at timestamptz not null default now()
);
alter table public.meeting_inbox enable row level security;
alter table public.processed_meetings enable row level security;
drop policy if exists inbox_select_own on public.meeting_inbox;
create policy inbox_select_own on public.meeting_inbox
  for select using (auth.uid() = user_id);
drop policy if exists inbox_update_own on public.meeting_inbox;
create policy inbox_update_own on public.meeting_inbox
  for update using (auth.uid() = user_id);
drop policy if exists inbox_delete_own on public.meeting_inbox;
create policy inbox_delete_own on public.meeting_inbox
  for delete using (auth.uid() = user_id);
`;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!SECRET || req.headers.get("x-inbox-secret") !== SECRET) {
    return json({ error: "unauthorized" }, 401);
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body.action !== "string") {
    return json({ error: "bad request" }, 400);
  }

  if (body.action === "migrate") {
    const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false });
    try {
      await sql.unsafe(DDL);
      return json({ ok: true, migrated: true });
    } finally {
      await sql.end();
    }
  }

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (body.action === "status") {
    const { data, error } = await supa
      .from("processed_meetings")
      .select("meeting_id");
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, processed: data.map((r) => r.meeting_id) });
  }

  if (body.action === "add") {
    const { meeting_id, meeting_title = "", meeting_date = null } = body;
    const items = Array.isArray(body.items) ? body.items : [];
    if (!meeting_id) return json({ error: "meeting_id required" }, 400);

    // single-user app: the inbox belongs to whoever owns the app_state row
    const { data: owner, error: ownerErr } = await supa
      .from("app_state").select("user_id").limit(1).single();
    if (ownerErr || !owner) return json({ error: "no app_state owner row" }, 500);

    let inserted = 0;
    if (items.length) {
      const rows = items
        .filter((it) => it && typeof it.text === "string" && it.text.trim())
        .map((it) => ({
          user_id: owner.user_id,
          meeting_id,
          meeting_title,
          meeting_date,
          text: it.text.trim(),
          note: (it.note || "").trim(),
          owner: (it.owner || "").trim(),
        }));
      const { error, count } = await supa
        .from("meeting_inbox")
        .upsert(rows, {
          onConflict: "meeting_id,text",
          ignoreDuplicates: true,
          count: "exact",
        });
      if (error) return json({ error: error.message }, 500);
      inserted = count ?? rows.length;
    }

    const { error: pmErr } = await supa
      .from("processed_meetings")
      .upsert({ meeting_id, meeting_title }, { onConflict: "meeting_id" });
    if (pmErr) return json({ error: pmErr.message }, 500);

    return json({ ok: true, inserted });
  }

  return json({ error: "unknown action" }, 400);
});
