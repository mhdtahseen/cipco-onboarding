import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import { disableLogin, enableLogin } from "@/lib/loginAccess";

export const runtime = "nodejs";

// Admin only: disable a login completely (the password stops working, it is signed out everywhere, its role is removed), or enable it again.
// You cannot do it to your own login, and the last Admin login cannot be disabled.
export async function POST(req: NextRequest) {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser(); if (!u.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { data: admin } = await sb.rpc("is_admin"); if (!admin) return NextResponse.json({ error: "Only an Admin can disable or enable a login." }, { status: 403 });
  const b = (await req.json().catch(() => null)) as { user_id?: string; action?: string; reason?: string } | null;
  if (!b?.user_id || !/^[0-9a-f-]{36}$/.test(b.user_id) || (b.action !== "disable" && b.action !== "enable")) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  if (b.user_id === u.user.id) return NextResponse.json({ error: "You cannot disable or enable your own login." }, { status: 400 });
  let db: ReturnType<typeof adminClient>; try { db = adminClient(); } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
  if (b.action === "disable") {
    const reason = String(b.reason || "").trim(); if (!reason) return NextResponse.json({ error: "Give a reason." }, { status: 400 });
    const { data: admins } = await db.from("user_roles").select("user_id").eq("role", "admin");
    const others = (admins || []).filter((a: { user_id: string }) => a.user_id !== b.user_id);
    if ((admins || []).some((a: { user_id: string }) => a.user_id === b.user_id) && !others.length) return NextResponse.json({ error: "This is the last Admin login. Make someone else an Admin first." }, { status: 400 });
    const e = await disableLogin(db, b.user_id, u.user.id, reason); if (e) return NextResponse.json({ error: e }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  const e = await enableLogin(db, b.user_id, u.user.id); if (e) return NextResponse.json({ error: e }, { status: 500 });
  return NextResponse.json({ ok: true });
}
