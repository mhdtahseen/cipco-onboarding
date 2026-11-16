import { NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { verifyPhoto } from "@/lib/photoLink";
import { r2Get } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The passport photo from the link in an ESIC details PDF. No login: the signed, expiring token is the only proof (src/lib/photoLink.ts).
// The photo is fetched from storage here and sent on as a download, so the person's phone or laptop saves it as "<name> - photo.jpg".
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params; const t = verifyPhoto(token);
  const text = (m: string, s: number) => new NextResponse(m, { status: s, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  if (!t) return text("This link is not valid or has expired (photo links work for 7 days). Please ask the office to send the ESIC details again.", 410);
  const db = adminClient();
  const [{ data: e }, { data: d }] = await Promise.all([
    db.from("employees").select("full_name").eq("id", t.id).maybeSingle(),
    db.from("employee_documents").select("file_path").eq("employee_id", t.id).eq("doc_type", "photo").maybeSingle(),
  ]);
  const bytes = d?.file_path ? await r2Get(d.file_path) : null;
  if (!e || !bytes) return text("The photo is no longer available. Please ask the office.", 404);
  const png = bytes[0] === 0x89 && bytes[1] === 0x50, jpg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!png && !jpg) return text("The photo is not in a format that can be downloaded. Please ask the office.", 415);
  const name = `${String(e.full_name).replace(/[^\w .-]/g, "").trim() || "employee"} - photo.${png ? "png" : "jpg"}`;
  return new NextResponse(Buffer.from(bytes), { headers: {
    "content-type": png ? "image/png" : "image/jpeg", "content-disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    "cache-control": "private, no-store", "x-robots-tag": "noindex, nofollow, noarchive" } });
}
