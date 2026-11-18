import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { loadDashboard } from "@/lib/dashboardData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Everything the Dashboard shows (src/lib/dashboardData.ts). Admin only: the page guard refuses everyone else, and the database is asked as well.
export async function GET() {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const { data: admin } = await sb.rpc("is_admin"); if (!admin) return NextResponse.json({ error: "Only an Admin can open the dashboard." }, { status: 403 });
  try { return NextResponse.json(await loadDashboard(sb as any), { headers: { "cache-control": "private, no-store" } }); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}
