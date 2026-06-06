// ============================================================
// config.js — environment config. Loaded BEFORE supabase-js so
// these constants are on window when sync.jsx initializes.
//
// The publishable key is safe to expose in the browser — RLS on
// the app_state table is what protects the data. The Anthropic
// API key, when we add the AI proxy later, must NOT live here —
// it stays in a server-side env var on the Edge Function.
// ============================================================
window.SUPABASE_URL = "https://vaxltvzsqbedvjtoljnz.supabase.co";
window.SUPABASE_KEY = "sb_publishable_jtfOGXG9ejm1DoeflNLLLw_UnFhmkBH";
