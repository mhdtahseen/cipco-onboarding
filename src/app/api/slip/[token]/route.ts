import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { buildPayslips } from "@/lib/pdf/payslip";
import { verifySlip } from "@/lib/slipLink";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A salary slip opened from the private link sent on WhatsApp. No login: the signed, expiring token in the address is the only proof, and it is checked here.
// Works only for an approved payroll. The slip is built fresh from the saved payroll line, so it is never a copy that can drift.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params; const t = verifySlip(token);
  const gone = (m: string, s: number) => new NextResponse(m, { status: s, headers: { "cache-control": "no-store" } });
  if (!t) return gone("This salary slip link is not valid or has expired. Please ask the office to send it again.", 410);
  const db = adminClient();
  const { data: line } = await db.from("payroll_lines").select("*").eq("id", t.lineId).maybeSingle(); if (!line) return gone("Not found", 404);
  const { data: run } = await db.from("payroll_runs").select("*").eq("id", line.run_id).maybeSingle(); if (!run || run.status !== "approved") return gone("This salary slip is not available.", 409);
  const { data: proj } = await db.from("projects").select("name").eq("id", run.project_id).maybeSingle();
  const pdf = await buildPayslips([{ projectName: proj?.name ?? "", payMonth: run.pay_month, line }]);
  const name = String(line.snapshot?.name ?? "employee").replace(/[^\w ]/g, "").trim();
  return new NextResponse(Buffer.from(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="Salary slip ${name} ${String(run.pay_month).slice(0, 7)}.pdf"`, "cache-control": "private, no-store", "x-robots-tag": "noindex, nofollow" } });
}
