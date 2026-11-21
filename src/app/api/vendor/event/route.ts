import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { deviceOf, ipOf } from "@/lib/usageServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Signed out / chose a PIN, from the vendor page, for Users → Activity (2026-11-vendor-activity.sql). The database checks the phone's session.
export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => null)) as { token?: string; session?: string; kind?: string; detail?: string } | null;
  if (!b?.token || !/^[0-9a-f]{64}$/.test(b.token) || typeof b.session !== "string" || (b.kind !== "sign_out" && b.kind !== "pin_set")) return new NextResponse(null, { status: 204 });
  const detail = b.detail === "changed" ? "changed their PIN" : b.detail === "expired" ? "new PIN after 30 days" : b.detail === "temp" ? "chose their own PIN" : "";
  try { await adminClient().rpc("vendor_usage_event", { p_token: b.token, p_session: b.session.slice(0, 128), p_kind: b.kind, p_device: deviceOf(req), p_ip: ipOf(req), p_detail: detail }); } catch { /* never in the way */ }
  return new NextResponse(null, { status: 204 });
}
