import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { verifyLetter } from "@/lib/docLink";
import { issuedLetterPdf } from "@/lib/letterPdf";
import { LETTER_LABEL } from "@/lib/offboarding";
import { COMPANY } from "@/lib/company";
import type { LetterRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// An issued letter opened from the private link sent to the person. No login: the signed, expiring token in the address is the only proof, and it is checked here.
// The PDF is rebuilt from the issued snapshot, with the seal and signature, so it is always exactly what was issued.
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params; const t = verifyLetter(token);
  const gone = (m: string, s: number) => new NextResponse(m, { status: s, headers: { "cache-control": "no-store" } });
  if (!t) return gone("This link is not valid or has expired. Please ask the office to send it again.", 410);
  const { data } = await adminClient().from("letters").select("*").eq("id", t.id).maybeSingle(); if (!data) return gone("Not found", 404);
  const l = data as LetterRow; const what = LETTER_LABEL[l.kind] ?? "Letter";
  const mode = req.nextUrl.searchParams.get("file");
  if (mode === "download" || mode === "view") {
    const { bytes, file } = await issuedLetterPdf(l, true);
    return new NextResponse(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `${mode === "download" ? "attachment" : "inline"}; filename="${encodeURIComponent(file)}"`, "cache-control": "private, no-store", "x-robots-tag": "noindex, nofollow, noarchive" } });
  }
  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const first = String(l.vars?.full_name || "").split(/\s+/)[0] || "there";
  const until = new Date(t.exp * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(what)} | ${esc(COMPANY.name)}</title>
<style>:root{--bg:#f6f7fb;--card:#fff;--ink:#1b2233;--mute:#4a5470;--line:#e3e6ee;--brand:#1e4fa3}@media(prefers-color-scheme:dark){:root{--bg:#0e1420;--card:#171e2d;--ink:#e8ecf5;--mute:#9aa6c0;--line:#2a3347;--brand:#5b8ee6}.logo{filter:brightness(0) invert(1)}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
.c{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:28px 24px;text-align:center}.logo{height:40px;width:auto;margin:0 auto 18px;display:block}
h1{font-size:20px;margin:0 0 6px}p{margin:0 0 6px;color:var(--mute);font-size:14px}.b{display:block;width:100%;padding:14px;border-radius:12px;font-size:16px;font-weight:600;text-decoration:none;margin-top:12px}.p{background:var(--brand);color:#fff}.s{border:1px solid var(--line);color:var(--ink)}.f{margin-top:18px;font-size:12px}</style></head>
<body><main class="c"><img class="logo" src="/branding/logo-sm.png" alt="${esc(COMPANY.name)}"><h1>Hello ${esc(first)}</h1><p>Your <b>${esc(what.toLowerCase())}</b> (Ref: ${esc(l.ref_no)}) is ready.</p>
<a class="b p" href="?file=download">Download PDF</a><a class="b s" href="?file=view">View in browser</a>
<p class="f">This private link works until ${esc(until)}. For any query, please contact the office at ${esc(COMPANY.supportEmail)}.</p></main></body></html>`;
  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", "x-robots-tag": "noindex, nofollow, noarchive" } });
}
