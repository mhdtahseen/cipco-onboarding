import { NextRequest, NextResponse } from "next/server";
import { r2Get, r2SignedGetUrl } from "@/lib/r2";

// How a route hands out one stored file once it has decided the person may open it. Every file route answers the same three ways:
//  (default)  redirect to a short-lived signed link (a new tab, an <img>, a download with dl=1 + name)
//  meta=1     { url, raw, name, type } for the in-app viewer: it reads the file from url (straight from storage, needs CORS on the bucket)
//             or, if the browser refuses that, from raw (this same route, same origin)
//  raw=1      the bytes through this route (Vercel caps a response at about 4.5 MB, so larger files answer 413 and the viewer offers a new tab)
const RAW_MAX = 4_400_000;
export const typeOf = (path: string) => (/\.pdf$/i.test(path) ? "application/pdf" : /\.png$/i.test(path) ? "image/png" : /\.jpe?g$/i.test(path) ? "image/jpeg"
  : /\.webp$/i.test(path) ? "image/webp" : /\.gif$/i.test(path) ? "image/gif" : /\.heic$/i.test(path) ? "image/heic" : "application/octet-stream");
/** "1716…-aadhaar_front.pdf" → "aadhaar_front.pdf" */
export const nameOf = (path: string) => (path.split("/").pop() || "file").replace(/^\d{10,}-/, "");

export async function serveStored(req: NextRequest, path: string, opts: { name?: string; downloadName?: string } = {}) {
  const q = req.nextUrl.searchParams; const type = typeOf(path); const name = opts.name || nameOf(path);
  if (q.get("meta") === "1") {
    const raw = new URL(req.nextUrl); raw.searchParams.delete("meta"); raw.searchParams.set("raw", "1");
    return NextResponse.json({ url: await r2SignedGetUrl(path, 300, name, "inline"), raw: raw.pathname + raw.search, name, type }, { headers: { "Cache-Control": "private, no-store" } });
  }
  if (q.get("raw") === "1") {
    const bytes = await r2Get(path); if (!bytes) return new NextResponse("Not found", { status: 404 });
    if (bytes.byteLength > RAW_MAX) return new NextResponse("too-large", { status: 413 });
    return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": type, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(name)}`, "Cache-Control": "private, no-store" } });
  }
  return NextResponse.redirect(await r2SignedGetUrl(path, 300, opts.downloadName), 302);
}
