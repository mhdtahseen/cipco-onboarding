import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { buildPayslips } from "@/lib/pdf/payslip";

// One person's salary slip for an approved payroll run.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser(); if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await ctx.params; if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Bad request", { status: 400 });
  const { data: line } = await sb.from("payroll_lines").select("*").eq("id", id).maybeSingle(); if (!line) return new NextResponse("Not found", { status: 404 });
  const { data: run } = await sb.from("payroll_runs").select("*").eq("id", line.run_id).maybeSingle(); if (!run || run.status !== "approved") return new NextResponse("Approve the payroll before printing salary slips.", { status: 409 });
  const { data: proj } = await sb.from("projects").select("name").eq("id", run.project_id).maybeSingle();
  const pdf = await buildPayslips([{ projectName: proj?.name ?? "", payMonth: run.pay_month, line }]);
  const name = String(line.snapshot?.name ?? "employee").replace(/[^\w ]/g, "").trim();
  return new NextResponse(Buffer.from(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="Salary slip ${name} ${String(run.pay_month).slice(0, 7)}.pdf"` } });
}
