import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** POST { id } → gives a saved draft its reference number and locks it. Issuing twice is a no-op. */
export async function POST(req: NextRequest) {
  const sb = await serverClient();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await req.json();
  const { data: q } = await sb.from("quotations").select("id,status,ref_no,client_name,items").eq("id", id).single();
  if (!q) return NextResponse.json({ error: "Quotation not found" }, { status: 404 });
  if (q.status === "issued") return NextResponse.json({ ref_no: q.ref_no });
  if (!q.client_name?.trim() || !Array.isArray(q.items) || !q.items.length) return NextResponse.json({ error: "Add the client and at least one line item first." }, { status: 400 });
  const { data: ref, error: refErr } = await sb.rpc("next_ref", { p_kind: "quotation" });
  if (refErr) return NextResponse.json({ error: refErr.message }, { status: 500 });
  const { error } = await sb.from("quotations").update({ status: "issued", ref_no: ref, updated_at: new Date().toISOString() }).eq("id", id).eq("status", "draft");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ref_no: ref });
}
