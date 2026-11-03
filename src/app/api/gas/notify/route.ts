import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { sendPush } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tells the right people about a gas order: Operations and Admin when a Site Engineer raises one, the Site Engineer when it is approved or rejected.
// Never an error the person must act on: the order is already saved, this only delivers the message.
export async function POST(req: NextRequest) {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser(); if (!u.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const b = await req.json().catch(() => null) as { order_id?: string; event?: "requested" | "decided" } | null;
  if (!b?.order_id || !/^[0-9a-f-]{36}$/.test(b.order_id) || (b.event !== "requested" && b.event !== "decided")) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const { data: o } = await sb.from("gas_orders").select("order_no, status, requested_by, reject_reason, projects(name)").eq("id", b.order_id).maybeSingle();
  if (!o) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  const project = ((o as any).projects?.name as string) || "a project"; let to: string[] = []; let payload;
  if (b.event === "requested") {
    if (o.requested_by !== u.user.id) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
    const { data: r } = await sb.rpc("gas_order_recipients"); to = ((r || []) as { user_id: string }[]).map((x) => x.user_id).filter((x) => x !== u.user!.id);
    payload = { title: "Gas order to approve", body: `${o.order_no} for ${project}`, url: "/gas", tag: `gas-${o.order_no}` };
  } else {
    const { data: ok } = await sb.rpc("is_staff"); if (!ok) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
    if (!["approved", "rejected"].includes(o.status) || !o.requested_by) return NextResponse.json({ ok: true, sent: 0 });
    to = [o.requested_by as string];
    payload = { title: o.status === "approved" ? "Gas order approved" : "Gas order rejected", body: `${o.order_no} for ${project}${o.status === "rejected" && o.reject_reason ? `: ${o.reject_reason}` : ""}`, url: "/gas", tag: `gas-${o.order_no}` };
  }
  try { await sendPush(to, payload); } catch { /* the order is saved either way */ }
  return NextResponse.json({ ok: true });
}
