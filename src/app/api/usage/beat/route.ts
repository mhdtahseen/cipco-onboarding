import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import { deviceOf, ipOf } from "@/lib/usageServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The app's "still here" signal (src/lib/usageBeacon.ts), sent every minute while it is open and on screen. Recorded against the signed-in person
// with the device and network address read here (2026-11-usage-activity.sql). Never fails loudly: it must not get in anyone's way.
export async function POST(req: NextRequest) {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser(); if (!u.user) return new NextResponse(null, { status: 204 });
  const b = (await req.json().catch(() => null)) as { tab?: string; path?: string; app?: boolean; lat?: number; lng?: number; acc?: number; geo?: string } | null;
  if (!b?.tab || typeof b.tab !== "string") return new NextResponse(null, { status: 204 });
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  try {
    await adminClient().rpc("usage_beat", { p_user: u.user.id, p_tab: b.tab.slice(0, 64), p_path: String(b.path || "").slice(0, 120), p_device: deviceOf(req, !!b.app), p_ip: ipOf(req),
      p_lat: num(b.lat), p_lng: num(b.lng), p_acc: num(b.acc), p_geo: typeof b.geo === "string" ? b.geo.slice(0, 20) : "" });
  } catch { /* nothing to report to the person using the app */ }
  return new NextResponse(null, { status: 204 });
}
