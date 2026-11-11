import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import { deviceOf, ipOf } from "@/lib/usageServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sign in / sign out, recorded for the person themselves; "signed out by an Admin" is recorded by the Admin who did it, for the other person.
export async function POST(req: NextRequest) {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser(); if (!u.user) return new NextResponse(null, { status: 204 });
  const b = (await req.json().catch(() => null)) as { kind?: string; user_id?: string; app?: boolean } | null;
  const kind = b?.kind;
  if (kind !== "sign_in" && kind !== "sign_out" && kind !== "signed_out_by_admin") return NextResponse.json({ error: "Bad request." }, { status: 400 });
  let target = u.user.id, by: string | null = null;
  if (kind === "signed_out_by_admin") {
    const { data: admin } = await sb.rpc("is_admin"); if (!admin || !b?.user_id || !/^[0-9a-f-]{36}$/.test(b.user_id)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
    target = b.user_id; by = u.user.id;
  }
  try { await adminClient().from("usage_events").insert({ user_id: target, kind, by_user: by, device: kind === "signed_out_by_admin" ? "" : deviceOf(req, !!b?.app), ip: kind === "signed_out_by_admin" ? "" : ipOf(req) }); } catch { /* not worth failing a sign-in over */ }
  return new NextResponse(null, { status: 204 });
}
