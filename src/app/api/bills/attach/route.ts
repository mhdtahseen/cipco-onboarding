import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { SOURCES, isBillSrc } from "@/lib/billsData";
import { r2Put } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Attaches a bill to an entry that has none, from Expenses → Bills ("no bill yet"). The file is stored where that section keeps its own bills, then the entry
// is updated with the person's own login, so the database decides whether they may change it. Only an empty slot is filled: a bill already there is never replaced.
// A rent payment made for several rooms at once gets the bill on every room in that payment, as the Rent screen does.
const MAX = 5 * 1024 * 1024;
const TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

export async function POST(req: NextRequest) {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const form = await req.formData().catch(() => null); const file = form?.get("file");
  const src = String(form?.get("src") || ""), id = String(form?.get("id") || "");
  if (!isBillSrc(src) || !/^[0-9a-f-]{36}$/i.test(id) || !(file instanceof File)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  if (file.size > MAX) return NextResponse.json({ error: "The bill is larger than 5 MB: please send a smaller photo or compressed PDF." }, { status: 413 });
  if (file.type && !TYPES.includes(file.type)) return NextResponse.json({ error: "Upload a PDF or a photo (JPEG or PNG)." }, { status: 415 });

  const s = SOURCES[src];
  const { data: row, error: re } = await sb.from(s.table).select(`${s.idCol}, project_id, ${s.pathCol}${src === "rpay" ? ", batch_id" : ""}`).eq(s.idCol, id).maybeSingle();
  if (re || !row) return NextResponse.json({ error: "This entry was not found, or you cannot change it." }, { status: 404 });
  const r = row as unknown as Record<string, string | null>;
  if (r[s.pathCol]) return NextResponse.json({ error: "This entry already has a bill. Refresh the page." }, { status: 409 });

  const path = `${s.folder(r.project_id || "unassigned")}${Date.now()}-${(file.name || "bill").replace(/[^\w.\-]/g, "_")}`;
  try { await r2Put(path, await file.arrayBuffer(), file.type || "application/octet-stream"); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 502 }); }

  let q = sb.from(s.table).update({ [s.pathCol]: path }).is(s.pathCol, null);
  q = src === "rpay" && r.batch_id ? q.eq("batch_id", r.batch_id) : q.eq(s.idCol, id);
  const { data: done, error } = await q.select(s.idCol);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!done?.length) return NextResponse.json({ error: "You cannot change this entry, so the bill was not attached." }, { status: 403 });
  return NextResponse.json({ ok: true, updated: done.length });
}
