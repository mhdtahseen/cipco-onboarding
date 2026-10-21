import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { r2Put } from "@/lib/r2";

const MAX = 5 * 1024 * 1024;
export async function POST(req: NextRequest) {
  const sb = await serverClient();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  const form = await req.formData();
  const file = form.get("file"); const employeeId = String(form.get("employeeId") || ""); const docType = String(form.get("docType") || "");
  if (!(file instanceof File) || !/^[\w-]+$/.test(employeeId) || !/^[\w-]+$/.test(docType)) return new NextResponse("Bad request", { status: 400 });
  if (file.size > MAX) return new NextResponse("File too large (max 5 MB)", { status: 413 });
  const path = `${employeeId}/${docType}/${Date.now()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
  try { await r2Put(path, await file.arrayBuffer(), file.type || "application/octet-stream"); }
  catch (e: any) { return new NextResponse(e.message, { status: 502 }); }
  return NextResponse.json({ path });
}
