import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { isUuid, workerAllowed } from "@/lib/jslWorker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The robot asks for the job for one bill. It is given once per send, and only while the bill is waiting for the robot (see inventory_jsl_job).
// The answer holds ID numbers, so it is never logged, and the route is open only to the robot's key.
export async function POST(req: NextRequest) {
  if (!workerAllowed(req)) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const { bill } = await req.json().catch(() => ({}));
  if (!isUuid(bill)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const { data, error } = await adminClient().rpc("inventory_jsl_job", { p_bill: bill });
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  return NextResponse.json({ job: data }, { headers: { "cache-control": "no-store" } });
}
