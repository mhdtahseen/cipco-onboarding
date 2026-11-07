import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { isUuid, sendSetupProblem, startRobot } from "@/lib/jslWorker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// An Admin presses "Send to the JSL portal". The bill is queued in the database first (inventory_jsl_queue checks that the person is an Admin and the bill is authorized),
// then GitHub is asked to start the robot. If GitHub cannot be reached the bill goes back to "authorized" and nothing has been sent.
export async function POST(req: NextRequest) {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser(); if (!u.user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const { data: admin } = await sb.rpc("is_admin"); if (!admin) return NextResponse.json({ error: "Only an Admin can send a bill to the JSL portal." }, { status: 403 });
  const { bill } = await req.json().catch(() => ({}));
  if (!isUuid(bill)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const problem = sendSetupProblem(); if (problem) return NextResponse.json({ error: `Sending is not set up yet. ${problem}` }, { status: 503 });
  const { error } = await sb.rpc("inventory_jsl_queue", { p_bill: bill });
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  const failed = await startRobot(bill);
  if (failed) { await sb.rpc("inventory_jsl_unqueue", { p_bill: bill, p_reason: failed }); return NextResponse.json({ error: `${failed} The bill is back to "authorized"; nothing was sent.` }, { status: 502 }); }
  return NextResponse.json({ ok: true });
}
