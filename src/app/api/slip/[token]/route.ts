import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { buildPayslips } from "@/lib/pdf/payslip";
import { verifySlip } from "@/lib/slipLink";
import { COMPANY } from "@/lib/company";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A salary slip opened from the private link sent on WhatsApp. No login: the signed, expiring token in the address is the only proof, and it is checked here.
// Works only for an approved payroll. The slip is built fresh from the saved payroll line, so it is never a copy that can drift.
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params; const t = verifySlip(token);
  const gone = (m: string, s: number) => new NextResponse(m, { status: s, headers: { "cache-control": "no-store" } });
  if (!t) return gone("This salary slip link is not valid or has expired. Please ask the office to send it again.", 410);
  const db = adminClient();
  const { data: line } = await db.from("payroll_lines").select("*").eq("id", t.lineId).maybeSingle(); if (!line) return gone("Not found", 404);
  const { data: run } = await db.from("payroll_runs").select("*").eq("id", line.run_id).maybeSingle(); if (!run || run.status !== "approved") return gone("This salary slip is not available.", 409);
  const { data: proj } = await db.from("projects").select("name").eq("id", run.project_id).maybeSingle();
  const name = String(line.snapshot?.name ?? "employee").replace(/[^\w ]/g, "").trim(), ym = String(run.pay_month).slice(0, 7), file = `Salary slip ${name} ${ym}.pdf`;
  const mode = req.nextUrl.searchParams.get("file");   // "download" saves the PDF, "view" opens it in the browser; with neither, show the page below
  if (mode === "download" || mode === "view") {
    const pdf = await buildPayslips([{ projectName: proj?.name ?? "", payMonth: run.pay_month, line }]);
    return new NextResponse(Buffer.from(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `${mode === "download" ? "attachment" : "inline"}; filename="${file}"`, "cache-control": "private, no-store", "x-robots-tag": "noindex, nofollow, noarchive" } });
  }
  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const month = new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" }), first = name.split(/\s+/)[0] || "there";
  const until = new Date(t.exp * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Salary slip ${esc(month)} | ${esc(COMPANY.name)}</title>
<style>:root{--bg:#f6f7fb;--card:#fff;--ink:#1b2233;--mute:#4a5470;--line:#e3e6ee;--brand:#1e4fa3}@media(prefers-color-scheme:dark){:root{--bg:#0e1420;--card:#171e2d;--ink:#e8ecf5;--mute:#9aa6c0;--line:#2a3347;--brand:#5b8ee6}.logo{filter:brightness(0) invert(1)}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
.c{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:28px 24px;text-align:center}.logo{height:40px;width:auto;margin:0 auto 18px;display:block}
h1{font-size:20px;margin:0 0 6px}p{margin:0 0 6px;color:var(--mute);font-size:14px}.b{display:block;width:100%;padding:14px;border-radius:12px;font-size:16px;font-weight:600;text-decoration:none;margin-top:12px}.p{background:var(--brand);color:#fff}.s{border:1px solid var(--line);color:var(--ink)}.f{margin-top:18px;font-size:12px}</style></head>
<body><main class="c"><img class="logo" src="/branding/logo-sm.png" alt="${esc(COMPANY.name)}"><h1>Hello ${esc(first)}</h1><p>Your salary slip for <b>${esc(month)}</b> is ready.</p>
<a class="b p" href="?file=download" download="${esc(file)}">Download PDF</a><a class="b s" href="?file=view">View in browser</a>
<p class="f">This private link works until ${esc(until)}. For any query, please contact the office at ${esc(COMPANY.supportEmail)}.</p></main></body></html>`;
  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", "x-robots-tag": "noindex, nofollow, noarchive" } });
}
