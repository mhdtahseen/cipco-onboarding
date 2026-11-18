import { NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { verifyCompanyDoc } from "@/lib/companyDocLink";
import { fileNameFor } from "@/lib/companyAdmin";
import { r2SignedGetUrl } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A company document opened from the private link an Admin sent (Company page → Copy link). No login: the signed, expiring token is the only proof
// (src/lib/companyDocLink.ts). It opens the document's current file; a removed document, or a link older than 7 days, no longer opens.
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params; const t = verifyCompanyDoc(token);
  const text = (m: string, s: number) => new NextResponse(m, { status: s, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow, noarchive" } });
  if (!t) return text("This link is not valid or has expired (links work for 7 days). Please ask for the document again.", 410);
  const { data: d } = await adminClient().from("company_documents").select("title, file_path").eq("id", t.id).is("archived_at", null).maybeSingle();
  if (!d?.file_path || !String(d.file_path).startsWith("company/")) return text("This document is no longer available. Please ask for it again.", 404);
  return NextResponse.redirect(await r2SignedGetUrl(d.file_path, 300, fileNameFor(d.title, d.file_path), "inline"), 302);   // opens in the browser, saved under the document's name
}
