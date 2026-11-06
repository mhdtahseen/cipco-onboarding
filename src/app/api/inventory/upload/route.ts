import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { r2Put } from "@/lib/r2";

const MAX = 5 * 1024 * 1024;
// A bill's photo, for anyone who may enter bills on that project. Supervisors reach this one and not /api/docs/upload, which stays for office staff.
export async function POST(req: NextRequest) {
  const sb = await serverClient();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  const form = await req.formData();
  const file = form.get("file"); const projectId = String(form.get("projectId") || "");
  if (!(file instanceof File) || !/^[0-9a-f-]{36}$/i.test(projectId)) return new NextResponse("Bad request", { status: 400 });
  if (!/^image\//.test(file.type) && file.type !== "application/pdf") return new NextResponse("Send a photo or a PDF of the bill.", { status: 415 });
  if (file.size > MAX) return new NextResponse("File too large (max 5 MB)", { status: 413 });
  const { data: allowed } = await sb.rpc("can_attend", { p_project: projectId });   // false for a Viewer and for a project the person is not on
  if (!allowed) return new NextResponse("Not allowed", { status: 403 });
  const path = `inv-${projectId}/bill/${Date.now()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
  try { await r2Put(path, await file.arrayBuffer(), file.type); }
  catch (e: any) { return new NextResponse(e.message, { status: 502 }); }
  return NextResponse.json({ path });
}
