import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { r2SignedGetUrl } from "@/lib/r2";

// Opens a challan photo, for someone who works on that project.
export async function GET(req: NextRequest) {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser(); if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  const path = req.nextUrl.searchParams.get("path") || ""; const m = /^gas\/([0-9a-f-]{36})\//.exec(path);
  if (!m || path.includes("..")) return new NextResponse("Bad request", { status: 400 });
  const { data: ok } = await sb.rpc("can_attend", { p_project: m[1] }); if (!ok) return new NextResponse("Not allowed", { status: 403 });
  return NextResponse.redirect(await r2SignedGetUrl(path), 302);
}
