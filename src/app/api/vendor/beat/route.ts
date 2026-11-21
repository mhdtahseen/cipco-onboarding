import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { deviceOf, ipOf } from "@/lib/usageServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The vendor page's "still here" signal (src/lib/vendorBeacon.ts), every minute while it is open and on screen. The database checks the link and the
// phone's session; this adds the device and network address (2026-11-vendor-activity.sql). Never fails loudly.
export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => null)) as { token?: string; session?: string; tab?: string; path?: string; lat?: number; lng?: number; acc?: number; geo?: string } | null;
  if (!b?.token || !/^[0-9a-f]{64}$/.test(b.token) || !b.session || typeof b.session !== "string" || !b.tab || typeof b.tab !== "string") return new NextResponse(null, { status: 204 });
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  try {
    await adminClient().rpc("vendor_usage_beat", { p_token: b.token, p_session: b.session.slice(0, 128), p_tab: b.tab.slice(0, 64), p_path: String(b.path || "").slice(0, 40), p_device: deviceOf(req), p_ip: ipOf(req),
      p_lat: num(b.lat), p_lng: num(b.lng), p_acc: num(b.acc), p_geo: typeof b.geo === "string" ? b.geo.slice(0, 20) : "" });
  } catch { /* nothing to tell the vendor */ }
  return new NextResponse(null, { status: 204 });
}
