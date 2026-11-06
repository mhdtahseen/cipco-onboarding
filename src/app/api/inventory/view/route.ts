import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { r2SignedGetUrl } from "@/lib/r2";

// Opens a bill's photo. Takes the bill's id, not a file path: the database rules decide who can read the bill.
// The path must sit under that bill's own project, because bill_path is typed by the client and must not become a way to open someone's employee documents.
export async function GET(req: NextRequest) {
  const sb = await serverClient();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  const id = req.nextUrl.searchParams.get("bill") || "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Bad request", { status: 400 });
  const { data } = await sb.from("inventory_bills").select("project_id, bill_path").eq("id", id).maybeSingle();
  const path = data?.bill_path || "";
  if (!path || path.includes("..") || !path.startsWith(`inv-${data!.project_id}/`)) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(await r2SignedGetUrl(path), 302);
}
