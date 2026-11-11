import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { LETTER_LINK_DAYS, signLetter } from "@/lib/docLink";
import { SLIP_LINK_DAYS, signSlip } from "@/lib/slipLink";

export const runtime = "nodejs";

// A private, expiring link to one issued letter or one approved salary slip, to send to the person. Admin and Operations only.
export async function GET(req: NextRequest) {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser(); if (!u.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { data: staff } = await sb.rpc("is_staff"); if (!staff) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const kind = req.nextUrl.searchParams.get("kind"), id = req.nextUrl.searchParams.get("id") || "";
  if (!/^[0-9a-f-]{36}$/.test(id) || (kind !== "letter" && kind !== "slip")) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  if (kind === "letter") {
    const { data } = await sb.from("letters").select("id").eq("id", id).maybeSingle(); if (!data) return NextResponse.json({ error: "Letter not found." }, { status: 404 });
    return NextResponse.json({ url: `${req.nextUrl.origin}/api/doc/${signLetter(id)}`, days: LETTER_LINK_DAYS });
  }
  const { data: ok, error } = await sb.rpc("slip_approved", { p_line: id });
  if (error || !ok) return NextResponse.json({ error: error?.message || "That salary slip is not in an approved payroll." }, { status: 404 });
  return NextResponse.json({ url: `${req.nextUrl.origin}/api/slip/${signSlip(id)}`, days: SLIP_LINK_DAYS });
}
