import { NextRequest, NextResponse } from "next/server";
import { companyAdmin, fileNameFor } from "@/lib/companyAdmin";
import { r2Get, r2SignedGetUrl } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Opens one company document (Admin only). ?doc=<id> the current file, &file=<id> an older copy, &dl=1 to save it, &raw=1 to send the bytes themselves
// (the phone's Share button needs the actual file; anything else goes straight to storage through a short-lived link).
const RAW_MAX = 4 * 1024 * 1024;   // a web response cannot carry much more; a larger file is shared as a link instead
export async function GET(req: NextRequest) {
  const a = await companyAdmin(); if ("res" in a) return a.res;
  const q = req.nextUrl.searchParams; const doc = q.get("doc") || "", fid = q.get("file") || "";
  if (!/^[0-9a-f-]{36}$/i.test(doc) || (fid && !/^[0-9a-f-]{36}$/i.test(fid))) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const { data: d } = await a.sb.from("company_documents").select("title, file_path, file_name").eq("id", doc).maybeSingle();
  if (!d) return NextResponse.json({ error: "Document not found." }, { status: 404 });
  let path = d.file_path as string | null;
  if (fid) { const { data: f } = await a.sb.from("company_document_files").select("file_path").eq("id", fid).eq("document_id", doc).maybeSingle(); path = f?.file_path ?? null; }
  if (!path || !path.startsWith("company/")) return NextResponse.json({ error: "No file uploaded for this document yet." }, { status: 404 });
  const name = fileNameFor(d.title, path);
  if (q.get("raw") === "1") {
    const b = await r2Get(path); if (!b) return NextResponse.json({ error: "The file could not be read." }, { status: 502 });
    if (b.byteLength > RAW_MAX) return NextResponse.json({ error: "too-large" }, { status: 413 });
    const ext = name.split(".").pop()?.toLowerCase();
    const type = ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "application/octet-stream";
    return new NextResponse(Buffer.from(b), { headers: { "content-type": type, "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(name)}`, "cache-control": "private, no-store" } });
  }
  return NextResponse.redirect(await r2SignedGetUrl(path, 300, q.get("dl") === "1" ? name : undefined), 302);
}
