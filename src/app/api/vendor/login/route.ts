import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { adminClient } from "@/lib/supabase/admin";
import { deviceOf, ipOf } from "@/lib/usageServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The vendor page's PIN check. The database decides (vendor_login, with the anon key, as before); this route only passes the answer back and records
// what happened (signed in, wrong PIN, locked out) with the device and network address for Users → Activity (2026-11-vendor-activity.sql).
export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => null)) as { token?: string; pin?: string } | null;
  if (!b?.token || !/^[0-9a-f]{64}$/.test(b.token) || typeof b.pin !== "string") return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.rpc("vendor_login", { p_token: b.token, p_pin: b.pin.slice(0, 6) });
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });
  const r = data as { ok: boolean; gone?: boolean; error?: string; why?: string | null };
  if (!r?.gone) {
    const kind = r?.ok ? "sign_in" : /Too many/.test(r?.error || "") ? "locked_out" : "wrong_pin";
    const detail = r?.ok ? (r.why === "temp" ? "with a temporary PIN" : r.why === "expired" ? "PIN 30 days old" : "") : "";
    try { await adminClient().rpc("vendor_usage_event", { p_token: b.token, p_session: null, p_kind: kind, p_device: deviceOf(req), p_ip: ipOf(req), p_detail: detail }); } catch { /* never blocks a sign-in */ }
  }
  return NextResponse.json(data);
}
