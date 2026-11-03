import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { r2Put } from "@/lib/r2";

// A challan photo for a gas delivery or return. Open to every role that works on the site (the database says whether this person may work on this project).
const MAX = 5 * 1024 * 1024;
export async function POST(req: NextRequest) {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser(); if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  const form = await req.formData(); const file = form.get("file"); const project = String(form.get("projectId") || "");
  if (!(file instanceof File) || !/^[0-9a-f-]{36}$/.test(project)) return new NextResponse("Bad request", { status: 400 });
  const { data: ok } = await sb.rpc("can_attend", { p_project: project }); if (!ok) return new NextResponse("Not allowed", { status: 403 });
  if (file.size > MAX) return new NextResponse("File too large (max 5 MB)", { status: 413 });
  const path = `gas/${project}/${Date.now()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
  try { await r2Put(path, await file.arrayBuffer(), file.type || "application/octet-stream"); } catch (e: any) { return new NextResponse(e.message, { status: 502 }); }
  return NextResponse.json({ path });
}
