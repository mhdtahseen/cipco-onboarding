import { createClient } from "@supabase/supabase-js";

// Server only. The service key bypasses every access rule, so it is used for exactly two jobs: reading the phones that agreed to notifications, and
// the scheduled day check. It must never be sent to the browser (it has no NEXT_PUBLIC_ prefix, so Next never includes it in the pages).
export function adminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
