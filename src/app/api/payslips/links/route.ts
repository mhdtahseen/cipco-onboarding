import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { SLIP_LINK_DAYS, signSlip } from "@/lib/slipLink";

// The private, expiring salary-slip links for one approved payroll run, one per person, for sending on WhatsApp. Admin only, like payroll.
export async function GET(req: NextRequest) {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser(); if (!u.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { data: admin } = await sb.rpc("is_admin"); if (!admin) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const run = req.nextUrl.searchParams.get("run") || ""; if (!/^[0-9a-f-]{36}$/.test(run)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const { data: r } = await sb.from("payroll_runs").select("status").eq("id", run).maybeSingle(); if (!r) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  if (r.status !== "approved") return NextResponse.json({ error: "Approve the payroll first." }, { status: 409 });
  const { data: lines } = await sb.from("payroll_lines").select("id").eq("run_id", run);
  const links: Record<string, string> = {}; (lines || []).forEach((l: { id: string }) => { links[l.id] = `${req.nextUrl.origin}/api/slip/${signSlip(l.id)}`; });
  return NextResponse.json({ links, days: SLIP_LINK_DAYS });
}
