import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import { sendPush } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Called by the app after anything changes a project's gas stock. If a gas is at or below its warning level (Vendors & rates), Operations and the Admin get a phone
// notification, at most once a day per gas per project (2026-11-gas-site-roles.sql). Quiet by design: it never gets in the way of the entry that triggered it.
export async function POST(req: NextRequest) {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser(); if (!u.user) return new NextResponse(null, { status: 204 });
  const b = (await req.json().catch(() => null)) as { project_id?: string } | null; const pid = b?.project_id;
  if (!pid || !/^[0-9a-f-]{36}$/.test(pid)) return new NextResponse(null, { status: 204 });
  const { data: ok } = await sb.rpc("can_attend", { p_project: pid }); if (!ok) return new NextResponse(null, { status: 204 });
  try {
    const db = adminClient(); const { data: low, error } = await db.rpc("gas_low_stock", { p_project: pid }); if (error || !low?.length) return NextResponse.json({ low: [] });
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Kolkata" }); const fresh: { name: string; full_count: number; alert_full: number }[] = [];
    for (const g of low as { product_id: string; name: string; full_count: number; alert_full: number }[]) {
      const { error: e } = await db.from("gas_alerts").insert({ project_id: pid, product_id: g.product_id, alerted_on: today, full_count: g.full_count });
      if (!e) fresh.push(g);   // already warned today: the unique day row refuses it
    }
    if (fresh.length) {
      const [{ data: proj }, { data: staff }] = await Promise.all([db.from("projects").select("name").eq("id", pid).maybeSingle(), db.from("user_roles").select("user_id").in("role", ["admin", "staff"])]);
      const body = fresh.map((g) => `${g.name}: ${g.full_count} full cylinder${g.full_count === 1 ? "" : "s"} left`).join(" · ") + ". Arrange a refill.";
      await sendPush(((staff || []) as { user_id: string }[]).map((x) => x.user_id), { title: `Gas running low · ${proj?.name ?? "site"}`, body, url: "/site-supplies", tag: `gas-low-${pid}` }).catch(() => null);
    }
    return NextResponse.json({ low: fresh.map((g) => g.name) });
  } catch { return new NextResponse(null, { status: 204 }); }
}
