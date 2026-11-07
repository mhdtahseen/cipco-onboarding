import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { isUuid, workerAllowed } from "@/lib/jslWorker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The robot's progress: submitting (about to press Save, with the requisition number the form showed), submitted (the Report shows it), failed (nothing saved) or needs_check.
// The database decides which moves are allowed (inventory_jsl_report): a bill cannot be called failed once Save may have been pressed.
const STAGES = ["submitting", "submitted", "failed", "needs_check"];
export async function POST(req: NextRequest) {
  if (!workerAllowed(req)) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (!isUuid(b.bill) || !STAGES.includes(b.stage)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const { error } = await adminClient().rpc("inventory_jsl_report", { p_bill: b.bill, p_stage: b.stage, p_ref: typeof b.ref === "string" ? b.ref.slice(0, 40) : null, p_detail: typeof b.detail === "string" ? b.detail.slice(0, 300) : null });
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  return NextResponse.json({ ok: true });
}
