import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { r2Get, r2SignedGetUrl } from "@/lib/r2";

export async function GET(req: NextRequest) {
  const sb = await serverClient();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  const path = req.nextUrl.searchParams.get("path") || "";
  if (!path || path.includes("..")) return new NextResponse("Bad request", { status: 400 });
  // raw=1: the file itself (same address, so the browser can read it), for opening an uploaded file in the scanner ("Fix")
  if (req.nextUrl.searchParams.get("raw") === "1") {
    const bytes = await r2Get(path); if (!bytes) return new NextResponse("Not found", { status: 404 });
    const type = /\.pdf$/i.test(path) ? "application/pdf" : /\.png$/i.test(path) ? "image/png" : /\.(jpe?g)$/i.test(path) ? "image/jpeg" : "application/octet-stream";
    return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": type, "Cache-Control": "private, no-store" } });
  }
  return NextResponse.redirect(await r2SignedGetUrl(path), 302);
}
