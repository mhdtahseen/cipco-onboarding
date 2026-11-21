import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { cleanName, isBillSrc, pathsFor } from "@/lib/billsData";
import { serveStored } from "@/lib/fileServe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Opens or downloads one bill from Expenses → Bills. Takes the entry (source + id), never a file path: the entry is read through the person's own
// database rules, and only its own file is handed out, as a short-lived link straight to storage. ?dl=1&name=... saves it under that name.
export async function GET(req: NextRequest) {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser();
  if (!u.user) return new NextResponse("Please sign in again.", { status: 401 });
  const q = req.nextUrl.searchParams; const src = q.get("src") || "", id = q.get("id") || "";
  if (!isBillSrc(src) || !/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Bad request", { status: 400 });
  const path = (await pathsFor(sb, src, [id])).get(id);
  if (!path) return new NextResponse("This bill has no file, or you cannot open it.", { status: 404 });
  const ext = /\.([a-z0-9]{2,4})$/i.exec(path)?.[1]?.toLowerCase() || "";
  const name = q.get("dl") === "1" ? `${cleanName(q.get("name") || "bill")}${ext ? `.${ext}` : ""}` : undefined;
  return serveStored(req, path, { downloadName: name });
}
