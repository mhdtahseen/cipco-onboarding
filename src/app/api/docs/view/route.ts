import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { r2SignedGetUrl } from "@/lib/r2";

export async function GET(req: NextRequest) {
  const sb = await serverClient();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  const path = req.nextUrl.searchParams.get("path") || "";
  if (!path || path.includes("..")) return new NextResponse("Bad request", { status: 400 });
  return NextResponse.redirect(await r2SignedGetUrl(path), 302);
}
