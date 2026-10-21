import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { buildImportExcel } from "@/lib/excel";
import type { Employee } from "@/lib/types";

export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  const sb = await serverClient();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  const ids = req.nextUrl.searchParams.get("ids")?.split(",").filter(Boolean);
  let q = sb.from("employees").select("*").order("created_at");
  if (ids?.length) q = q.in("id", ids);
  const { data } = await q;
  const buf = await buildImportExcel((data || []) as Employee[]);
  return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="ImportEmployee.xlsx"' } });
}
