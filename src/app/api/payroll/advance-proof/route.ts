import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { r2Put } from "@/lib/r2";
import { serveStored } from "@/lib/fileServe";

// Proof that an advance was paid out (bank screenshot, UPI receipt, signed voucher). Uploading needs Create in Payroll; opening needs View.
const MAX = 5 * 1024 * 1024;
const rank = async (sb: Awaited<ReturnType<typeof serverClient>>) => { const { data } = await sb.rpc("perm_open_rank", { p_module: "payroll" }); return Number(data) || 0; };

export async function POST(req: NextRequest) {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser(); if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  const form = await req.formData(); const file = form.get("file"); const project = String(form.get("projectId") || "");
  if (!(file instanceof File) || !/^[0-9a-f-]{36}$/.test(project)) return new NextResponse("Bad request", { status: 400 });
  if ((await rank(sb)) < 2) return new NextResponse("Not allowed", { status: 403 });
  if (file.size > MAX) return new NextResponse("File too large (max 5 MB)", { status: 413 });
  const path = `advances/${project}/${Date.now()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
  try { await r2Put(path, await file.arrayBuffer(), file.type || "application/octet-stream"); } catch (e: any) { return new NextResponse(e.message, { status: 502 }); }
  return NextResponse.json({ path });
}

export async function GET(req: NextRequest) {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser(); if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  const path = req.nextUrl.searchParams.get("path") || "";
  if (!/^advances\/[0-9a-f-]{36}\//.test(path) || path.includes("..")) return new NextResponse("Bad request", { status: 400 });
  if ((await rank(sb)) < 1) return new NextResponse("Not allowed", { status: 403 });
  return serveStored(req, path);
}
