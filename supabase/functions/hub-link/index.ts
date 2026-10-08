// ============================================================
// hub-link — Edge Function between Focus and the MOTION Employee Hub.
//
// The Focus page (hublink.jsx) calls it signed in as Ryan, with
//   { "changes": [{ "id": "<hub task id>", "done": true }], "known": ["<hub task id>", …] }
// It checks the caller owns the Focus data, then calls the Hub's
// focus_link_sync() RPC with a shared secret. The Hub applies the
// check-offs to Ryan's tasks only and returns his task list:
//   { "applied": n, "tasks": [{ id, title, note, due, done, project, section }], "gone": [ids] }
// which goes back to the page with "at" added: this server's clock when the
// Hub answered. One clock for every device, so the page can tell an older
// answer from a newer one (see HUB_SYNC in store.jsx).
//
// Secrets (`supabase secrets set --project-ref vaxltvzsqbedvjtoljnz …`):
//   HUB_URL          https://dtzbhofbmfujlyqxbeku.supabase.co
//   HUB_ANON_KEY     the Hub's public anon key (the same one its web app ships)
//   HUB_LINK_SECRET  the shared secret; the Hub keeps only its SHA-256
// The page never sees the secret, and the Hub key alone can do nothing here.
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const HUB_URL = (Deno.env.get("HUB_URL") ?? "").replace(/\/+$/, "");
const HUB_ANON_KEY = Deno.env.get("HUB_ANON_KEY") ?? "";
const HUB_LINK_SECRET = Deno.env.get("HUB_LINK_SECRET") ?? "";
// Anyone can sign in to Focus (Google / magic link) and get their own
// app_state row, so owning a row is not enough: only Ryan's account may sync.
const OWNER_EMAIL = (Deno.env.get("FOCUS_OWNER_EMAIL") ?? "rbonhardt@gmail.com").toLowerCase();

const ALLOWED_ORIGINS = new Set([
  "https://goals.ryanbonhardt.com",
  "http://localhost:8123", // goals-static preview
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ITEMS = 2000; // linked tasks leave Focus at Close week, so real use stays far below

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    ...(ALLOWED_ORIGINS.has(origin) ? { "access-control-allow-origin": origin, vary: "origin" } : {}),
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  };
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!HUB_URL || !HUB_ANON_KEY || !HUB_LINK_SECRET) return json({ error: "hub link is not set up" }, 500);

  // Who is calling: must be signed in as Ryan (confirmed email), and own
  // Focus data.
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "sign in first" }, 401);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: auth, error: authErr } = await admin.auth.getUser(jwt);
  if (authErr || !auth?.user) return json({ error: "sign in first" }, 401);
  if ((auth.user.email ?? "").toLowerCase() !== OWNER_EMAIL || !auth.user.email_confirmed_at) {
    return json({ error: "not allowed" }, 403);
  }
  const { data: owner, error: ownerErr } = await admin
    .from("app_state").select("user_id").eq("user_id", auth.user.id).maybeSingle();
  if (ownerErr) return json({ error: ownerErr.message }, 500);
  if (!owner) return json({ error: "not allowed" }, 403);

  const body = await req.json().catch(() => null);
  // Too many to send in one go: say so, rather than drop some silently.
  if ((Array.isArray(body?.changes) && body.changes.length > MAX_ITEMS)
      || (Array.isArray(body?.known) && body.known.length > MAX_ITEMS)) {
    return json({ error: `more than ${MAX_ITEMS} linked tasks` }, 413);
  }
  const changes = (Array.isArray(body?.changes) ? body.changes : [])
    .filter((c: unknown): c is { id: string; done: boolean } =>
      !!c && typeof (c as { id?: unknown }).id === "string" && UUID.test((c as { id: string }).id)
      && typeof (c as { done?: unknown }).done === "boolean")
    .map((c: { id: string; done: boolean }) => ({ id: c.id, done: c.done }));
  const known = (Array.isArray(body?.known) ? body.known : [])
    .filter((id: unknown): id is string => typeof id === "string" && UUID.test(id));

  const res = await fetch(`${HUB_URL}/rest/v1/rpc/focus_link_sync`, {
    method: "POST",
    headers: {
      apikey: HUB_ANON_KEY,
      authorization: `Bearer ${HUB_ANON_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ p_secret: HUB_LINK_SECRET, p_changes: changes, p_known: known }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error("[hub-link] hub said", res.status, text.slice(0, 500));
    return json({ error: "the Hub did not answer", status: res.status }, 502);
  }
  let out: Record<string, unknown>;
  try { out = JSON.parse(text); } catch { return json({ error: "the Hub sent something odd" }, 502); }
  return json({ ...out, at: Date.now() });
});
